// Types for scripts/check-tokens.mjs, so tests can import it.
export interface Violation {
  line: number;
  rule: string;
  text: string;
}
export function findViolations(text: string): Violation[];
export function check(opts: { root: string; legacy?: readonly string[] }): {
  errors: string[];
  offenders: Map<string, Violation[]>;
};
