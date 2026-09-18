import {existsSync}                                                             from 'node:fs';
import {classifyChanges, isScannedPath}                                         from '../lib/apex.mjs';
import {commentConfig, updateCommentSection}                                    from '../lib/comment.mjs';
import {planScan, resolveConfig}                                                from '../lib/config.mjs';
import {error, setOutput, summary, warn}                                        from '../lib/core.mjs';
import {changedPaths}                                                           from '../lib/exec.mjs';
import {failureMessage}                                                         from '../lib/inputs.mjs';
import {installPmd, renamedPaths, scanBaseVersions, scanDirectories, scanFiles} from '../lib/pmd.mjs';
import {
  renderComment,
  renderFullScanComment,
  renderFullScanSummary,
  renderNothingToDo,
  renderSummary
}                                                                               from '../lib/report.mjs';
import {compareScans}                                                           from '../lib/ratchet.mjs';

/**
 * Runs PMD over what a change touched and reports it: as this job's verdict, as
 * a section of the shared pull request comment, and as the job summary.
 *
 * See `lib/ratchet.mjs` for why the run analyzes the same files twice.
 */

/**
 * Picks the scan the diff warrants, runs it, reports it.
 *
 * @return {Promise<void>}
 */
async function main() {
  const config = resolveConfig();
  const comment = commentConfig();

  // Read from git rather than the API: this action documents a full-history
  // checkout, so `base..HEAD` is exactly what merging would change, with no
  // dependency on a token or on another job's outputs that a single-job re-run
  // would have lost.
  const changed = config.baseRef
    ? await changedPaths(config.baseRef, 'HEAD', [], {cwd: config.cwd, relative: true})
    : [];
  const changes = classifyChanges(changed, config, (path) => existsSync(within(config.cwd, path)));
  const plan = planScan(config, changes);

  if (plan.scan === 'none') {
    console.log('No source or configuration changed; nothing to analyze.');
    await updateCommentSection(config.section, renderNothingToDo(config.label), comment);
    await report({outcome: 'skipped', newViolations: 0, preexisting: 0, files: 0});
    return;
  }

  const pmdBin = await installPmd(config);

  if (plan.scan === 'full') {
    await fullScan(pmdBin, config, comment, plan.reason);
    return;
  }
  await diffAwareScan(pmdBin, config, comment, changes.sourceFiles);
}

/**
 * Analyzes the changed files against their base versions and fails the run when
 * a (file, rule) pair gained violations.
 *
 * @param {string} pmdBin Path to the PMD executable
 * @param {object} config Resolved configuration
 * @param {object} comment Comment configuration
 * @param {string[]} sourceFiles Repository-relative changed source files
 * @return {Promise<void>}
 */
async function diffAwareScan(pmdBin, config, comment, sourceFiles) {
  console.log(`Analyzing ${sourceFiles.length} changed file(s) against ${config.baseRef}.`);

  const head = await scanFiles(pmdBin, sourceFiles, 'head', config);
  const renames = await renamedPaths(
    config.baseRef,
    (path) => isScannedPath(path, config.sourceDirs, config.extensions),
    {cwd: config.cwd}
  );
  const base = await scanBaseVersions(pmdBin, sourceFiles, {...config, renames});

  const {gained, newTotal, preexisting, baseCounts} = compareScans(head.violations, base.violations);

  reportProcessingErrors([...head.processingErrors, ...base.processingErrors]);
  await updateCommentSection(config.section, renderComment({
    label: config.label,
    fileCount: sourceFiles.length,
    gained,
    newTotal,
    preexisting,
    maxListed: config.maxListed,
    ruleset: config.ruleset,
    failOnNew: config.failOnNew
  }), comment);
  await summary(renderSummary({
    label: config.label,
    headViolations: head.violations,
    baseCounts,
    newTotal,
    preexisting
  }));

  await report({
    outcome: newTotal > 0 && config.failOnNew ? 'failed' : 'passed',
    newViolations: newTotal,
    preexisting,
    files: sourceFiles.length,
    reportPath: head.reportPath
  });

  if (newTotal > 0) {
    const message = `${config.label}: ${newTotal} new violation(s) in the changed files.`;
    if (config.failOnNew) {
      error(message);
      process.exitCode = 1;
    } else {
      warn(`${message} \`fail-on-new\` is off, so this does not fail the run.`);
    }
  }
}

/**
 * Scans the source directories whole. Reports findings but never fails: there
 * is no base to ratchet against, so the value here is proving the ruleset
 * parses and runs.
 *
 * @param {string} pmdBin Path to the PMD executable
 * @param {object} config Resolved configuration
 * @param {object} comment Comment configuration
 * @param {string} reason Why a full scan is what this run does
 * @return {Promise<void>}
 */
async function fullScan(pmdBin, config, comment, reason) {
  console.log(`Running a full informational scan of ${config.sourceDirs.join(', ')} (${reason}).`);

  const {violations, processingErrors, reportPath} = await scanDirectories(pmdBin, config.sourceDirs, config);

  reportProcessingErrors(processingErrors);
  await updateCommentSection(
    config.section,
    renderFullScanComment({label: config.label, reason, violations}),
    comment
  );
  await summary(renderFullScanSummary({label: config.label, violations}));
  await report({
    outcome: 'passed',
    newViolations: 0,
    preexisting: violations.length,
    files: 0,
    reportPath
  });
}

/**
 * Publishes the action's outputs.
 *
 * @param {{ outcome: string, newViolations: number, preexisting: number, files: number, reportPath?: string }} result What the run found
 * @return {Promise<void>}
 */
async function report(result) {
  await setOutput('outcome', result.outcome);
  await setOutput('new-violations', result.newViolations);
  await setOutput('preexisting-violations', result.preexisting);
  await setOutput('files-analyzed', result.files);
  await setOutput('report-path', result.reportPath ?? '');
}

/**
 * Surfaces files PMD could not analyze. Warnings rather than failures: the
 * parse that matters is the compiler's, wherever the code is actually built.
 *
 * @param {Array<{ filename?: string, message?: string }>} processingErrors PMD report processing errors
 * @return {void}
 */
function reportProcessingErrors(processingErrors) {
  for (const processingError of processingErrors) {
    warn(`PMD could not analyze ${processingError.filename}: ${processingError.message}`);
  }
}

/**
 * Resolves a path the diff reported against the directory the action was
 * pointed at. Every path in play is relative to that directory — the diff is
 * taken with `--relative` for exactly that reason — so this is only needed to
 * test one for existence from a process whose own cwd is elsewhere.
 *
 * @param {string} cwd Working directory the action was pointed at
 * @param {string} path Path relative to it
 * @return {string} Path to test on disk
 */
function within(cwd, path) {
  return cwd === '.' ? path : `${cwd.replace(/\/+$/, '')}/${path}`;
}

try {
  await main();
} catch (thrown) {
  error(failureMessage(thrown));
  if (thrown.output) {
    await summary(`## PMD failed to run\n\n\`\`\`\n${String(thrown.output).slice(-3000)}\n\`\`\``);
  }
  await setOutput('outcome', 'failed');
  process.exitCode = 1;
}
