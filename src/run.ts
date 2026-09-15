/**
 * CLI: run frozen suite, write logs/, print pass/N + suite version.
 *
 * Usage:
 *   npm run eval                 # live LLM if OPENROUTER_API_KEY set, else dry-run stub
 *   npm run eval -- --fixture    # use fixture answers (no LLM) for offline smoke
 *   npm run eval -- --task echo_hello
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReactAgent } from "./agent/react.js";
import { createLlmClient, OpenRouterClient } from "./llm/index.js";
import { createDefaultMcpClient } from "./mcp/index.js";
import {
  getSuiteVersionPath,
  runCheck,
  SUITE_VERSION,
  TASKS,
  type SuiteTask,
} from "./suite/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOGS_DIR = path.join(ROOT, "logs");

type CliArgs = {
  fixture: boolean;
  taskId?: string;
  help: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { fixture: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture" || a === "-f") out.fixture = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--task" || a === "-t") {
      out.taskId = argv[++i];
    }
  }
  return out;
}

type TaskOutcome = {
  id: string;
  pass: boolean;
  detail: string;
  finalAnswer: string;
  steps: number;
  logPath: string;
};

async function runOneTask(
  task: SuiteTask,
  opts: { fixture: boolean; runId: string },
): Promise<TaskOutcome> {
  const tools = createDefaultMcpClient();
  const llm = createLlmClient();
  const agentLog: unknown[] = [];

  let finalAnswer: string;
  let steps: number;
  let transcript = "";

  if (opts.fixture) {
    finalAnswer = task.fixtureAnswer ?? "";
    steps = 0;
    transcript = `[fixture] ${finalAnswer}`;
    agentLog.push({ type: "fixture", finalAnswer });
  } else {
    const agent = new ReactAgent({
      llm,
      tools,
      maxSteps: 8,
      onLog: (e) => {
        agentLog.push(e);
      },
    });
    const result = await agent.run(task.prompt);
    finalAnswer = result.finalAnswer;
    steps = result.steps;
    transcript = result.rawTranscript;
  }

  const check = runCheck(finalAnswer, 0, task.check);
  const logPath = path.join(LOGS_DIR, opts.runId, `${task.id}.json`);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(
    logPath,
    JSON.stringify(
      {
        taskId: task.id,
        suiteVersion: SUITE_VERSION,
        pass: check.pass,
        check: { kind: check.kind, detail: check.detail },
        finalAnswer,
        steps,
        fixture: opts.fixture,
        model:
          llm instanceof OpenRouterClient
            ? `${llm.modelId}${llm.isDryRun ? "#dry-run" : ""}`
            : "unknown",
        transcript,
        log: agentLog,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    id: task.id,
    pass: check.pass,
    detail: check.detail,
    finalAnswer,
    steps,
    logPath,
  };
}

function printHelp(): void {
  console.log(`basilisk-eval — suite ${SUITE_VERSION}

Usage:
  npm run eval -- [--fixture] [--task <id>]

Options:
  --fixture, -f   Use frozen fixture answers (no LLM / offline smoke)
  --task, -t      Run a single task id
  --help, -h      Show help

Env:
  OPENROUTER_API_KEY  Live multi-model calls (OpenRouter-style)
  MODEL               Pluggable model id (default openai/gpt-4o-mini)

Score: pass/N on suite version (from suite/version.json). Deterministic checkers only (no human grader).
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const tasks = args.taskId
    ? TASKS.filter((t) => t.id === args.taskId)
    : TASKS;

  if (tasks.length === 0) {
    console.error(`No tasks matched${args.taskId ? `: ${args.taskId}` : ""}`);
    console.error(`Known ids: ${TASKS.map((t) => t.id).join(", ")}`);
    process.exit(2);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(path.join(LOGS_DIR, runId), { recursive: true });

  const mode = args.fixture
    ? "fixture"
    : process.env.OPENROUTER_API_KEY
      ? "live"
      : "dry-run";

  console.log(`basilisk-eval suite ${SUITE_VERSION}`);
  console.log(`versionSource=${getSuiteVersionPath()}`);
  console.log(`mode=${mode} tasks=${tasks.length}`);
  console.log("---");

  const outcomes: TaskOutcome[] = [];
  for (const task of tasks) {
    const outcome = await runOneTask(task, { fixture: args.fixture, runId });
    outcomes.push(outcome);
    const mark = outcome.pass ? "PASS" : "FAIL";
    console.log(
      `[${mark}] ${outcome.id}  steps=${outcome.steps}  ${outcome.detail}`,
    );
  }

  const passed = outcomes.filter((o) => o.pass).length;
  const total = outcomes.length;
  const summaryPath = path.join(LOGS_DIR, runId, "summary.json");
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        suiteVersion: SUITE_VERSION,
        versionSource: getSuiteVersionPath(),
        mode,
        passed,
        total,
        score: `${passed}/${total}`,
        tasks: outcomes.map((o) => ({
          id: o.id,
          pass: o.pass,
          detail: o.detail,
          logPath: o.logPath,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("---");
  console.log(`Score: ${passed}/${total}  suite ${SUITE_VERSION}`);
  console.log(`Logs:  ${path.join(LOGS_DIR, runId)}`);
  console.log(`(Re-score after every change. Deterministic checks only.)`);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
