/**
 * Budget allocation for the `recall_context` envelope (design W3).
 *
 * The tool used to cap each memory at 4,000 characters and say nothing about
 * it. That spent the window blindly — eight results at 4,000 each is 32,000
 * characters whether or not the eighth was worth a tenth of the first — cut at
 * a character offset, and left the caller unable to tell that anything was
 * cut. This module replaces the per-item cap with one budget for the whole
 * serialized envelope and reports what it had to do to fit.
 *
 * The rule, in the order it is applied:
 *
 * 1. Tier ordering is preserved. Items go out in the order they came in;
 *    exact and core tiers keep their full text; the relevance tier shares
 *    whatever the budget has left after them.
 * 2. Within the relevance tier, trimming is longest-first. The allocator
 *    finds the single length at which every item longer than it is cut down
 *    to it and everything shorter passes through untouched, so one long item
 *    is trimmed before four short ones are dropped.
 * 3. No trimmed item is allocated fewer than `MIN_EXCERPT_CHARS`. When even
 *    that does not fit, the lowest-ranked relevance item is dropped and the
 *    rest are re-allocated. Only when the relevance tier is empty and the
 *    protected tiers still do not fit are they trimmed (longest-first, same
 *    floor) and then dropped from the bottom of their ordering.
 * 4. A cut lands on a paragraph, sentence or word boundary, in that order of
 *    preference, giving back at most `BOUNDARY_SLACK` of the allocation to
 *    find one; the ellipsis that marks the cut is charged to the item.
 * 5. The budget is measured on the serialized envelope
 *    (`JSON.stringify(items, null, 2)`), keys, quotes and indentation
 *    included, so the size the host sees is the size that was budgeted.
 *
 * Every trimmed item carries `truncated: true`, and the result counts what
 * was trimmed and dropped so the caller can widen the budget or read a memory
 * in full instead of quoting a cut-off one.
 */

export type RecallTier = "exact" | "core" | "relevance";

/** The tiers whose full text is protected until the relevance tier is gone. */
const PROTECTED_TIERS: ReadonlySet<RecallTier> = new Set(["exact", "core"]);

/**
 * Smallest allocation a trimmed item may receive, ellipsis included. Roughly
 * two sentences: enough to see what the memory is about and decide whether to
 * fetch it in full, which is what a cut-off memory is for.
 */
export const MIN_EXCERPT_CHARS = 240;

/**
 * Share of an allocation a boundary cut may give back to end on a paragraph,
 * sentence or word instead of mid-word. With a quarter, a trimmed item at the
 * minimum allocation still keeps at least 180 characters of text.
 */
export const BOUNDARY_SLACK = 0.25;

/** Marks a cut in the text itself, for readers that never see `truncated`. */
export const TRUNCATION_MARK = "…";

/**
 * Default envelope budget, roughly 6,000 tokens. The old per-item cap let a
 * full window reach 32,000 characters; this spends less by default and sits
 * well under the 50,000 the tool declares as its hard result size, which is
 * the host's limit rather than ours. Callers raise it per call when they
 * want more.
 */
export const DEFAULT_RECALL_BUDGET_CHARS = 24_000;

export type RecallBudgetOptions<T> = {
  /** Total characters the serialized envelope may occupy. */
  budget: number;
  tierOf: (item: T) => RecallTier;
  textOf: (item: T) => string;
  /**
   * Return the item with its text replaced and, when `truncated`, marked as
   * such. Must be a pure re-shaping: the allocator serializes the results of
   * this function to measure them.
   */
  withText: (item: T, text: string, truncated: boolean) => T;
};

export type RecallBudgetResult<T> = {
  /** Kept items in their original order, trimmed where they had to be. */
  items: T[];
  /** The budget the allocation was made against. */
  maxChars: number;
  /** Serialized size of `items` — always at most `maxChars`. */
  usedChars: number;
  /** Items whose text was cut. Each carries whatever `withText` marks. */
  trimmed: number;
  /** Items left out entirely because no allowed excerpt fit. */
  dropped: number;
};

/** Exactly what the tool serializes, so measuring here is measuring there. */
export function serializeRecallEnvelope(items: readonly unknown[]): string {
  return JSON.stringify(items, null, 2);
}

/**
 * Serialized size of one item as it appears inside the envelope: every line
 * of its own pretty-printed form is indented by two more spaces there.
 */
function itemCost(item: unknown): number {
  const lines = JSON.stringify(item, null, 2).split("\n");
  return (
    lines.reduce((sum, line) => sum + line.length + 2, 0) + lines.length - 1
  );
}

/**
 * What the envelope costs around `count` items: brackets, the newline after
 * the opening one and before the closing one, and a separator between each
 * pair. Charged for the items actually kept in a pass, never for dropped
 * ones, or a phantom separator could trim an item that fits.
 */
function framingCost(count: number): number {
  if (count === 0) return 2; // "[]"
  return 4 + 2 * (count - 1);
}

/** Characters the text adds once quoted and escaped inside the JSON. */
function textCost(text: string): number {
  return JSON.stringify(text).length - 2;
}

type Measured<T> = {
  item: T;
  index: number;
  tier: RecallTier;
  text: string;
  fullText: number;
  /** Cost of the item with empty text, untrimmed. */
  fixed: number;
  /** Cost of the item with empty text, marked truncated. */
  fixedTrimmed: number;
};

type Allocation = {
  /** Text-cost allowance per kept member of the pool, by pool position. */
  allowances: number[];
  /** Pool members that had to go, counted from the bottom of the pool. */
  dropped: number;
};

type Reserved = {
  /** Items kept outside the pool, whole; they take framing too. */
  count: number;
  /** Their serialized cost, text included. */
  cost: number;
};

/**
 * Share what `budget` leaves after `reserved` among `pool`. Members whose
 * text fits under the water level pass untouched; the rest are cut to it.
 * Drops from the bottom of the pool until every kept member can have at
 * least the minimum, re-framing for the items that remain each time.
 */
function allocatePool<T>(
  pool: Measured<T>[],
  budget: number,
  reserved: Reserved,
): Allocation {
  for (let keep = pool.length; keep >= 0; keep -= 1) {
    const kept = pool.slice(0, keep);
    let trimmedSet = new Set<number>();
    // The `truncated` mark costs a few characters itself. Charging it lowers
    // the level, which can only enlarge the trimmed set, so this settles.
    for (;;) {
      let remaining =
        budget - framingCost(reserved.count + keep) - reserved.cost;
      for (const [i, member] of kept.entries()) {
        remaining -= trimmedSet.has(i) ? member.fixedTrimmed : member.fixed;
      }
      const level = waterLevel(
        kept.map((member) => member.fullText),
        remaining,
      );
      const next = new Set(
        kept.flatMap((member, i) => (member.fullText > level ? [i] : [])),
      );
      if (next.size === trimmedSet.size) {
        if (next.size === 0 || level >= MIN_EXCERPT_CHARS) {
          return {
            allowances: kept.map((member) =>
              member.fullText > level ? level : member.fullText,
            ),
            dropped: pool.length - keep,
          };
        }
        break;
      }
      trimmedSet = next;
    }
  }
  return { allowances: [], dropped: pool.length };
}

/**
 * The single length `level` such that trimming every value above it to it
 * spends at most `remaining`, and nothing below it is touched. Infinity when
 * everything fits; negative when even empty texts do not.
 */
function waterLevel(costs: readonly number[], remaining: number): number {
  const total = costs.reduce((sum, c) => sum + c, 0);
  if (total <= remaining) return Number.POSITIVE_INFINITY;
  const ascending = [...costs].sort((a, b) => a - b);
  let left = remaining;
  for (const [i, cost] of ascending.entries()) {
    const share = Math.floor(left / (ascending.length - i));
    if (cost > share) return share;
    left -= cost;
  }
  return Number.NEGATIVE_INFINITY;
}

const PARAGRAPH_BREAK = /\n\s*\n/g;
const SENTENCE_END = /[.!?]["')\]]?(?=\s)/g;
const WORD_BREAK = /\s+/g;

/**
 * Last boundary of a kind within `[floor, limit]` of `text`, as the length to
 * keep, or undefined when the window holds none of that kind.
 */
function lastBoundary(
  text: string,
  pattern: RegExp,
  floor: number,
  limit: number,
  keepMatch: boolean,
): number | undefined {
  let best: number | undefined;
  for (const match of text.matchAll(pattern)) {
    if (match.index > limit) break;
    const cut = keepMatch ? match.index + match[0].length : match.index;
    if (cut >= floor && cut <= limit) best = cut;
  }
  return best;
}

/**
 * Cut `text` to at most `limit` characters, ending on a paragraph, sentence
 * or word boundary when one lies within the slack, and never inside a
 * surrogate pair.
 */
export function cutAtBoundary(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  const floor = Math.ceil(limit * (1 - BOUNDARY_SLACK));
  const cut =
    lastBoundary(text, PARAGRAPH_BREAK, floor, limit, false) ??
    lastBoundary(text, SENTENCE_END, floor, limit, true) ??
    lastBoundary(text, WORD_BREAK, floor, limit, false) ??
    limit;
  let end = cut;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/**
 * Trim `text` so that its escaped JSON cost, ellipsis included, is at most
 * `allowance`. Escapes make the cost exceed the raw length, so the raw limit
 * is tightened until the measured cost fits.
 */
function trimToCost(text: string, allowance: number): string {
  let limit = Math.max(0, allowance - TRUNCATION_MARK.length);
  for (;;) {
    const candidate = cutAtBoundary(text, limit) + TRUNCATION_MARK;
    const over = textCost(candidate) - allowance;
    if (over <= 0 || limit === 0) return candidate;
    limit = Math.max(0, limit - over);
  }
}

export function allocateRecallBudget<T>(
  items: readonly T[],
  { budget, tierOf, textOf, withText }: RecallBudgetOptions<T>,
): RecallBudgetResult<T> {
  const measured: Measured<T>[] = items.map((item, index) => {
    const tier = tierOf(item);
    const text = textOf(item);
    return {
      item,
      index,
      tier,
      text,
      fullText: textCost(text),
      fixed: itemCost(withText(item, "", false)),
      fixedTrimmed: itemCost(withText(item, "", true)),
    };
  });
  const protectedItems = measured.filter((m) => PROTECTED_TIERS.has(m.tier));
  const relevance = measured.filter((m) => !PROTECTED_TIERS.has(m.tier));

  const protectedFull = protectedItems.reduce(
    (sum, m) => sum + m.fixed + m.fullText,
    0,
  );

  const kept = new Map<number, { text: string; truncated: boolean }>();
  let dropped = 0;

  const protectedFits =
    framingCost(protectedItems.length) + protectedFull <= budget;
  if (protectedFits) {
    for (const m of protectedItems) {
      kept.set(m.index, { text: m.text, truncated: false });
    }
    const allocation = allocatePool(relevance, budget, {
      count: protectedItems.length,
      cost: protectedFull,
    });
    dropped += allocation.dropped;
    applyAllocation(relevance, allocation, kept);
  } else {
    // Nothing from relevance can fit; the protected tiers themselves are
    // trimmed, then dropped from the bottom of their ordering.
    dropped += relevance.length;
    const allocation = allocatePool(protectedItems, budget, {
      count: 0,
      cost: 0,
    });
    dropped += allocation.dropped;
    applyAllocation(protectedItems, allocation, kept);
  }

  // The model above is exact, so this is a guard, not a second pass:
  // rebuild, measure, and let the measurement have the last word.
  let result = measured.flatMap((m) => {
    const entry = kept.get(m.index);
    return entry ? [{ m, entry }] : [];
  });
  let serialized = serializeRecallEnvelope(
    result.map(({ m, entry }) => withText(m.item, entry.text, entry.truncated)),
  );
  while (serialized.length > budget && result.length > 0) {
    result = result.slice(0, -1);
    dropped += 1;
    serialized = serializeRecallEnvelope(
      result.map(({ m, entry }) =>
        withText(m.item, entry.text, entry.truncated),
      ),
    );
  }

  return {
    items: result.map(({ m, entry }) =>
      withText(m.item, entry.text, entry.truncated),
    ),
    maxChars: budget,
    usedChars: serialized.length,
    trimmed: result.filter(({ entry }) => entry.truncated).length,
    dropped,
  };
}

function applyAllocation<T>(
  pool: Measured<T>[],
  { allowances }: Allocation,
  kept: Map<number, { text: string; truncated: boolean }>,
): void {
  for (const [i, m] of pool.entries()) {
    const allowance = allowances[i];
    if (allowance === undefined) return;
    if (m.fullText <= allowance) {
      kept.set(m.index, { text: m.text, truncated: false });
    } else {
      kept.set(m.index, {
        text: trimToCost(m.text, allowance),
        truncated: true,
      });
    }
  }
}
