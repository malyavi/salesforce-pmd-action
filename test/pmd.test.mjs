import {describe, it}                              from 'node:test';
import assert                                       from 'node:assert/strict';
import {parseReport, releaseUrl, stripMirrorPrefix} from '../lib/pmd.mjs';

/**
 * Reading PMD's own output, and fetching PMD itself.
 */

describe('parseReport', () => {
  it('folds the filename into each violation, which is what the ratchet keys on', () => {
    const {violations} = parseReport({
      files: [
        {
          filename: 'force-app/A.cls',
          violations: [
            {beginline: 12, rule: 'ApexDoc', priority: 3, description: 'Missing ApexDoc', externalInfoUrl: 'https://x'}
          ]
        }
      ]
    });
    assert.deepEqual(violations, [{
      file: 'force-app/A.cls',
      line: 12,
      rule: 'ApexDoc',
      priority: 3,
      description: 'Missing ApexDoc',
      url: 'https://x'
    }]);
  });

  it('reads a report with no findings, and one with no files at all', () => {
    assert.deepEqual(parseReport({files: [{filename: 'A.cls', violations: []}]}).violations, []);
    assert.deepEqual(parseReport({}).violations, []);
  });

  it('keeps the processing errors, which are warned about rather than failed on', () => {
    const report = {processingErrors: [{filename: 'A.cls', message: 'Cannot parse'}]};
    assert.deepEqual(parseReport(report).processingErrors, [{filename: 'A.cls', message: 'Cannot parse'}]);
  });
});

describe('stripMirrorPrefix', () => {
  it('rewrites a mirrored path back so the two scans key on the same file', () => {
    const violations = [{file: '/tmp/pmd/base/force-app/A.cls', rule: 'R'}];
    assert.deepEqual(
      stripMirrorPrefix(violations, '/tmp/pmd/base/'),
      [{file: 'force-app/A.cls', rule: 'R'}]
    );
  });

  it('leaves a path that was never mirrored alone', () => {
    const violations = [{file: 'force-app/A.cls', rule: 'R'}];
    assert.deepEqual(stripMirrorPrefix(violations, '/tmp/pmd/base/'), violations);
  });
});

describe('releaseUrl', () => {
  it('percent-encodes the slash in the tag name and nothing else', () => {
    // `pmd_releases/7.27.0` is one tag; the slash inside it is part of the name
    // rather than a path separator, so only that one is encoded.
    assert.equal(
      releaseUrl('7.27.0'),
      'https://github.com/pmd/pmd/releases/download/pmd_releases%2F7.27.0/pmd-dist-7.27.0-bin.zip'
    );
  });
});
