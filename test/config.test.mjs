import {afterEach, describe, it}                        from 'node:test';
import assert                                           from 'node:assert/strict';
import {MODES, planScan, resolveBaseRef, resolveConfig} from '../lib/config.mjs';
import {ConfigError}                                    from '../lib/inputs.mjs';

/**
 * What the action decides before it runs anything: which files count, what to
 * compare against, and which of the two scans this run is.
 */

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  }
  delete process.env.GITHUB_BASE_REF;
});

describe('resolveConfig', () => {
  it('defaults to a Salesforce DX layout with PMD\'s own quickstart ruleset', () => {
    const config = resolveConfig();
    assert.deepEqual(config.sourceDirs, ['force-app']);
    assert.deepEqual(config.extensions, []);
    assert.equal(config.ruleset, 'rulesets/apex/quickstart.xml');
    assert.equal(config.mode, 'auto');
    assert.equal(config.failOnNew, true);
    assert.equal(config.section, 'pmd');
  });

  it('counts the ruleset as configuration whether or not the caller listed it', () => {
    process.env.INPUT_RULESET = 'config/pmd-ruleset.xml';
    assert.deepEqual(resolveConfig().configPaths, ['config/pmd-ruleset.xml']);

    process.env.INPUT_CONFIG_PATHS = '.github/workflows/pr-validation.yml, config/pmd-ruleset.xml';
    assert.deepEqual(
      resolveConfig().configPaths,
      ['.github/workflows/pr-validation.yml', 'config/pmd-ruleset.xml'],
      'A ruleset the caller also listed is not counted twice.'
    );
  });

  it('refuses an unknown mode by name, listing the ones there are', () => {
    process.env.INPUT_MODE = 'ratchet';
    assert.throws(() => resolveConfig(), (thrown) => {
      assert.ok(thrown instanceof ConfigError);
      assert.match(thrown.message, /Unknown `mode` "ratchet"/);
      for (const mode of MODES) {
        assert.match(thrown.message, new RegExp(mode));
      }
      return true;
    });
  });

  it('accepts a mode in any case, since a workflow author writes what reads well', () => {
    process.env.INPUT_MODE = 'FULL';
    assert.equal(resolveConfig().mode, 'full');
  });
});

describe('resolveBaseRef', () => {
  it('takes the pull request\'s base branch from the event', () => {
    process.env.GITHUB_BASE_REF = 'main';
    assert.equal(resolveBaseRef(), 'origin/main');
  });

  it('prefers an explicit input, which is how a push event gets a ratchet', () => {
    process.env.GITHUB_BASE_REF = 'main';
    process.env.INPUT_BASE_REF = 'HEAD~1';
    assert.equal(resolveBaseRef(), 'HEAD~1');
  });

  it('is empty when the event names no base branch', () => {
    assert.equal(resolveBaseRef(), '');
  });
});

describe('planScan', () => {
  const withBase = {mode: 'auto', baseRef: 'origin/main'};

  it('ratchets when Apex changed', () => {
    assert.deepEqual(
      planScan(withBase, {sourceFiles: ['A.cls'], configFiles: []}).scan,
      'diff'
    );
  });

  it('scans everything when only the configuration changed', () => {
    const plan = planScan(withBase, {sourceFiles: [], configFiles: ['config/pmd-ruleset.xml']});
    assert.equal(plan.scan, 'full');
    // The value of this run is proving the new ruleset parses and executes.
    assert.match(plan.reason, /configuration changed/);
  });

  it('does nothing when neither changed', () => {
    assert.equal(planScan(withBase, {sourceFiles: [], configFiles: []}).scan, 'none');
  });

  it('falls back to a full scan when there is no base to compare against', () => {
    const plan = planScan({mode: 'auto', baseRef: ''}, {sourceFiles: ['A.cls'], configFiles: []});
    assert.equal(plan.scan, 'full');
    assert.match(plan.reason, /no base branch/);
  });

  it('refuses mode: diff with no base, rather than quietly scanning everything', () => {
    assert.throws(
      () => planScan({mode: 'diff', baseRef: ''}, {sourceFiles: ['A.cls'], configFiles: []}),
      (thrown) => {
        assert.ok(thrown instanceof ConfigError);
        assert.match(thrown.message, /`base-ref`/);
        return true;
      }
    );
  });

  it('honours mode: full even when nothing changed at all', () => {
    assert.equal(planScan({mode: 'full', baseRef: ''}, {sourceFiles: [], configFiles: []}).scan, 'full');
  });
});
