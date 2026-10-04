import { describe, it, expect } from "vitest";
import { compactMessages } from "../agent/react.js";
import type { ChatMessage } from "../llm/index.js";

describe("compactMessages", () => {
  it("keeps system + task when no rounds", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a ReAct agent..." },
      { role: "user", content: "Do the task" },
    ];
    const result = compactMessages(messages, 2);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("user");
  });

  it("keeps system + task + last 2 rounds", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Task" },
      { role: "assistant", content: "Round 1 assistant" },
      { role: "user", content: "Round 1 user" },
      { role: "assistant", content: "Round 2 assistant" },
      { role: "user", content: "Round 2 user" },
      { role: "assistant", content: "Round 3 assistant" },
      { role: "user", content: "Round 3 user" },
    ];
    const result = compactMessages(messages, 2);
    expect(result).toHaveLength(6);
    expect(result[0].content).toBe("System");
    expect(result[1].content).toBe("Task");
    expect(result[2].content).toBe("Round 2 assistant");
    expect(result[3].content).toBe("Round 2 user");
    expect(result[4].content).toBe("Round 3 assistant");
    expect(result[5].content).toBe("Round 3 user");
  });

  it("includes trailing assistant without user", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Task" },
      { role: "assistant", content: "Round 1 assistant" },
      { role: "user", content: "Round 1 user" },
      { role: "assistant", content: "Round 2 assistant" },
      { role: "user", content: "Round 2 user" },
      { role: "assistant", content: "Round 3 assistant" },
    ];
    const result = compactMessages(messages, 2);
    expect(result).toHaveLength(5);
    expect(result[0].content).toBe("System");
    expect(result[1].content).toBe("Task");
    expect(result[2].content).toBe("Round 2 assistant");
    expect(result[3].content).toBe("Round 2 user");
    expect(result[4].content).toBe("Round 3 assistant");
  });

  it("keeps all when fewer than K rounds", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "Task" },
      { role: "assistant", content: "One assistant" },
      { role: "user", content: "One user" },
    ];
    const result = compactMessages(messages, 2);
    expect(result).toHaveLength(4);
    expect(result[2].content).toBe("One assistant");
    expect(result[3].content).toBe("One user");
  });

  it("preserves system byte-stable", () => {
    const systemContent = "System prompt with tools\n\nAvailable tools:\n- echo: Echo text";
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      { role: "user", content: "Task" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "U1" },
    ];
    const result = compactMessages(messages, 2);
    expect(result[0].content).toBe(systemContent);
  });
});
