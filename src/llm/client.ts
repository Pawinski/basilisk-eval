/**
 * OpenRouter-style multi-model LLM client.
 * Pluggable model id via env MODEL; auth via OPENROUTER_API_KEY.
 * Stub-friendly: dry-run mode when no key is set.
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type LlmCompletionRequest = {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type LlmCompletionResponse = {
  content: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  raw?: unknown;
};

export interface LlmClient {
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

const DEFAULT_BASE = "https://openrouter.ai/api/v1";

export type OpenRouterClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  /** When true (or no API key), returns a deterministic stub reply instead of calling the network. */
  dryRun?: boolean;
};

export class OpenRouterClient implements LlmClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly dryRun: boolean;

  constructor(opts: OpenRouterClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
    this.baseUrl = (opts.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE).replace(
      /\/$/,
      "",
    );
    this.defaultModel = opts.defaultModel ?? process.env.MODEL ?? "openai/gpt-4o-mini";
    this.dryRun = opts.dryRun ?? !this.apiKey;
  }

  get modelId(): string {
    return this.defaultModel;
  }

  get isDryRun(): boolean {
    return this.dryRun;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const model = req.model ?? this.defaultModel;

    if (this.dryRun) {
      return {
        content: stubReply(req.messages),
        model: `${model}#dry-run`,
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    if (!this.apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for live LLM calls");
    }

    const body = {
      model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      })),
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens ?? 1024,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/Pawinski/basilisk-eval",
        "X-Title": "basilisk-eval",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content ?? "";
    return {
      content,
      model: json.model ?? model,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      },
      raw: json,
    };
  }
}

/** Deterministic stub so the suite can smoke without a key. */
function stubReply(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const hint = lastUser?.content ?? "";
  // Minimal ReAct-shaped stub: prefer Final Answer when the prompt asks for one.
  if (/final answer/i.test(hint) || /answer:/i.test(hint)) {
    return "Thought: dry-run stub\nAction: finish\nAction Input: stub\nObservation: n/a\nFinal Answer: stub";
  }
  return "Thought: dry-run\nFinal Answer: stub";
}

export function createLlmClient(opts?: OpenRouterClientOptions): LlmClient {
  return new OpenRouterClient(opts);
}
