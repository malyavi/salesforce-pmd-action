import {describe, it}                                             from 'node:test';
import assert                                                     from 'node:assert/strict';
import {classifyChanges, globToRegExp, isScannedPath, matchesAny} from '../lib/apex.mjs';

/**
 * Which paths the scan has anything to say about. Getting this wrong is quiet
 * in both directions: too narrow and the check passes without looking, too wide
 * and it fails on a fixture nobody deploys.
 */

const DIRS = ['force-app', 'unpackaged-setup'];
const EXTENSIONS = ['cls', 'trigger'];

describe('isScannedPath', () => {
  it('accepts Apex inside the named directories', () => {
    assert.ok(isScannedPath('force-app/main/default/classes/AccountService.cls', DIRS, EXTENSIONS));
    assert.ok(isScannedPath('unpackaged-setup/main/default/triggers/Thing.trigger', DIRS, EXTENSIONS));
  });

  it('refuses Apex outside them, which is what keeps a sample tree out of the scan', () => {
    assert.equal(isScannedPath('unpackaged-samples/main/default/classes/Sample.cls', DIRS, EXTENSIONS), false);
  });

  it('refuses a file of another extension inside them, once a caller has narrowed it', () => {
    assert.equal(isScannedPath('force-app/main/default/lwc/contactList/contactList.js', DIRS, EXTENSIONS), false);
    assert.equal(isScannedPath('force-app/main/default/classes/AccountService.cls-meta.xml', DIRS, EXTENSIONS), false);
  });

  it('covers every path under the directories when no extension was named', () => {
    // The default. A source directory holds far more than Apex, and a change
    // to any of it is a change worth looking at; PMD skips what it cannot
    // parse, so the filter earns nothing and costs whatever it forgot.
    assert.ok(isScannedPath('force-app/main/default/flows/Onboard.flow-meta.xml', DIRS, []));
    assert.ok(isScannedPath('force-app/main/default/lwc/contactList/contactList.js', DIRS, []));
    assert.equal(isScannedPath('unpackaged-samples/main/default/flows/Sample.flow-meta.xml', DIRS, []), false);
  });

  it('matches an extension whatever its case', () => {
    assert.ok(isScannedPath('force-app/x.CLS', DIRS, EXTENSIONS));
  });

  it('accepts a leading ./ or a trailing slash on a directory, as a caller writes them', () => {
    assert.ok(isScannedPath('force-app/x.cls', ['./force-app/'], EXTENSIONS));
  });

  it('covers the whole tree when the caller names no directory', () => {
    assert.ok(isScannedPath('anywhere/x.cls', [], EXTENSIONS));
    assert.ok(isScannedPath('anywhere/x.cls', ['.'], EXTENSIONS));
  });

  it('does not mistake a directory for a prefix of another', () => {
    // `force-app-legacy/` is not inside `force-app/`.
    assert.equal(isScannedPath('force-app-legacy/x.cls', ['force-app'], EXTENSIONS), false);
  });
});

describe('globToRegExp', () => {
  it('keeps * inside one path segment', () => {
    assert.ok(globToRegExp('config/*.xml').test('config/pmd-ruleset.xml'));
    assert.equal(globToRegExp('config/*.xml').test('config/nested/pmd-ruleset.xml'), false);
  });

  it('lets ** cross segments', () => {
    assert.ok(globToRegExp('.github/**').test('.github/workflows/pr-validation.yml'));
  });

  it('lets **/ match nothing at all, so the obvious pattern finds a file at the root', () => {
    assert.ok(globToRegExp('**/ruleset.xml').test('ruleset.xml'));
    assert.ok(globToRegExp('**/ruleset.xml').test('config/pmd/ruleset.xml'));
  });

  it('treats a dot as a literal rather than as any character', () => {
    assert.equal(globToRegExp('config/pmd.xml').test('config/pmdxxml'), false);
  });

  it('anchors, so a pattern does not match a longer path that merely contains it', () => {
    assert.equal(globToRegExp('config/pmd.xml').test('vendor/config/pmd.xml'), false);
  });
});

describe('matchesAny', () => {
  it('is false for an empty pattern list rather than true', () => {
    assert.equal(matchesAny('anything', []), false);
  });
});

describe('classifyChanges', () => {
  const config = {sourceDirs: DIRS, extensions: EXTENSIONS, configPaths: ['config/pmd-ruleset.xml']};

  it('splits the diff into Apex to scan and configuration worth scanning for', () => {
    const changed = [
      'force-app/main/default/classes/A.cls',
      'config/pmd-ruleset.xml',
      'README.md'
    ];
    const {sourceFiles, configFiles} = classifyChanges(changed, config);
    assert.deepEqual(sourceFiles, ['force-app/main/default/classes/A.cls']);
    assert.deepEqual(configFiles, ['config/pmd-ruleset.xml']);
  });

  it('drops a deleted file, which is in the diff but has nothing to analyze', () => {
    const changed = ['force-app/A.cls', 'force-app/B.cls'];
    const {sourceFiles} = classifyChanges(changed, config, (path) => path !== 'force-app/B.cls');
    assert.deepEqual(sourceFiles, ['force-app/A.cls']);
  });
});
