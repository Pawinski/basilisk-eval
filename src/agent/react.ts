/**
 * Minimal ReAct loop: Thought → Action → Observation → … → Final Answer.
 * Logs every loop / LLM / tool I/O turn.
 */

import type { ChatMessage, LlmClient } from "../llm/index.js";
import type { McpToolClient } from "../mcp/index.js";

export type ReactLogEntry = {
  ts: string;
  type: "llm_request" | "llm_response" | "thought" | "action" | "observation" | "final" | "error";
  data: unknown;
};

export type ReactRunResult = {
  finalAnswer: string;
  steps: number;
  log: ReactLogEntry[];
  rawTranscript: string;
};

export type ReactAgentOptions = {
  llm: LlmClient;
  tools: McpToolClient;
  maxSteps?: number;
  systemPrompt?: string;
  onLog?: (entry: ReactLogEntry) => void;
};

const DEFAULT_SYSTEM = `You are a ReAct agent. Use this format strictly:

Thought: <reasoning>
Action: <tool_name or finish>
Action Input: <JSON object for the tool, or final answer string when Action is finish>

After each Action you will receive:
Observation: <tool result>

When done, use Action: finish with Action Input set to the final answer (plain text only).
Do not wrap the Final Answer / Action Input in quotes unless the answer itself must contain those quote characters.
Never emit XML/HTML tool markup, <tool_call>, or code fences for tools — only the Thought/Action/Action Input lines above.
Keep reasoning short. Prefer tools over guessing.`;

function pushLog(
  log: ReactLogEntry[],
  onLog: ((e: ReactLogEntry) => void) | undefined,
  type: ReactLogEntry["type"],
  data: unknown,
): void {
  const entry: ReactLogEntry = { ts: new Date().toISOString(), type, data };
  log.push(entry);
  onLog?.(entry);
}


function looksLikeSafetyDump(s: string): boolean {
  return (
    /user\s*safety\s*:\s*safe/i.test(s) ||
    /content[- ]?safety/i.test(s) ||
    /^\s*safe\s*$/i.test(s.trim()) ||
    /\bi cannot\b/i.test(s) ||
    /\bas an ai\b/i.test(s) ||
    /\bi'm unable to\b/i.test(s) ||
    /\bi am unable to\b/i.test(s)
  );
}

function looksLikeBadFinal(s: string): boolean {
  return !s.trim() || looksLikeToolMarkup(s) || looksLikeSafetyDump(s);
}

function looksLikeToolMarkup(s: string): boolean {
  return (
    /<\/?tool_call\b|<function\b|<invoke\b|```(?:xml|json)?/i.test(s) ||
    /\bAction\s*:/i.test(s) ||
    /\bAction\s*Input\s*:/i.test(s)
  );
}

/** Best-effort parse of common free-model tool markup into ReAct action. */
function parseToolMarkup(text: string): { action?: string; actionInput?: string } | null {
  const name =
    text.match(/<tool_call>\s*([a-zA-Z0-9_]+)/i)?.[1] ||
    text.match(/name["']?\s*[:=]\s*["']([a-zA-Z0-9_]+)["']/i)?.[1] ||
    text.match(/call\s+([a-zA-Z0-9_]+)\s*\(/i)?.[1];
  if (!name) return null;

  const jsonBlock = text.match(/\{[\s\S]*\}/)?.[0];
  if (jsonBlock) {
    try {
      JSON.parse(jsonBlock);
      return { action: name, actionInput: jsonBlock };
    } catch {
      /* fall through */
    }
  }

  const args: Record<string, string> = {};
  for (const m of text.matchAll(
    /(?:parameter|arg|param)?\s*["']?([a-zA-Z_][\w]*)["']?\s*[:=]\s*["']([^"']*)["']/gi,
  )) {
    if (m[1].toLowerCase() === "name") continue;
    args[m[1]] = m[2];
  }
  if (Object.keys(args).length > 0) {
    return { action: name, actionInput: JSON.stringify(args) };
  }
  return { action: name, actionInput: "{}" };
}

function parseReactBlock(text: string): {
  thought?: string;
  action?: string;
  actionInput?: string;
  finalAnswer?: string;
} {
  const thought = text.match(/Thought:\s*(.+?)(?=\nAction:|\nFinal Answer:|$)/is)?.[1]?.trim();
  const action = text.match(/Action:\s*(\S+)/i)?.[1]?.trim();
  const actionInput = text
    .match(/Action Input:\s*(.+?)(?=\nThought:|\nAction:|\nObservation:|\nFinal Answer:|$)/is)?.[1]
    ?.trim();
  const finalAnswer = text.match(/Final Answer:\s*(.+?)$/is)?.[1]?.trim();

  if (finalAnswer && !action) {
    return { thought, finalAnswer };
  }
  if (action?.toLowerCase() === "finish") {
    return { thought, action: "finish", actionInput, finalAnswer: actionInput ?? finalAnswer };
  }
  return { thought, action, actionInput, finalAnswer };
}

function parseActionArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { value: v };
  } catch {
    return { text: raw };
  }
}

export class ReactAgent {
  private readonly llm: LlmClient;
  private readonly tools: McpToolClient;
  private readonly maxSteps: number;
  private readonly systemPrompt: string;
  private readonly onLog?: (entry: ReactLogEntry) => void;

  constructor(opts: ReactAgentOptions) {
    this.llm = opts.llm;
    this.tools = opts.tools;
    this.maxSteps = opts.maxSteps ?? 8;
    this.systemPrompt = opts.systemPrompt ?? DEFAULT_SYSTEM;
    this.onLog = opts.onLog;
  }

  async run(taskPrompt: string): Promise<ReactRunResult> {
    const log: ReactLogEntry[] = [];
    const toolList = await this.tools.listTools();
    const toolCatalog = toolList
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${this.systemPrompt}\n\nAvailable tools:\n${toolCatalog || "(none)"}`,
      },
      { role: "user", content: taskPrompt },
    ];

    let transcript = `User: ${taskPrompt}\n`;
    let finalAnswer = "";
    let lastGoodObservation = "";

    for (let step = 1; step <= this.maxSteps; step++) {
      const resolveFinish = (candidate: string): string => {
        const c = (candidate ?? "").trim();
        if (c && !looksLikeBadFinal(c)) return c;
        if (lastGoodObservation && !looksLikeBadFinal(lastGoodObservation)) {
          return lastGoodObservation;
        }
        return c;
      };

      pushLog(log, this.onLog, "llm_request", { step, messages: structuredClone(messages) });

      const resp = await this.llm.complete({ messages, temperature: 0 });
      pushLog(log, this.onLog, "llm_response", {
        step,
        model: resp.model,
        content: resp.content,
        usage: resp.usage,
      });

      transcript += `\n--- step ${step} ---\n${resp.content}\n`;
      let parsed = parseReactBlock(resp.content);

      if (parsed.thought) {
        pushLog(log, this.onLog, "thought", { step, thought: parsed.thought });
      }

      if (parsed.finalAnswer && (!parsed.action || parsed.action.toLowerCase() === "finish")) {
        finalAnswer = resolveFinish(parsed.finalAnswer);
        if (looksLikeBadFinal(finalAnswer)) {
          messages.push({ role: "assistant", content: resp.content });
          messages.push({
            role: "user",
            content:
              "Final Answer must be the plain task result only (not safety text or tool markup). Use Action: finish with that Action Input.",
          });
          continue;
        }
        pushLog(log, this.onLog, "final", { step, finalAnswer });
        return { finalAnswer, steps: step, log, rawTranscript: transcript };
      }

      if (!parsed.action) {
        const fromMarkup = parseToolMarkup(resp.content);
        if (fromMarkup?.action) {
          parsed.action = fromMarkup.action;
          parsed.actionInput = fromMarkup.actionInput;
        } else if (looksLikeToolMarkup(resp.content) || !resp.content.trim()) {
          // Free models often dump tool XML — do not accept as Final Answer.
          messages.push({ role: "assistant", content: resp.content });
          messages.push({
            role: "user",
            content:
              "Invalid format. Reply using only:\nThought: ...\nAction: <tool_or_finish>\nAction Input: <json_or_plain_final>\nNo XML tool markup.",
          });
          continue;
        } else {
          finalAnswer = resolveFinish(resp.content);
          if (looksLikeBadFinal(finalAnswer)) {
            messages.push({ role: "assistant", content: resp.content });
            messages.push({
              role: "user",
              content:
                "That was not a final answer. Use Action: finish with Action Input set to the plain task result only.",
            });
            continue;
          }
          pushLog(log, this.onLog, "final", { step, finalAnswer, note: "no_action_parsed" });
          return { finalAnswer, steps: step, log, rawTranscript: transcript };
        }
      }

      if (parsed.action.toLowerCase() === "finish") {
        finalAnswer = resolveFinish(parsed.actionInput ?? parsed.finalAnswer ?? "");
        if (looksLikeBadFinal(finalAnswer)) {
          messages.push({ role: "assistant", content: resp.content });
          messages.push({
            role: "user",
            content:
              "Action Input must be the plain task result only (not safety text or tool markup). Try Action: finish again.",
          });
          continue;
        }
        pushLog(log, this.onLog, "final", { step, finalAnswer });
        return { finalAnswer, steps: step, log, rawTranscript: transcript };
      }

      const args = parseActionArgs(parsed.actionInput);
      pushLog(log, this.onLog, "action", {
        step,
        name: parsed.action,
        arguments: args,
        rawInput: parsed.actionInput,
      });

      const result = await this.tools.callTool({ name: parsed.action, arguments: args });
      const observation = result.ok
        ? result.content
        : `ERROR: ${result.error ?? "tool failed"}`;

      pushLog(log, this.onLog, "observation", {
        step,
        ok: result.ok,
        content: result.content,
        error: result.error,
        data: result.data,
      });

      if (result.ok && observation && !looksLikeBadFinal(observation)) {
        lastGoodObservation = observation.trim();
      }
      transcript += `Observation: ${observation}\n`;
      messages.push({ role: "assistant", content: resp.content });
      messages.push({ role: "user", content: `Observation: ${observation}` });
    }

    finalAnswer = "(max steps exceeded)";
    pushLog(log, this.onLog, "error", { message: "max_steps_exceeded" });
    return { finalAnswer, steps: this.maxSteps, log, rawTranscript: transcript };
  }
}
