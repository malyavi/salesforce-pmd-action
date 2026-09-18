/**
 * The ratchet: what a pull request *added*, as opposed to what the files it
 * touched already carried.
 *
 * Diff-aware on purpose. A ruleset applied to an existing codebase finds
 * violations that predate the check, and failing every pull request that
 * touches such a file makes the check unactionable — so the changed files are
 * analyzed twice, as merged and as they stand on the base, and only a gain
 * fails the run.
 *
 * The unit of comparison is one (file, rule) pair rather than one violation:
 * line numbers move with every edit, so identity-matching individual violations
 * across the two scans would report an ordinary refactor as new findings. A
 * pair whose count did not grow passes even if the violations inside it moved.
 */

/**
 * The ratchet key: one (file, rule) pair.
 *
 * @param {{ file: string, rule: string }} violation A parsed violation
 * @return {string} Stable key for counting
 */
export function pairKey(violation) {
  return `${violation.file}|${violation.rule}`;
}

/**
 * Counts violations per (file, rule) pair.
 *
 * @param {Array<{ file: string, rule: string }>} violations Parsed violations
 * @return {Map<string, number>} Counts by pair key
 */
export function tally(violations) {
  const counts = new Map();
  for (const violation of violations) {
    const key = pairKey(violation);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Groups violations by their (file, rule) pair, keeping each pair's own order.
 *
 * @param {Array<{ file: string, rule: string }>} violations Parsed violations
 * @return {Map<string, Array<object>>} Violations by pair key
 */
export function groupByPair(violations) {
  const grouped = new Map();
  for (const violation of violations) {
    const key = pairKey(violation);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(violation);
  }
  return grouped;
}

/**
 * Compares the two scans.
 *
 * @param {Array<object>} headViolations Violations in the files as merged
 * @param {Array<object>} baseViolations Violations in the same files as they stand on the base
 * @return {{ gained: Array<{ violations: Array<object>, before: number, added: number }>, newTotal: number, preexisting: number, baseCounts: Map<string, number> }} What the pull request added, what it inherited, and the base counts for rendering
 */
export function compareScans(headViolations, baseViolations) {
  const baseCounts = tally(baseViolations);
  const gained = [];
  let preexisting = 0;

  for (const [key, violations] of groupByPair(headViolations)) {
    const before = baseCounts.get(key) || 0;
    preexisting += Math.min(violations.length, before);
    if (violations.length > before) {
      gained.push({violations, before, added: violations.length - before});
    }
  }

  const newTotal = gained.reduce((sum, pair) => sum + pair.added, 0);
  return {gained, newTotal, preexisting, baseCounts};
}

/**
 * Flattens the gained pairs into one list of violations, most severe first, so
 * that a cap applied to it keeps the findings worth reading.
 *
 * Each entry carries its pair's base count, because a pair that already had
 * violations lists the old ones too: line-level attribution across an edit is
 * guesswork, so the count is what the ratchet asserts and the renderer says so.
 *
 * @param {Array<{ violations: Array<object>, before: number }>} gained Pairs that gained violations
 * @return {Array<{ violation: object, before: number }>} Flattened, sorted by priority
 */
export function flattenGained(gained) {
  return gained
    .flatMap((pair) => pair.violations.map((violation) => ({violation, before: pair.before})))
    .sort((left, right) => (left.violation.priority ?? 5) - (right.violation.priority ?? 5));
}
