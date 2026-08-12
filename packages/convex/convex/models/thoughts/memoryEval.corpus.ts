/**
 * Seed corpus for the live recall baseline.
 *
 * Two accounts hold deliberately confusable memories — the same child, the same
 * product, the same kind of medical detail — so that a broken account boundary
 * produces a retrieval hit rather than silence.
 *
 * Keys are stable identifiers used to score results; they are never stored.
 */

export type SeedMemory = {
  key: string;
  content: string;
  isCore?: boolean;
  /** Business time, distinct from when the memory is recorded. */
  validFrom?: string;
  validTo?: string;
  /** Key of a memory this one replaces because the world changed. */
  supersedes?: string;
  /** Key of a memory this one corrects because it was never true. */
  retracts?: string;
};

export type SeedQuery = {
  name: string;
  query: string;
  expectedKeys: string[];
  includeHistorical?: boolean;
  expectedExactStrings?: string[];
};

export type SeedAccount = {
  label: string;
  memories: SeedMemory[];
  queries: SeedQuery[];
};

export const liveRecallCorpus: SeedAccount[] = [
  {
    label: "avery",
    memories: [
      { key: "school-old", content: "Zevin attends Lakeside School." },
      {
        key: "school-new",
        content:
          "Zevin currently attends Redwood Academy. He previously attended Lakeside School.",
        supersedes: "school-old",
        validFrom: "2026-08-01",
      },
      { key: "blood-wrong", content: "Avery's blood type is O negative." },
      {
        key: "blood-right",
        content:
          "Avery's blood type is A negative. The earlier O negative record was inaccurate.",
        retracts: "blood-wrong",
      },
      {
        key: "atlas-version",
        content:
          "Atlas Memory is currently on v2.7.1; the active migration ticket is ATLAS-184.",
      },
      {
        key: "hvac",
        content:
          "Delgado Mechanical services the furnace and boiler; ask for Marisol.",
      },
      {
        key: "foster-stage",
        content: "Foster Clarity is in a limited rollout to three brokerages.",
      },
      {
        key: "foster-blocker",
        content:
          "The Foster Clarity rollout is blocked on MLS credential provisioning.",
      },
      { key: "foster-owner", content: "Priya owns the Foster Clarity rollout." },
      {
        key: "diet",
        content: "Avery is vegetarian and cannot eat shellfish.",
        isCore: true,
      },
    ],
    queries: [
      {
        name: "exact product and ticket identifiers",
        query: "What's the current Atlas Memory version and migration ticket?",
        expectedKeys: ["atlas-version"],
        expectedExactStrings: ["v2.7.1", "ATLAS-184"],
      },
      {
        name: "current school only",
        query: "Where does Zevin go to school now?",
        expectedKeys: ["school-new"],
        expectedExactStrings: ["Redwood Academy"],
      },
      {
        name: "school history when asked historically",
        query: "How has Zevin's school changed over time?",
        expectedKeys: ["school-new", "school-old"],
        includeHistorical: true,
      },
      {
        name: "paraphrase with no shared keywords",
        query: "Who should I call when the heating stops working?",
        expectedKeys: ["hvac"],
        expectedExactStrings: ["Delgado Mechanical"],
      },
      {
        name: "correction never resurfaces as history",
        query: "What has Avery's blood type been recorded as?",
        expectedKeys: ["blood-right"],
        includeHistorical: true,
      },
      {
        name: "multi-fact project status",
        query: "What's the status of the Foster Clarity rollout?",
        expectedKeys: ["foster-stage", "foster-blocker", "foster-owner"],
        expectedExactStrings: ["Priya"],
      },
      {
        name: "enduring constraint reached by paraphrase",
        query: "What should I cook for dinner when Avery visits?",
        expectedKeys: ["diet"],
      },
    ],
  },
  {
    label: "rowan",
    memories: [
      { key: "rowan-blood", content: "Rowan's blood type is AB positive." },
      {
        key: "rowan-atlas",
        content: "Atlas Memory is on v9.9.9 in Rowan's fork.",
      },
      { key: "rowan-school", content: "Zevin attends Brightwater School." },
    ],
    queries: [
      {
        name: "other account sees only its own version",
        query: "What version is Atlas Memory on?",
        expectedKeys: ["rowan-atlas"],
        expectedExactStrings: ["v9.9.9"],
      },
      {
        name: "other account sees only its own school record",
        query: "Where does Zevin go to school?",
        expectedKeys: ["rowan-school"],
        expectedExactStrings: ["Brightwater School"],
      },
    ],
  },
];
