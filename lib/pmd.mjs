import {existsSync}                   from 'node:fs';
import {mkdir, readFile, writeFile}   from 'node:fs/promises';
import {dirname, join}                from 'node:path';
import {run}                          from './exec.mjs';
import {warn}                         from './core.mjs';

/**
 * Getting PMD onto the runner and reading what it found.
 *
 * PMD is a JVM tool distributed as a release zip rather than an npm package, so
 * it is downloaded and unpacked once per job. The download is pinned to a
 * version by default, because an analyzer that updates itself turns a ratchet
 * into a coin toss: a new rule in a new release arrives as violations the pull
 * request under it did not introduce.
 */

/**
 * Downloads and unpacks a PMD release, skipping the work when an earlier step
 * of the same job already left it in place.
 *
 * @param {{ version: string, downloadUrl: string, workDir: string }} config Version to install, an optional mirror, and where to put it
 * @return {Promise<string>} Path to the PMD executable
 * @throws {Error} When the release archive cannot be downloaded
 */
export async function installPmd({version, downloadUrl, workDir}) {
  const home = join(workDir, `pmd-bin-${version}`);
  const bin = join(home, 'bin', 'pmd');
  if (existsSync(bin)) {
    return bin;
  }

  const url = downloadUrl || releaseUrl(version);
  console.log(`Downloading PMD ${version} from ${url}…`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`PMD ${version} download failed: ${response.status} ${response.statusText} for ${url}`);
  }

  await mkdir(workDir, {recursive: true});
  const zipPath = join(workDir, 'pmd.zip');
  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
  await run('unzip', ['-q', '-o', zipPath, '-d', workDir], {echo: false});

  if (!existsSync(bin)) {
    throw new Error(
      `PMD ${version} unpacked without a ${bin}. A mirror set through \`pmd-download-url\` has to ` +
      'hold the same layout as the official distribution zip.'
    );
  }
  return bin;
}

/**
 * The official download URL for a version.
 *
 * The `pmd_releases%2F` in the path is a tag name with a slash in it, so the
 * slash is percent-encoded while the rest of the path is not.
 *
 * @param {string} version PMD version
 * @return {string} Release archive URL
 */
export function releaseUrl(version) {
  return 'https://github.com/pmd/pmd/releases/download/' +
    `pmd_releases%2F${version}/pmd-dist-${version}-bin.zip`;
}

/**
 * Runs one PMD pass over an explicit file list.
 *
 * `--no-fail-on-violation` because the violations are this action's output, not
 * PMD's verdict to give; `--no-fail-on-error` because a file PMD cannot parse
 * should surface as a warning on the report rather than abort the comparison —
 * whatever compiles the code is a better judge of whether it is valid.
 *
 * @param {string} pmdBin Path to the PMD executable
 * @param {string[]} files Files to analyze, as paths PMD can open
 * @param {string} label Distinguishes this pass's file list and report on disk
 * @param {{ ruleset: string, workDir: string, extraArgs: string[], cwd?: string }} config Ruleset, scratch directory and any extra PMD arguments
 * @return {Promise<{ violations: Array<object>, processingErrors: Array<object>, reportPath: string }>} Parsed report
 */
export async function scanFiles(pmdBin, files, label, config) {
  const listPath = join(config.workDir, `files-${label}.txt`);
  const reportPath = join(config.workDir, `report-${label}.json`);
  await mkdir(config.workDir, {recursive: true});
  await writeFile(listPath, files.join('\n'), 'utf8');

  await run(pmdBin, [
    'check',
    '--file-list', listPath,
    '--rulesets', config.ruleset,
    '--format', 'json',
    '--report-file', reportPath,
    '--no-fail-on-violation',
    '--no-fail-on-error',
    '--no-progress',
    ...config.extraArgs
  ], {cwd: config.cwd});

  return {...await readReport(reportPath), reportPath};
}

/**
 * Runs one PMD pass over whole directories, for the informational scan.
 *
 * @param {string} pmdBin Path to the PMD executable
 * @param {string[]} dirs Directories to analyze
 * @param {{ ruleset: string, workDir: string, extraArgs: string[], cwd?: string }} config Ruleset, scratch directory and any extra PMD arguments
 * @return {Promise<{ violations: Array<object>, processingErrors: Array<object>, reportPath: string }>} Parsed report
 */
export async function scanDirectories(pmdBin, dirs, config) {
  const reportPath = join(config.workDir, 'report-full.json');
  await mkdir(config.workDir, {recursive: true});

  await run(pmdBin, [
    'check',
    '--dir', dirs.join(','),
    '--rulesets', config.ruleset,
    '--format', 'json',
    '--report-file', reportPath,
    '--no-fail-on-violation',
    '--no-fail-on-error',
    '--no-progress',
    ...config.extraArgs
  ], {cwd: config.cwd});

  return {...await readReport(reportPath), reportPath};
}

/**
 * Materializes the base versions of the changed files and scans them.
 *
 * The copies keep their repository-relative paths under a mirror directory, so
 * both scans see the same layout and neither gets cross-file resolution the
 * other lacks — an asymmetry there would fabricate ratchet differences.
 *
 * @param {string} pmdBin Path to the PMD executable
 * @param {string[]} apexFiles Repository-relative changed Apex files
 * @param {{ baseRef: string, renames: Map<string, string>, ruleset: string, workDir: string, extraArgs: string[], cwd?: string }} config Base ref to read from, the rename map, and the scan configuration
 * @return {Promise<{ violations: Array<object>, processingErrors: Array<object> }>} Base-side results, keyed by the head path
 */
export async function scanBaseVersions(pmdBin, apexFiles, config) {
  const mirror = join(config.workDir, 'base');
  const mirrored = [];

  for (const path of apexFiles) {
    // A moved file still has a base version, under the name it had then.
    // Reading `baseRef:<new path>` would miss it and count every violation the
    // file already carried as new — which is what a pure rename would
    // otherwise report, having changed nothing at all.
    const basePath = config.renames.get(path) ?? path;
    let content;
    try {
      // `<ref>:./<path>` resolves the path against the working directory, which
      // is what makes a caller pointed at a subdirectory read the right file;
      // `<ref>:<path>` would always be read from the repository root.
      content = await run('git', ['show', `${config.baseRef}:./${basePath}`], {
        echo: false,
        capture: true,
        cwd: config.cwd
      });
    } catch {
      // The file is not on the base at all — added by this change, so every
      // violation in it is new by definition.
      continue;
    }
    // Keyed by the *head* path, so the two scans' pairs line up.
    const copy = join(mirror, path);
    await mkdir(dirname(copy), {recursive: true});
    await writeFile(copy, content, 'utf8');
    mirrored.push(copy);
  }

  if (mirrored.length === 0) {
    return {violations: [], processingErrors: []};
  }

  const results = await scanFiles(pmdBin, mirrored, 'base', config);
  return {...results, violations: stripMirrorPrefix(results.violations, `${mirror}/`)};
}

/**
 * Rewrites mirrored paths back to repository-relative ones so the base and head
 * violations key on the same files.
 *
 * @param {Array<object>} violations Violations from the base scan
 * @param {string} prefix The mirror directory, with its trailing slash
 * @return {Array<object>} The same violations, with `file` made relative again
 */
export function stripMirrorPrefix(violations, prefix) {
  return violations.map((violation) => violation.file.startsWith(prefix)
    ? {...violation, file: violation.file.slice(prefix.length)}
    : violation);
}

/**
 * Maps each renamed file's head path to the path it had on the base.
 *
 * git reports a moved file once, under its new name, because it detects the
 * rename. The base side has to undo that to find the file's previous content —
 * without it a pure move reports every violation the file already carried as
 * new, and the ratchet fails a change that touched no logic whatsoever.
 *
 * **Deliberately unfiltered by pathspec.** Restricting the diff to the source
 * directories hides the deletion half of a move *into* one of them, and git
 * reports what is left as a plain add — which is the bug this exists to fix,
 * reintroduced. The destination is filtered in JavaScript instead, once both
 * halves have been paired.
 *
 * @param {string} baseRef Base ref the diff is taken against
 * @param {(path: string) => boolean} isRelevant Whether a destination path is one the scan covers
 * @param {{ cwd?: string }} [options] Where to run git
 * @return {Promise<Map<string, string>>} Head path to base path, for renamed files the scan covers
 */
export async function renamedPaths(baseRef, isRelevant, options = {}) {
  let output;
  try {
    output = await run('git', ['diff', '--find-renames', '--relative', '--name-status', `${baseRef}..HEAD`], {
      echo: false,
      cwd: options.cwd
    });
  } catch (thrown) {
    warn(`Could not read renames from git; a renamed file will report its existing findings as new. ${thrown.message}`);
    return new Map();
  }

  const renames = new Map();
  for (const line of output.split('\n')) {
    // `R<similarity>\t<old>\t<new>`; anything else is not a rename.
    const [status, from, to] = line.split('\t');
    if (status?.startsWith('R') && from && to && isRelevant(to.trim())) {
      renames.set(to.trim(), from.trim());
    }
  }
  if (renames.size > 0) {
    console.log(`${renames.size} renamed file(s); ratcheting each against its previous path.`);
  }
  return renames;
}

/**
 * Parses a PMD JSON report into flat violations.
 *
 * @param {string} reportPath Report file to read
 * @return {Promise<{ violations: Array<object>, processingErrors: Array<object> }>} Violations with the filename folded in
 */
export async function readReport(reportPath) {
  return parseReport(JSON.parse(await readFile(reportPath, 'utf8')));
}

/**
 * Flattens a parsed PMD report.
 *
 * @param {{ files?: Array<object>, processingErrors?: Array<object> }} report The report as PMD wrote it
 * @return {{ violations: Array<object>, processingErrors: Array<object> }} Violations with the filename folded in
 */
export function parseReport(report) {
  const violations = [];
  for (const file of report.files || []) {
    for (const violation of file.violations || []) {
      violations.push({
        file: file.filename,
        line: violation.beginline,
        rule: violation.rule,
        priority: violation.priority,
        description: violation.description,
        url: violation.externalInfoUrl
      });
    }
  }
  return {violations, processingErrors: report.processingErrors || []};
}
