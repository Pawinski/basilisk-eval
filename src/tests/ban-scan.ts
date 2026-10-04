/**
 * Ban scan: verify public surface does not contain forbidden terms.
 * Exit 0 if clean, exit 1 if violations found.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const BANNED_TERMS = [
  ["R", "eid"].join(""),
  ["car", "eer"].join(""),
  ["Cash", "Snap"].join(""),
  ["Sal", "on"].join(""),
  ["Stay", "22"].join(""),
  ["Door", " C"].join(""),
  ["Sta", "ff"].join(""),
  ["job", "-hunt"].join(""),
  ["Confid", "ence"].join(""),
];

const SCAN_EXTENSIONS = [".ts", ".js", ".json", ".md", ".txt", ".env"];
const IGNORE_DIRS = ["node_modules", ".git", "dist", "logs"];

function scanDir(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry)) continue;
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...scanDir(fullPath));
    } else if (stat.isFile()) {
      const ext = path.extname(entry);
      if (SCAN_EXTENSIONS.includes(ext) || entry === ".env.example") {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function scanFile(filePath: string): Array<{ term: string; line: number; text: string }> {
  const violations: Array<{ term: string; line: number; text: string }> = [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const term of BANNED_TERMS) {
      if (line.toLowerCase().includes(term.toLowerCase())) {
        violations.push({
          term,
          line: i + 1,
          text: line.slice(0, 100),
        });
      }
    }
  }

  return violations;
}

function main(): void {
  console.log("Ban scan: checking for forbidden terms...");
  console.log(`Terms: ${BANNED_TERMS.join(", ")}`);
  console.log("---");

  const files = scanDir(ROOT);
  let totalViolations = 0;

  for (const file of files) {
    const relPath = path.relative(ROOT, file);
    const violations = scanFile(file);

    if (violations.length > 0) {
      for (const v of violations) {
        console.log(`VIOLATION: ${relPath}:${v.line} [${v.term}] "${v.text}"`);
        totalViolations++;
      }
    }
  }

  console.log("---");
  if (totalViolations > 0) {
    console.log(`FAIL: ${totalViolations} violation(s) found`);
    process.exit(1);
  } else {
    console.log("PASS: No violations found");
    process.exit(0);
  }
}

main();
