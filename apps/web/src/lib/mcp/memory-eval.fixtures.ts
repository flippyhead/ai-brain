import type { RetrievalEvaluationCase } from "./memory-eval";

export const deterministicRetrievalFixtures: RetrievalEvaluationCase[] = [
  {
    name: "preserves exact project and version identifiers",
    query: "What's the current Atlas Memory version and migration ticket?",
    expectedUserId: "jordan",
    expectedIds: ["atlas-v2"],
    expectedExactStrings: ["Atlas Memory", "v2.7.1", "ATLAS-184"],
    results: [
      {
        id: "atlas-v2",
        userId: "jordan",
        memoryStatus: "current",
        content:
          "Atlas Memory is currently on v2.7.1; the active migration ticket is ATLAS-184.",
      },
    ],
  },
  {
    name: "returns current school without stale history",
    query: "Where does Zevin go to school now?",
    expectedUserId: "jordan",
    expectedIds: ["zevin-redwood"],
    expectedExactStrings: ["Zevin", "Redwood Academy"],
    results: [
      {
        id: "zevin-redwood",
        userId: "jordan",
        memoryStatus: "current",
        content:
          "Zevin currently attends Redwood Academy and previously attended Lakeside School.",
      },
    ],
  },
  {
    name: "allows linked former facts for an explicitly historical query",
    query: "How has Zevin's school changed?",
    expectedUserId: "jordan",
    expectedIds: ["zevin-redwood", "zevin-lakeside"],
    includeHistorical: true,
    results: [
      {
        id: "zevin-redwood",
        userId: "jordan",
        memoryStatus: "current",
        content: "Zevin currently attends Redwood Academy.",
      },
      {
        id: "zevin-lakeside",
        userId: "jordan",
        memoryStatus: "superseded",
        content: "Zevin attends Lakeside School.",
      },
    ],
  },
  {
    name: "keeps another account out of retrieval results",
    query: "What is Noam building?",
    expectedUserId: "noam",
    expectedIds: ["noam-project"],
    results: [
      {
        id: "noam-project",
        userId: "noam",
        memoryStatus: "current",
        content: "Noam is building the Atlas Memory demo.",
      },
    ],
  },
];
