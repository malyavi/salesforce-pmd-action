import {tmpdir}                                            from 'node:os';
import {join}                                              from 'node:path';
import {argsInput, booleanInput, ConfigError, input, intInput, listInput} from './inputs.mjs';

/**
 * The action's inputs, resolved into one object the rest of the code reads.
 *
 * Kept apart from the script that acts on it so the decisions — which files
 * count, which base to ratchet against, whether this run can ratchet at all —
 * are testable by setting an environment rather than by running PMD.
 */

/** Scan modes: derive one from the diff, force the ratchet, or force a full scan. */
export const MODES = ['auto', 'diff', 'full'];

/**
 * Resolves every input.
 *
 * @return {{
 *   label: string,
 *   mode: string,
 *   sourceDirs: string[],
 *   extensions: string[],
 *   configPaths: string[],
 *   ruleset: string,
 *   version: string,
 *   downloadUrl: string,
 *   extraArgs: string[],
 *   baseRef: string,
 *   failOnNew: boolean,
 *   maxListed: number,
 *   section: string,
 *   workDir: string,
 *   cwd: string
 * }} Resolved configuration
 * @throws {ConfigError} When an input is malformed or a mode cannot be honoured
 */
export function resolveConfig() {
  const mode = input('mode', 'auto').toLowerCase();
  if (!MODES.includes(mode)) {
    throw new ConfigError(`Unknown \`mode\` "${mode}"; expected one of ${MODES.join(', ')}.`);
  }

  const sourceDirs = listInput('source-dirs', ['force-app']);
  const ruleset = input('ruleset', 'rulesets/apex/quickstart.xml');
  // The ruleset is configuration by definition: changing it changes what every
  // later run reports, so the run that changes it is the one that should prove
  // it still parses. A caller naming a built-in ruleset adds nothing here, and
  // the pattern simply never matches.
  const configPaths = [...new Set([...listInput('config-paths', []), ruleset])];

  return {
    label: input('label', 'PMD (Apex)'),
    mode,
    sourceDirs,
    extensions: listInput('extensions', ['cls', 'trigger']),
    configPaths,
    ruleset,
    version: input('pmd-version', '7.27.0'),
    downloadUrl: input('pmd-download-url'),
    extraArgs: argsInput('pmd-args'),
    baseRef: resolveBaseRef(),
    failOnNew: booleanInput('fail-on-new', true),
    maxListed: intInput('max-listed', 20),
    section: input('comment-section', 'pmd'),
    workDir: join(process.env.RUNNER_TEMP || tmpdir(), 'pmd-analysis'),
    cwd: input('working-directory', '.')
  };
}

/**
 * The ref the ratchet compares against.
 *
 * The target branch tip, not the merge base, and that is deliberate: the
 * checkout of a pull request is the merge result, so a violation another change
 * added to the same file since the merge base appears on both sides and cancels
 * out. Comparing against the merge base would blame this change for it.
 *
 * @return {string} The base ref, or an empty string when the event names none
 */
export function resolveBaseRef() {
  const explicit = input('base-ref');
  if (explicit) {
    return explicit;
  }
  const baseBranch = (process.env.GITHUB_BASE_REF || '').trim();
  return baseBranch ? `origin/${baseBranch}` : '';
}

/**
 * Which scan a run performs, given what changed.
 *
 * A full scan is informational: with no base to compare against there is
 * nothing to ratchet, so the value is proving the ruleset still parses and runs
 * rather than failing anyone over findings the change did not introduce.
 *
 * @param {{ mode: string, baseRef: string }} config Resolved configuration
 * @param {{ apexFiles: string[], configFiles: string[] }} changes What the diff held
 * @return {{ scan: 'diff'|'full'|'none', reason: string }} The scan to run and, for a full one, how to word why
 * @throws {ConfigError} When `mode: diff` was asked for with no base to diff against
 */
export function planScan(config, changes) {
  if (config.mode === 'full') {
    return {scan: 'full', reason: '`mode: full` was requested'};
  }

  if (!config.baseRef) {
    if (config.mode === 'diff') {
      throw new ConfigError(
        'No base ref to ratchet against. `mode: diff` needs either a pull request event, ' +
        'which supplies the target branch, or an explicit `base-ref` input.'
      );
    }
    return {scan: 'full', reason: 'this run has no base branch to compare against'};
  }

  if (changes.apexFiles.length > 0) {
    return {scan: 'diff', reason: ''};
  }
  if (changes.configFiles.length > 0) {
    return {scan: 'full', reason: `configuration changed (${changes.configFiles.join(', ')}) with no source changes`};
  }
  return {scan: 'none', reason: 'nothing analyzable changed'};
}
