import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "../../_generated/api";
import schema from "../../schema";
import { modules } from "../../test.setup";

describe("capture grounding", () => {
  test("asks for grounding instead of failing when sourceType is absent", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));

    // No provider credentials are configured in tests. This passes only because
    // the grounding check returns before the embedding and admission calls,
    // which is also what keeps an ungrounded capture free.
    const result = await t.action(
      internal.models.thoughts.actions.captureThought,
      { userId, content: "Zevin started at Redwood Academy" },
    );

    expect(result.disposition).toBe("needs_confirmation");
    expect(result.thoughtId).toBeUndefined();
    expect(result.operationSummary).toMatch(/grounding is unknown/);

    const stored = await t.run((ctx) => ctx.db.query("thoughts").collect());
    expect(stored).toHaveLength(0);
  });
});
