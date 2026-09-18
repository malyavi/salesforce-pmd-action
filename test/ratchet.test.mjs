import {describe, it}                                    from 'node:test';
import assert                                            from 'node:assert/strict';
import {compareScans, flattenGained, groupByPair, tally} from '../lib/ratchet.mjs';

/**
 * The ratchet. Everything here exists so that a pull request is judged on what
 * it added rather than on what the file it touched already carried.
 */

const violation = (file, rule, line, priority = 3) => ({
  file,
  rule,
  line,
  priority,
  description: `${rule} at ${line}`
});

describe('tally', () => {
  it('counts per (file, rule) pair, not per file and not per rule', () => {
    const counts = tally([
      violation('A.cls', 'ApexDoc', 1),
      violation('A.cls', 'ApexDoc', 9),
      violation('A.cls', 'CyclomaticComplexity', 1),
      violation('B.cls', 'ApexDoc', 1)
    ]);
    assert.equal(counts.get('A.cls|ApexDoc'), 2);
    assert.equal(counts.get('A.cls|CyclomaticComplexity'), 1);
    assert.equal(counts.get('B.cls|ApexDoc'), 1);
  });
});

describe('groupByPair', () => {
  it('keeps each pair\'s own order, so the first listed violation is the first found', () => {
    const grouped = groupByPair([violation('A.cls', 'R', 10), violation('A.cls', 'R', 2)]);
    assert.deepEqual(grouped.get('A.cls|R').map((entry) => entry.line), [10, 2]);
  });
});

describe('compareScans', () => {
  it('reports nothing for a file whose violations did not grow', () => {
    const head = [violation('A.cls', 'ApexDoc', 12)];
    const base = [violation('A.cls', 'ApexDoc', 4)];
    const {newTotal, preexisting, gained} = compareScans(head, base);
    // The line moved, which is what an edit does; the count did not.
    assert.equal(newTotal, 0);
    assert.equal(preexisting, 1);
    assert.deepEqual(gained, []);
  });

  it('reports only the gain when a pair grew', () => {
    const head = [violation('A.cls', 'ApexDoc', 1), violation('A.cls', 'ApexDoc', 2), violation('A.cls', 'ApexDoc', 3)];
    const base = [violation('A.cls', 'ApexDoc', 1)];
    const {newTotal, preexisting, gained} = compareScans(head, base);
    assert.equal(newTotal, 2);
    assert.equal(preexisting, 1);
    assert.equal(gained[0].before, 1);
    assert.equal(gained[0].added, 2);
  });

  it('counts every violation of a file that is new to the tree', () => {
    const {newTotal, preexisting} = compareScans([violation('New.cls', 'R', 1)], []);
    assert.equal(newTotal, 1);
    assert.equal(preexisting, 0);
  });

  it('reports nothing when a pair lost violations', () => {
    const {newTotal, preexisting} = compareScans([violation('A.cls', 'R', 1)], [violation('A.cls', 'R', 1), violation('A.cls', 'R', 2)]);
    assert.equal(newTotal, 0);
    // Only what is still there counts as inherited; the fixed one is gone.
    assert.equal(preexisting, 1);
  });

  it('treats a different rule in the same file as its own pair', () => {
    const head = [violation('A.cls', 'ApexDoc', 1), violation('A.cls', 'EmptyCatchBlock', 2)];
    const base = [violation('A.cls', 'ApexDoc', 1)];
    const {newTotal, gained} = compareScans(head, base);
    assert.equal(newTotal, 1);
    assert.equal(gained.length, 1);
    assert.equal(gained[0].violations[0].rule, 'EmptyCatchBlock');
  });

  it('cancels out when a renamed file was scanned under its old content', () => {
    // scanBaseVersions keys the base scan by the head path for exactly this
    // reason: a pure rename must report nothing.
    const head = [violation('force-app/new/A.cls', 'ApexDoc', 1)];
    const base = [violation('force-app/new/A.cls', 'ApexDoc', 1)];
    assert.equal(compareScans(head, base).newTotal, 0);
  });
});

describe('flattenGained', () => {
  it('sorts by priority so a cap keeps the findings worth reading', () => {
    const gained = [
      {violations: [violation('A.cls', 'Low', 1, 4)], before: 0},
      {violations: [violation('B.cls', 'High', 1, 1)], before: 0}
    ];
    assert.deepEqual(flattenGained(gained).map((entry) => entry.violation.rule), ['High', 'Low']);
  });

  it('carries each pair\'s base count onto every violation of it', () => {
    const gained = [{violations: [violation('A.cls', 'R', 1), violation('A.cls', 'R', 2)], before: 1}];
    assert.deepEqual(flattenGained(gained).map((entry) => entry.before), [1, 1]);
  });

  it('puts a violation with no priority last rather than first', () => {
    const gained = [
      {violations: [{file: 'A.cls', rule: 'NoPriority', line: 1}], before: 0},
      {violations: [violation('B.cls', 'P3', 1, 3)], before: 0}
    ];
    assert.deepEqual(flattenGained(gained).map((entry) => entry.violation.rule), ['P3', 'NoPriority']);
  });
});
