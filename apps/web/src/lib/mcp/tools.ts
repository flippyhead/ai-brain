export const MCP_TOOL_NAMES = {
  searchThoughts: "search_thoughts",
  browseRecent: "browse_recent",
  getStats: "get_stats",
  captureThought: "capture_thought",
  createReport: "create_report",
  getInsights: "get_insights",
  deleteInsight: "delete_insight",
  // Lists
  createList: "create_list",
  updateList: "update_list",
  getLists: "get_lists",
  getList: "get_list",
  archiveList: "archive_list",
  createListItem: "create_list_item",
  updateListItem: "update_list_item",
  getOpenItems: "get_open_items",
} as const;

export const MCP_TOOL_NAME_LIST = Object.values(MCP_TOOL_NAMES);
