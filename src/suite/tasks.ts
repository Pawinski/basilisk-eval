/**
 * Frozen small diverse task suite.
 * Deterministic checkers only — no human grader, no LLM-as-judge.
 * Suite version: see suite/version.json (package root) (single source of truth).
 */

import type { CheckSpec } from "./checkers.js";
import { SUITE_VERSION } from "./version.js";

export type SuiteTask = {
  id: string;
  description: string;
  /** Prompt given to the ReAct agent. */
  prompt: string;
  /** Expected tool-using solution shape (documentation for humans). */
  expectedTools?: string[];
  check: CheckSpec;
  /**
   * Fixture mode: when true, runner may inject a scripted agent answer
   * for offline smoke without LLM (see run.ts --fixture).
   */
  fixtureAnswer?: string;
};

export { SUITE_VERSION };

export const TASKS: SuiteTask[] = [
  {
    id: "echo_hello",
    description: "Call echo tool and return the echoed text.",
    prompt:
      'Use the echo tool with text "hello-basilisk". Then finish with exactly that echoed string as the final answer.',
    expectedTools: ["echo"],
    check: { kind: "exact", expected: "hello-basilisk" },
    fixtureAnswer: "hello-basilisk",
  },
  {
    id: "add_17_25",
    description: "Add two numbers via the add tool.",
    prompt: "Use the add tool with a=17 and b=25. Finish with the numeric sum only.",
    expectedTools: ["add"],
    check: { kind: "exact", expected: "42" },
    fixtureAnswer: "42",
  },
  {
    id: "json_get_city",
    description: "Extract a JSON field via json_get.",
    prompt:
      'Use json_get with json={"city":"Warsaw","ok":true} and key="city". Finish with the city string only.',
    expectedTools: ["json_get"],
    check: { kind: "exact", expected: "Warsaw" },
    fixtureAnswer: "Warsaw",
  },
  {
    id: "regex_ticket",
    description: "Extract a ticket id with regex_extract.",
    prompt:
      'Use regex_extract on text "Ticket BK-1042 approved" with pattern "Ticket (BK-\\\\d+)". Finish with the captured ticket id only.',
    expectedTools: ["regex_extract"],
    check: { kind: "regex", pattern: "^BK-1042$" },
    fixtureAnswer: "BK-1042",
  },
  {
    id: "word_count_phrase",
    description: "Count words via word_count tool.",
    prompt:
      'Use word_count on text "alpha beta gamma delta". Finish with the count as a decimal integer string.',
    expectedTools: ["word_count"],
    check: { kind: "exact", expected: "4" },
    fixtureAnswer: "4",
  },
  {
    id: "json_equal_payload",
    description: "Produce a small JSON object (exact structure).",
    prompt:
      'Finish with a JSON object exactly equal to {"status":"ok","n":3} and nothing else.',
    expectedTools: [],
    check: { kind: "json_equal", expected: { status: "ok", n: 3 } },
    fixtureAnswer: '{"status":"ok","n":3}',
  },
  {
    id: "contains_basilisk",
    description: "Final answer must contain a marker substring.",
    prompt:
      'Use echo with text "basilisk-eval-pass". Finish with a short sentence that includes that exact echoed string.',
    expectedTools: ["echo"],
    check: { kind: "contains", substring: "basilisk-eval-pass" },
    fixtureAnswer: "Result: basilisk-eval-pass confirmed",
  },
];

export function getTask(id: string): SuiteTask | undefined {
  return TASKS.find((t) => t.id === id);
}

export function listTaskIds(): string[] {
  return TASKS.map((t) => t.id);
}
