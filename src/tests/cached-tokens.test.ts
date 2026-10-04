import { describe, it, expect } from "vitest";
import { parseCachedTokens } from "../llm/client.js";

describe("parseCachedTokens", () => {
  it("returns undefined when usage is undefined", () => {
    const result = parseCachedTokens(undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no cache fields present", () => {
    const result = parseCachedTokens({});
    expect(result).toBeUndefined();
  });

  it("does not coerce missing to 0", () => {
    const result = parseCachedTokens({ prompt_tokens_details: {} });
    expect(result).toBeUndefined();
    expect(result).not.toBe(0);
  });

  it("reads prompt_tokens_details.cached_tokens first", () => {
    const result = parseCachedTokens({
      prompt_tokens_details: { cached_tokens: 100, cache_read: 50 },
      cache_read_input_tokens: 25,
    });
    expect(result).toBe(100);
  });

  it("falls back to cache_read_input_tokens second", () => {
    const result = parseCachedTokens({
      cache_read_input_tokens: 200,
      prompt_tokens_details: { cache_read: 150 },
    });
    expect(result).toBe(200);
  });

  it("falls back to prompt_tokens_details.cache_read third", () => {
    const result = parseCachedTokens({
      prompt_tokens_details: { cache_read: 300 },
    });
    expect(result).toBe(300);
  });

  it("returns undefined when fields are non-numeric", () => {
    const result = parseCachedTokens({
      prompt_tokens_details: { cached_tokens: "not a number" as unknown as number },
    });
    expect(result).toBeUndefined();
  });

  it("returns 0 when cached_tokens is explicitly 0", () => {
    const result = parseCachedTokens({
      prompt_tokens_details: { cached_tokens: 0 },
    });
    expect(result).toBe(0);
  });
});
