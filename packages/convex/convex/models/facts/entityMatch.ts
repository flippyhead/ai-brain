/**
 * Entity mentions in a recall query.
 *
 * `recall_context` runs this on every call, so it is pure, model-free, and
 * bounded. It finds the spans of a query that look like names — runs of
 * capitalised words, optionally joined by connectors such as "of" — and
 * returns them normalized exactly as entity names are stored, so a candidate
 * compares directly against `normalizedName` and `normalizedAliases`.
 *
 * Every candidate costs an index lookup, so the count is capped and long runs
 * are cut at the length a name can plausibly have. Candidates are emitted
 * longest span first across the whole query, then shorter spans, so a cap
 * that bites keeps one candidate per named thing rather than every sub-span
 * of the first few. A query with no capitalised words yields nothing: the
 * name still reaches keyword relevance, which indexes it.
 */

/** Lookups a single recall query may trigger. */
export const MAX_ENTITY_CANDIDATES = 12;
/** Longest name, in words, a capitalised run is tested at. */
export const MAX_ENTITY_NAME_WORDS = 4;

/**
 * The transform behind `normalizeEntityName`: what the write path stores in
 * `normalizedName` and `normalizedAliases`, minus the length check. Query
 * candidates go through the same function so a name matches however it was
 * cased, hyphenated, or spaced when it was stored.
 */
export function normalizeEntityText(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * Lowercase words that may sit inside a name ("Bank of Fernwood") but never
 * begin or end one.
 */
const CONNECTOR_WORDS = new Set([
  "of",
  "and",
  "the",
  "de",
  "del",
  "di",
  "da",
  "van",
  "von",
  "der",
  "den",
  "du",
  "la",
  "le",
  "y",
]);

/**
 * Capitalised only because they open a sentence: function words, and the
 * verbs a request to an assistant tends to start with. A span that starts or
 * ends with one of these is not a name; "What Zevin" is dropped and "Zevin"
 * kept. The list is a heuristic, not a grammar — a word it misses costs one
 * index lookup that finds nothing.
 */
const NON_NAME_WORDS = new Set([
  ...CONNECTOR_WORDS,
  "a",
  "an",
  "about",
  "after",
  "again",
  "all",
  "also",
  "always",
  "am",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "before",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "each",
  "either",
  "every",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "hello",
  "her",
  "here",
  "hey",
  "hi",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "last",
  "let",
  "may",
  "me",
  "might",
  "must",
  "my",
  "never",
  "next",
  "no",
  "not",
  "now",
  "ok",
  "okay",
  "on",
  "or",
  "our",
  "over",
  "please",
  "shall",
  "she",
  "should",
  "since",
  "so",
  "some",
  "still",
  "than",
  "thanks",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "today",
  "tomorrow",
  "until",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "whose",
  "why",
  "will",
  "with",
  "would",
  "yes",
  "yesterday",
  "you",
  "your",
  // Imperatives a message to an assistant commonly opens with.
  "add",
  "ask",
  "book",
  "call",
  "check",
  "compare",
  "describe",
  "explain",
  "draft",
  "email",
  "find",
  "get",
  "give",
  "help",
  "list",
  "log",
  "look",
  "make",
  "message",
  "note",
  "ping",
  "plan",
  "put",
  "remember",
  "remind",
  "review",
  "save",
  "search",
  "schedule",
  "send",
  "set",
  "show",
  "summarise",
  "summarize",
  "tell",
  "text",
  "track",
  "update",
  "write",
  // Contractions other than the possessive, which is stripped instead.
  "i'm",
  "i've",
  "i'd",
  "i'll",
  "we're",
  "we've",
  "you're",
  "you've",
  "they're",
  "they've",
  "don't",
  "doesn't",
  "didn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "can't",
  "couldn't",
  "shouldn't",
  "wouldn't",
  "won't",
]);

type Word = {
  text: string;
  capitalised: boolean;
  connector: boolean;
  /** Punctuation before the word closed whatever name came before it. */
  boundaryBefore: boolean;
  /** Punctuation after the word closes the name it belongs to. */
  boundaryAfter: boolean;
};

/**
 * Strips surrounding punctuation and a trailing possessive, so "Zevin's" and
 * "(Priya)," test as "Zevin" and "Priya", and remembers that punctuation was
 * there: a comma, full stop, or bracket separates names, so "Alice, Bob" is
 * two names and never the one name "Alice Bob". Curly apostrophes are folded
 * to straight ones so the contraction list matches either.
 */
function cleanWord(raw: string): Word | null {
  const folded = raw.replace(/[‘’]/g, "'");
  const leading = /^[^\p{L}\p{N}]+/u.exec(folded)?.[0] ?? "";
  const stripped = folded.slice(leading.length);
  const trailing = /[^\p{L}\p{N}]+$/u.exec(stripped)?.[0] ?? "";
  const text = stripped
    .slice(0, stripped.length - trailing.length)
    .replace(/'s$/i, "");
  if (!text) return null;
  const lower = text.toLocaleLowerCase("en-US");
  return {
    text,
    capitalised: /^\p{Lu}/u.test(text),
    connector: CONNECTOR_WORDS.has(lower),
    boundaryBefore: leading.length > 0,
    boundaryAfter: trailing.length > 0,
  };
}

/**
 * Maximal runs of capitalised words, with connectors allowed only inside.
 * Punctuation on either side of a word ends a run: names in a list or across
 * a sentence break are separate candidates, not one long span.
 */
function capitalisedRuns(words: Word[]): Word[][] {
  const runs: Word[][] = [];
  let current: Word[] = [];
  const flush = () => {
    while (current.length > 0 && current[current.length - 1]!.connector) {
      current.pop();
    }
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const word of words) {
    if (word.boundaryBefore) flush();
    if (word.capitalised) {
      current.push(word);
    } else if (word.connector && current.length > 0) {
      current.push(word);
    } else {
      flush();
    }
    if (word.boundaryAfter) flush();
  }
  flush();
  return runs;
}

function isNameEdge(word: Word): boolean {
  return !NON_NAME_WORDS.has(word.text.toLocaleLowerCase("en-US"));
}

/**
 * Normalized candidate names in a query, most specific first, capped.
 *
 * "Where does Zevin go to school with Priya Desai now?" yields
 * `["priya desai", "zevin", "priya", "desai"]`.
 */
export function extractEntityCandidates(
  query: string,
  maxCandidates = MAX_ENTITY_CANDIDATES,
): string[] {
  const words = query
    .split(/\s+/)
    .map(cleanWord)
    .filter((word): word is Word => word !== null);
  const runs = capitalisedRuns(words);

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (let length = MAX_ENTITY_NAME_WORDS; length >= 1; length -= 1) {
    for (const run of runs) {
      for (let start = 0; start + length <= run.length; start += 1) {
        if (candidates.length >= maxCandidates) return candidates;
        const span = run.slice(start, start + length);
        if (!isNameEdge(span[0]!) || !isNameEdge(span[span.length - 1]!)) {
          continue;
        }
        const candidate = normalizeEntityText(
          span.map((word) => word.text).join(" "),
        );
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}
