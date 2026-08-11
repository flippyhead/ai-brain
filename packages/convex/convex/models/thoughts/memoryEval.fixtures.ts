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
    expectedIds: [
      "foster-stage",
      "foster-blocker",
      "foster-owner",
    ],
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
