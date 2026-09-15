/**
 * Deterministic checkers only — no LLM-as-judge for MVP.
 */

export type CheckKind = "exact" | "json_equal" | "regex" | "exit_code" | "contains";

export type CheckSpec =
  | { kind: "exact"; expected: string; trim?: boolean; caseInsensitive?: boolean }
  | { kind: "json_equal"; expected: unknown }
  | { kind: "regex"; pattern: string; flags?: string }
  | { kind: "exit_code"; expected: number }
  | { kind: "contains"; substring: string; caseInsensitive?: boolean };

export type CheckResult = {
  pass: boolean;
  kind: CheckKind;
  detail: string;
};


/** Strip one matching pair of surrounding " or ' after trim. */
export function stripSurroundingQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function normalizeStr(s: string, trim: boolean, caseInsensitive: boolean): string {
  let out = s;
  if (trim) out = out.trim();
  if (caseInsensitive) out = out.toLowerCase();
  return out;
}

export function runCheck(actual: string, exitCode: number, spec: CheckSpec): CheckResult {
  actual = stripSurroundingQuotes(actual);
  switch (spec.kind) {
    case "exact": {
      const a = normalizeStr(actual, spec.trim !== false, !!spec.caseInsensitive);
      const e = normalizeStr(spec.expected, spec.trim !== false, !!spec.caseInsensitive);
      return {
        pass: a === e,
        kind: "exact",
        detail: a === e ? "match" : `expected=${JSON.stringify(e)} actual=${JSON.stringify(a)}`,
      };
    }
    case "json_equal": {
      try {
        const parsed = JSON.parse(actual) as unknown;
        const pass = deepEqual(parsed, spec.expected);
        return {
          pass,
          kind: "json_equal",
          detail: pass ? "match" : `expected=${JSON.stringify(spec.expected)} actual=${actual}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { pass: false, kind: "json_equal", detail: `invalid json: ${msg}` };
      }
    }
    case "regex": {
      const re = new RegExp(spec.pattern, spec.flags);
      const pass = re.test(actual);
      return {
        pass,
        kind: "regex",
        detail: pass ? "match" : `pattern=/${spec.pattern}/${spec.flags ?? ""} actual=${JSON.stringify(actual)}`,
      };
    }
    case "exit_code": {
      const pass = exitCode === spec.expected;
      return {
        pass,
        kind: "exit_code",
        detail: pass ? "match" : `expected=${spec.expected} actual=${exitCode}`,
      };
    }
    case "contains": {
      const hay = spec.caseInsensitive ? actual.toLowerCase() : actual;
      const needle = spec.caseInsensitive ? spec.substring.toLowerCase() : spec.substring;
      const pass = hay.includes(needle);
      return {
        pass,
        kind: "contains",
        detail: pass ? "match" : `missing substring=${JSON.stringify(spec.substring)}`,
      };
    }
    default: {
      const _exhaustive: never = spec;
      return { pass: false, kind: "exact", detail: `unknown check: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
