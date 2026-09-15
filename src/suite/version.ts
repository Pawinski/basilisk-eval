/**
 * Suite version — single source of truth: suite/version.json (package root).
 * README and score printer both use this loader. Do not hardcode the version string.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERSION_PATH = path.join(ROOT, "suite", "version.json");

type VersionFile = { suiteVersion: string };

function loadSuiteVersion(): string {
  const raw = readFileSync(VERSION_PATH, "utf8");
  const parsed = JSON.parse(raw) as VersionFile;
  if (!parsed.suiteVersion || typeof parsed.suiteVersion !== "string") {
    throw new Error(`Invalid suite/version.json at ${VERSION_PATH}`);
  }
  return parsed.suiteVersion;
}

/** Resolved once from suite/version.json */
export const SUITE_VERSION: string = loadSuiteVersion();

export function getSuiteVersionPath(): string {
  return VERSION_PATH;
}
