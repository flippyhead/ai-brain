import type { RetrievalEvaluationCase } from "./memoryEval";

/**
 * Recorded retrieval results scored without calling an embedding or language
 * model. These pin the scorer's semantics in CI. Live ranking quality and
 * account isolation are measured separately by the recall baseline harness.
 */
export const deterministicRetrievalFixtures: RetrievalEvaluationCase[] = [
  {
    name: "preserves exact project and version identifiers",
    query: "What's the current Atlas Memory version and migration ticket?",
    expectedUserId: "avery",
    expectedIds: ["atlas-v2"],
    expectedExactStrings: ["Atlas Memory", "v2.7.1", "ATLAS-184"],
    results: [
      {
        id: "atlas-v2",
        userId: "avery",
        memoryStatus: "current",
        content:
          "Atlas Memory is currently on v2.7.1; the active migration ticket is ATLAS-184.",
      },
    ],
  },
  {
    name: "returns current school without stale history",
    query: "Where does Zevin go to school now?",
    expectedUserId: "avery",
    expectedIds: ["zevin-redwood"],
    expectedExactStrings: ["Zevin", "Redwood Academy"],
    results: [
      {
        id: "zevin-redwood",
        userId: "avery",
        memoryStatus: "current",
        content:
          "Zevin currently attends Redwood Academy and previously attended Lakeside School.",
      },
    ],
  },
  {
    name: "allows linked former facts for an explicitly historical query",
    query: "How has Zevin's school changed?",
    expectedUserId: "avery",
    expectedIds: ["zevin-redwood", "zevin-lakeside"],
    includeHistorical: true,
    results: [
      {
        id: "zevin-redwood",
        userId: "avery",
        memoryStatus: "current",
        content: "Zevin currently attends Redwood Academy.",
      },
      {
        id: "zevin-lakeside",
        userId: "avery",
        memoryStatus: "superseded",
        content: "Zevin attends Lakeside School.",
      },
    ],
  },
  {
    name: "keeps another account out of retrieval results",
    query: "What is Rowan building?",
    expectedUserId: "rowan",
    expectedIds: ["rowan-project"],
    results: [
      {
        id: "rowan-project",
        userId: "rowan",
        memoryStatus: "current",
        content: "Rowan is building the Atlas Memory demo.",
      },
    ],
  },
  {
    name: "answers a paraphrase that shares no keywords with the memory",
    query: "Who should I call when the heating stops working?",
    expectedUserId: "avery",
    expectedIds: ["hvac-contact"],
    expectedExactStrings: ["Delgado Mechanical"],
    results: [
      {
        id: "hvac-contact",
        userId: "avery",
        memoryStatus: "current",
        content:
          "Delgado Mechanical services the furnace and boiler; ask for Marisol.",
      },
    ],
  },
  {
    name: "never presents a retracted memory as prior history",
    query: "What has Avery's blood type been recorded as?",
    expectedUserId: "avery",
    expectedIds: ["blood-type-current"],
    includeHistorical: true,
    results: [
      {
        id: "blood-type-current",
        userId: "avery",
        memoryStatus: "current",
        content:
          "Avery's blood type is A negative. An earlier record of O negative was inaccurate.",
      },
    ],
  },
  {
    name: "recalls every memory behind a multi-fact project question",
    query: "What's the status of the Foster Clarity rollout?",
    expectedUserId: "avery",
    expectedIds: ["foster-stage", "foster-blocker", "foster-owner"],
    expectedExactStrings: ["Foster Clarity", "Priya"],
    results: [
      {
        id: "foster-stage",
        userId: "avery",
        memoryStatus: "current",
        content: "Foster Clarity is in a limited rollout to three brokerages.",
      },
      {
        id: "foster-blocker",
        userId: "avery",
        memoryStatus: "current",
        content:
          "The Foster Clarity rollout is blocked on MLS credential provisioning.",
      },
      {
        id: "foster-owner",
        userId: "avery",
        memoryStatus: "current",
        content: "Priya owns the Foster Clarity rollout.",
      },
    ],
  },
];

/**
 * A recorded recall ranking: what each retriever returned for one corpus
 * query, keyed into `liveRecallCorpus`, before the blend policy decided what
 * a client sees. The blend is the thing under test, so it is applied at test
 * time rather than baked into the recording.
 */
export type RecordedRecallRanking = {
  account: string;
  queryName: string;
  /**
   * Facts about the entities the query names, as the exact tier orders them.
   * `entityLookup.test.ts` checks these against the seeded corpus, so a
   * recording cannot drift from what the tier serves.
   */
  exactFactKeys: string[];
  /** Core facts as `listCore` returns them, newest first. */
  coreFactKeys: string[];
  /** Keyword fact hits in the order the search index returned them. */
  relevantFactKeys: string[];
  /** Hybrid thought hits in fused rank order. */
  relevantThoughtKeys: string[];
};

// The account's core set: two core facts, neither of which answers any of the
// questions below. It also holds a core narrative memory ("diet"); that used
// to ride along on every question, and now appears only where it ranks.
const averyCore = {
  account: "avery",
  coreFactKeys: ["fact-home", "fact-diet"],
};

/**
 * The five question shapes the 2026-09-02 bake-off lost on retrieval
 * (docs/comparisons/gbrain-bakeoff.md). In each, the right memory is in the
 * thought ranking at second or third place, and keyword-only fact search
 * returns a fact that shares a word with the question without answering it.
 * Scored at the default limit of five.
 */
export const recordedBakeoffRankings: RecordedRecallRanking[] = [
  {
    ...averyCore,
    queryName: "semantic recall of a comparison outcome",
    exactFactKeys: [],
    relevantFactKeys: ["fact-tomas-role"],
    relevantThoughtKeys: [
      "atlas-version",
      "atlas-bakeoff",
      "categories-new",
      "hvac",
      "foster-stage",
    ],
  },
  {
    ...averyCore,
    queryName: "semantic recall with no shared vocabulary",
    exactFactKeys: [],
    relevantFactKeys: ["fact-priya-role"],
    relevantThoughtKeys: [
      "foster-owner",
      "foster-stage",
      "priya-cover",
      "foster-blocker",
      "atlas-version",
    ],
  },
  {
    ...averyCore,
    queryName: "open loop with a named vendor",
    // Delgado Mechanical is a value in Marisol's role fact, not an entity.
    exactFactKeys: [],
    relevantFactKeys: ["fact-marisol-role"],
    relevantThoughtKeys: ["hvac", "delgado-credit", "foster-blocker", "diet"],
  },
  {
    ...averyCore,
    queryName: "change over time behind a keyword-heavy neighbour",
    exactFactKeys: [],
    relevantFactKeys: ["fact-tomas-role"],
    relevantThoughtKeys: [
      "atlas-version",
      "categories-new",
      "categories-old",
      "atlas-bakeoff",
    ],
  },
  {
    ...averyCore,
    queryName: "synthesis across three memories",
    // The question names Zevin, whose one fact does not answer it.
    exactFactKeys: ["fact-school"],
    relevantFactKeys: ["fact-school"],
    relevantThoughtKeys: [
      "tuition-amount",
      "tuition-schedule",
      "tuition-discount",
      "school-new",
      "school-old",
    ],
  },
];

/**
 * The two exact-entity shapes. Keyword fact search sees only the subject's
 * name, which every one of the subject's facts carries, so its order between
 * them is arbitrary; the recording puts the wrong one first. The exact tier
 * orders by how much of the fact's wording the query mentions, newest first
 * among ties.
 */
export const recordedExactEntityRankings: RecordedRecallRanking[] = [
  {
    ...averyCore,
    queryName: "named entity with no predicate words",
    exactFactKeys: ["fact-marisol-line", "fact-marisol-role"],
    relevantFactKeys: ["fact-marisol-role", "fact-marisol-line"],
    relevantThoughtKeys: ["hvac", "delgado-credit", "foster-blocker"],
  },
  {
    ...averyCore,
    queryName: "named entity by alias",
    exactFactKeys: ["fact-tomas-return", "fact-tomas-role"],
    relevantFactKeys: ["fact-tomas-role", "fact-tomas-return"],
    relevantThoughtKeys: ["priya-cover", "atlas-bakeoff", "atlas-version"],
  },
];
