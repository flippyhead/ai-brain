export const MCP_TOOL_NAMES = {
  searchThoughts: "search_thoughts",
  browseRecent: "browse_recent",
  getStats: "get_stats",
  captureThought: "capture_thought",
  createReport: "create_report",
  getInsights: "get_insights",
} as const;

export const MCP_TOOL_NAME_LIST = Object.values(MCP_TOOL_NAMES);
