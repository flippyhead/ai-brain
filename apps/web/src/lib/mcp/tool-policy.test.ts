import { describe, expect, it } from "vitest";

import {
  MCP_MEMORY_TOOL_NAMES,
  resolveEnabledMcpToolNames,
  resolveMcpToolProfile,
} from "./tool-policy";
import { MCP_TOOL_NAME_LIST } from "./tools";

describe("MCP tool profile", () => {
  it("defaults to the full surface so upgrades do not remove tools", () => {
    expect(resolveMcpToolProfile(undefined)).toBe("full");
    expect(resolveMcpToolProfile("")).toBe("full");
    expect(resolveMcpToolProfile("full")).toBe("full");
  });

  it("narrows only on an explicit opt-in", () => {
    expect(resolveMcpToolProfile("memory")).toBe("memory");
  });

  it("rejects unrecognised values rather than guessing", () => {
    expect(() => resolveMcpToolProfile("minimal")).toThrow(
      'MCP_TOOL_PROFILE must be either "memory" or "full"',
    );
  });

  it("resolves the enabled set that discovery and the drift check read", () => {
    expect([...resolveEnabledMcpToolNames("full")].sort()).toEqual(
      [...MCP_TOOL_NAME_LIST].sort(),
    );
    expect([...resolveEnabledMcpToolNames("memory")].sort()).toEqual(
      [...MCP_MEMORY_TOOL_NAMES].sort(),
    );
  });
});
