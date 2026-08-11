import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readRepoFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("brain-init previews a bounded atomic candidate set before writes", async () => {
  const skill = await readRepoFile(
    "plugins/ai-brain/skills/brain-init/SKILL.md",
  );

  assert.match(
    skill,
    /Do not call any AI Brain write tool before Step 6 approval/,
  );
  assert.match(skill, /Propose at most 15 candidates/);
  assert.match(skill, /one subject and one independently changeable fact/);
  assert.match(skill, /Never store a current age/);
  assert.match(skill, /mcp__ai-brain__remember_fact/);
  assert.match(skill, /sourceType: user_confirmed/);
  assert.doesNotMatch(skill, /Thoughts to create:/);
  assert.doesNotMatch(skill, /\*\*About me\*\*/);
  assert.doesNotMatch(skill, /Capture a comprehensive project summary/);
});

test("connector evidence is treated as a candidate rather than durable truth", async () => {
  const skill = await readRepoFile(
    "plugins/ai-brain/skills/brain-init/SKILL.md",
  );

  assert.match(
    skill,
    /Connected tools may suggest candidates, but never establish them/,
  );
  assert.match(
    skill,
    /A single email, meeting, message, repository interaction, or company mention is not durable knowledge/,
  );
  assert.match(skill, /Stop and wait\. Do not write anything in this step/);
});
