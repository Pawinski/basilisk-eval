import { describe, it, expect, vi } from "vitest";
import { ReactAgent } from "../agent/react.js";
import type { McpToolClient, McpToolSchema, McpToolResult } from "../mcp/index.js";
import type { LlmClient, LlmCompletionResponse } from "../llm/index.js";

function createMockLlm(response: string): LlmClient {
  return {
    complete: vi.fn().mockResolvedValue({
      content: response,
      model: "mock",
      usage: { promptTokens: 10, completionTokens: 5 },
    } as LlmCompletionResponse),
  };
}

function createMockTools(): McpToolClient {
  return {
    listTools: vi.fn().mockResolvedValue([
      { name: "echo", description: "Echo text" },
      { name: "add", description: "Add numbers" },
      { name: "json_get", description: "Get JSON field" },
    ] as McpToolSchema[]),
    callTool: vi.fn().mockResolvedValue({
      ok: true,
      content: "result",
    } as McpToolResult),
  };
}

describe("expectedTools filtering", () => {
  it("empty expectedTools omits tool lines from system prompt", async () => {
    const llm = createMockLlm("Thought: done\nAction: finish\nAction Input: test");
    const tools = createMockTools();

    const agent = new ReactAgent({
      llm,
      tools,
      expectedTools: [],
    });

    await agent.run("Test prompt");

    const call = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = call.messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).not.toContain("echo");
    expect(systemMsg.content).not.toContain("add");
    expect(systemMsg.content).not.toContain("json_get");
    expect(systemMsg.content).not.toContain("Available tools:");
  });

  it("filters to only specified tools in registry order", async () => {
    const llm = createMockLlm("Thought: done\nAction: finish\nAction Input: test");
    const tools = createMockTools();

    const agent = new ReactAgent({
      llm,
      tools,
      expectedTools: ["json_get", "echo"],
    });

    await agent.run("Test prompt");

    const call = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = call.messages[0];
    expect(systemMsg.content).toContain("json_get");
    expect(systemMsg.content).toContain("echo");
    expect(systemMsg.content).not.toContain("add");

    const jsonGetIndex = systemMsg.content.indexOf("json_get");
    const echoIndex = systemMsg.content.indexOf("echo");
    expect(jsonGetIndex).toBeLessThan(echoIndex);
  });

  it("ignores unknown tool names", async () => {
    const llm = createMockLlm("Thought: done\nAction: finish\nAction Input: test");
    const tools = createMockTools();

    const agent = new ReactAgent({
      llm,
      tools,
      expectedTools: ["unknown_tool", "echo"],
    });

    await agent.run("Test prompt");

    const call = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = call.messages[0];
    expect(systemMsg.content).toContain("echo");
    expect(systemMsg.content).not.toContain("unknown_tool");
  });

  it("keeps full catalog when expectedTools is undefined", async () => {
    const llm = createMockLlm("Thought: done\nAction: finish\nAction Input: test");
    const tools = createMockTools();

    const agent = new ReactAgent({
      llm,
      tools,
    });

    await agent.run("Test prompt");

    const call = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = call.messages[0];
    expect(systemMsg.content).toContain("echo");
    expect(systemMsg.content).toContain("add");
    expect(systemMsg.content).toContain("json_get");
  });
});
