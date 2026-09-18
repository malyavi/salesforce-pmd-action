import {flattenGained, pairKey} from './ratchet.mjs';

/**
 * What the run says, in two places with two different jobs to do.
 *
 * The pull request comment is a headline: the verdict, and enough of the new
 * findings to act on. The job summary is the record: every violation in the
 * touched files, new and inherited alike, so that a reader can see what the
 * ratchet let through and why.
 */

/**
 * The comment section for a diff-aware scan.
 *
 * @param {{ label: string, fileCount: number, gained: Array<object>, newTotal: number, preexisting: number, maxListed: number, ruleset: string, failOnNew: boolean }} result What the scan found and how it is worded
 * @return {string} Markdown for the comment section
 */
export function renderComment(result) {
  const {label, fileCount, gained, newTotal, preexisting, maxListed, ruleset, failOnNew} = result;
  const inherited = preexisting > 0
    ? ` ${preexisting} pre-existing violation(s) in the touched files do not fail the check; see the job summary.`
    : '';

  if (newTotal === 0) {
    return `:white_check_mark: **${label} passed**: no new violations in ${fileCount} changed file(s).${inherited}`;
  }

  const verdict = failOnNew ? ':x:' : ':warning:';
  const lines = [`${verdict} **${label}**: ${newTotal} new violation(s) in the changed files.${inherited}`, ''];

  const sorted = flattenGained(gained);
  const noted = new Set();
  for (const {violation, before} of sorted.slice(0, maxListed)) {
    // When the pair already had violations, the listed lines include the old
    // ones — line-level attribution across an edit is guesswork, so the count
    // is what is asserted and a note on the pair's first line says so.
    const key = pairKey(violation);
    const note = before > 0 && !noted.has(key)
      ? ` *(${before} hit(s) of this rule in this file predate the change)*`
      : '';
    noted.add(key);
    lines.push(`- \`${violation.file}:${violation.line}\` **${violation.rule}** — ${violation.description}${note}`);
  }
  if (sorted.length > maxListed) {
    lines.push(`- …and ${sorted.length - maxListed} more`);
  }

  lines.push(
    '',
    'A deliberate finding can be suppressed with `@SuppressWarnings(\'PMD.RuleName\')` and a comment ' +
    `saying why; the ruleset is \`${ruleset}\`.`
  );
  return lines.join('\n');
}

/**
 * The job summary for a diff-aware scan: every violation in the changed files,
 * new and pre-existing, with the rule documentation links.
 *
 * @param {{ label: string, headViolations: Array<object>, baseCounts: Map<string, number>, newTotal: number, preexisting: number }} result What the scan found
 * @return {string} Markdown for the step summary
 */
export function renderSummary(result) {
  const {label, headViolations, baseCounts, newTotal, preexisting} = result;
  const heading = newTotal > 0
    ? `## :x: ${label}: ${newTotal} new violation(s), ${preexisting} pre-existing`
    : `## :white_check_mark: ${label}: no new violations, ${preexisting} pre-existing`;

  if (headViolations.length === 0) {
    return `${heading}\n\nThe changed files carry no violations at all.`;
  }

  const remaining = new Map(baseCounts);
  const lines = [heading, '', '| File | Line | Rule | Priority | Status |', '| --- | --- | --- | --- | --- |'];
  for (const violation of headViolations) {
    // Attribute each pair's base count to its first-listed violations; the
    // overflow beyond that count is what the ratchet called new.
    const key = pairKey(violation);
    const before = remaining.get(key) || 0;
    const status = before > 0 ? 'pre-existing' : '**new**';
    remaining.set(key, before - 1);
    lines.push(
      `| \`${violation.file}\` | ${violation.line} | ${ruleLink(violation)} | P${violation.priority} | ${status} |`
    );
  }
  return lines.join('\n');
}

/**
 * The comment section for a full, informational scan.
 *
 * @param {{ label: string, reason: string, violations: Array<object> }} result What the scan found and why it ran
 * @return {string} Markdown for the comment section
 */
export function renderFullScanComment({label, reason, violations}) {
  return [
    `:white_check_mark: **${label}**: ${reason}; a full scan found ${violations.length} ` +
    'pre-existing violation(s), which do not fail this check.',
    '',
    `The breakdown is in the "${label}" job summary.`
  ].join('\n');
}

/**
 * The job summary for a full, informational scan: a count per rule, which is
 * the shape a reader can act on when every finding is pre-existing.
 *
 * @param {{ label: string, violations: Array<object> }} result What the scan found
 * @return {string} Markdown for the step summary
 */
export function renderFullScanSummary({label, violations}) {
  const byRule = new Map();
  for (const violation of violations) {
    byRule.set(violation.rule, (byRule.get(violation.rule) || 0) + 1);
  }

  return [
    `## ${label} — full informational scan (${violations.length} violations)`,
    '',
    '| Rule | Count |',
    '| --- | --- |',
    ...[...byRule.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([rule, count]) => `| ${rule} | ${count} |`)
  ].join('\n');
}

/**
 * The comment section for a run with nothing to analyze.
 *
 * @param {string} label How the check is named
 * @return {string} Markdown for the comment section
 */
export function renderNothingToDo(label) {
  return `:white_check_mark: **${label}**: no analyzable changes.`;
}

/**
 * A rule as a link to its documentation, or as plain text when the report
 * carried no URL for it.
 *
 * @param {{ rule: string, url?: string }} violation One violation
 * @return {string} Markdown for the rule cell
 */
function ruleLink(violation) {
  return violation.url ? `[${violation.rule}](${violation.url})` : violation.rule;
}
