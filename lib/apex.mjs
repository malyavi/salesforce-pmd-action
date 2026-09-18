/**
 * Which of a diff's paths this action has anything to say about.
 *
 * Two questions, and they are not the same one: whether a path is source the
 * scan covers, and whether a path is configuration whose change should make the
 * scan run even though no source moved.
 */

/**
 * Whether a path is source the scan covers: inside one of the directories the
 * caller named and, unless the caller cleared the filter, of one of the
 * extensions it named.
 *
 * The directory check is what keeps a vendored copy, a fixture or a sample tree
 * out of the scan. The extension check is what PMD has a language for, and the
 * default is drawn from the distribution rather than guessed — measured against
 * PMD 7.27.0:
 *
 * - `.cls`, `.trigger` — the Apex language, and every rule in the default
 *   ruleset.
 * - `.page`, `.component` — a first-class Visualforce language with its own
 *   rule categories, `category/visualforce/security.xml` among them. No rule in
 *   the Apex ruleset fires on one, so these cost a caller nothing until they
 *   add the Visualforce categories — and a caller who adds them should not then
 *   have to discover a filter that was quietly excluding the files.
 * - `.cmp`, `.app`, `.evt`, `.email` — **no language at all.** PMD does not map
 *   an Aura bundle or an email template to anything, and answers a file list
 *   holding only those with "No files to analyze".
 * - `.js` — an Ecmascript language exists, but its parser predates ES6: an LWC
 *   module is four parse errors ("identifier is a reserved word: import") and
 *   then a violation invented from the wreckage. Worse than not looking.
 * - `.html`, `.xml` — languages exist; their rule categories are about web
 *   pages and about Maven and WSDL documents, and say nothing about an LWC
 *   template or a metadata file.
 *
 * An empty list clears the filter, for a caller whose ruleset reaches further
 * than this list does.
 *
 * @param {string} path Repository-relative path
 * @param {string[]} sourceDirs Directories the scan covers
 * @param {string[]} extensions Extensions to narrow to, without the dot; empty covers every path
 * @return {boolean} True when the path is one the scan covers
 */
export function isScannedPath(path, sourceDirs, extensions) {
  const suffixes = extensions.map((extension) => `.${extension.replace(/^\./, '').toLowerCase()}`);
  if (suffixes.length > 0 && !suffixes.some((suffix) => path.toLowerCase().endsWith(suffix))) {
    return false;
  }
  return sourceDirs.length === 0 || sourceDirs.some((dir) => underDirectory(path, dir));
}

/**
 * Whether a path sits inside a directory, where '.' means the whole tree.
 *
 * @param {string} path Repository-relative path
 * @param {string} dir Directory, with or without a trailing slash
 * @return {boolean} True when the path is under the directory
 */
function underDirectory(path, dir) {
  const normalized = dir.replace(/^\.\//, '').replace(/\/+$/, '');
  return normalized === '' || normalized === '.' || path.startsWith(`${normalized}/`);
}

/**
 * Whether a path matches any of a list of glob patterns.
 *
 * A deliberately small glob: `*` inside a path segment, `**` across segments,
 * and `?` for one character. Enough for the patterns a caller writes for its
 * own configuration files, and small enough to need no dependency.
 *
 * @param {string} path Repository-relative path
 * @param {string[]} patterns Glob patterns
 * @return {boolean} True when the path matches one of them
 */
export function matchesAny(path, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

/**
 * Compiles one glob into an anchored regular expression.
 *
 * @param {string} pattern Glob pattern
 * @return {RegExp} The compiled pattern
 */
export function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` also matches nothing at all, so `**/x.xml` finds `x.xml` at the
        // root as well as further down. Without that a caller writing the
        // obvious pattern misses the file they were thinking of.
        index++;
        if (pattern[index + 1] === '/') {
          index++;
          source += '(?:[^\\0]*\\/)?';
        } else {
          source += '[^\\0]*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/**
 * The paths a run has to look at, split into the source to scan and the
 * configuration that makes an otherwise source-free change worth scanning.
 *
 * @param {string[]} changed Repository-relative paths the diff reported
 * @param {{ sourceDirs: string[], extensions: string[], configPaths: string[] }} config Resolved configuration
 * @param {(path: string) => boolean} [exists] Whether a path is still on disk; a deleted file is in the diff but has nothing to analyze
 * @return {{ sourceFiles: string[], configFiles: string[] }} The two lists
 */
export function classifyChanges(changed, config, exists = () => true) {
  const sourceFiles = changed.filter(
    (path) => isScannedPath(path, config.sourceDirs, config.extensions) && exists(path)
  );
  const configFiles = changed.filter((path) => matchesAny(path, config.configPaths));
  return {sourceFiles, configFiles};
}
