import {describe, it} from 'node:test';
import assert          from 'node:assert/strict';
import {compareScans}  from '../lib/ratchet.mjs';
import {
  renderComment,
  renderFullScanComment,
  renderFullScanSummary,
  renderNothingToDo,
  renderSummary
}                      from '../lib/report.mjs';

/**
 * What a reader is told. A report that says the wrong thing about a passing run
 * is as much a defect as a wrong verdict, because it is what somebody acts on.
 */

const violation = (file, rule, line, priority = 3) => ({
  file,
  rule,
  line,
  priority,
  description: `${rule} at ${line}`,
  url: `https://docs.pmd-code.org/${rule}`
});

const base = {label: 'PMD (Apex)', maxListed: 20, ruleset: 'config/pmd-ruleset.xml', failOnNew: true};

describe('renderComment', () => {
  it('says so in one line when nothing was gained', () => {
    const comment = renderComment({...base, fileCount: 3, gained: [], newTotal: 0, preexisting: 0});
    assert.match(comment, /^:white_check_mark: \*\*PMD \(Apex\) passed\*\*: no new violations in 3 changed file\(s\)\.$/);
  });

  it('mentions inherited violations on a passing run, so a clean verdict is not mistaken for a clean file', () => {
    const comment = renderComment({...base, fileCount: 1, gained: [], newTotal: 0, preexisting: 4});
    assert.match(comment, /4 pre-existing violation\(s\)/);
    assert.match(comment, /do not fail the check/);
  });

  it('lists the new violations with their file, line and rule', () => {
    const {gained, newTotal, preexisting} = compareScans([violation('A.cls', 'ApexDoc', 7)], []);
    const comment = renderComment({...base, fileCount: 1, gained, newTotal, preexisting});
    assert.match(comment, /:x: \*\*PMD \(Apex\)\*\*: 1 new violation/);
    assert.match(comment, /- `A\.cls:7` \*\*ApexDoc\*\* — ApexDoc at 7/);
  });

  it('notes on a pair that already had hits that the listed lines include the old ones', () => {
    const head = [violation('A.cls', 'R', 1), violation('A.cls', 'R', 2)];
    const {gained, newTotal, preexisting} = compareScans(head, [violation('A.cls', 'R', 1)]);
    const comment = renderComment({...base, fileCount: 1, gained, newTotal, preexisting});
    // Line-level attribution across an edit is guesswork; the count is what the
    // ratchet asserts, and the note is what stops a reader chasing the wrong line.
    assert.equal(comment.match(/predate the change/g).length, 1);
  });

  it('caps the list and says how many it left out', () => {
    const head = Array.from({length: 5}, (unused, index) => violation('A.cls', `R${index}`, index));
    const {gained, newTotal, preexisting} = compareScans(head, []);
    const comment = renderComment({...base, maxListed: 2, fileCount: 1, gained, newTotal, preexisting});
    assert.equal(comment.match(/^- `A\.cls/gm).length, 2);
    assert.match(comment, /…and 3 more/);
  });

  it('warns rather than fails when fail-on-new is off', () => {
    const {gained, newTotal, preexisting} = compareScans([violation('A.cls', 'R', 1)], []);
    const comment = renderComment({...base, failOnNew: false, fileCount: 1, gained, newTotal, preexisting});
    assert.match(comment, /^:warning:/);
  });

  it('names the ruleset, so the suppression advice can be acted on', () => {
    const {gained, newTotal, preexisting} = compareScans([violation('A.cls', 'R', 1)], []);
    const comment = renderComment({...base, fileCount: 1, gained, newTotal, preexisting});
    assert.match(comment, /@SuppressWarnings\('PMD\.RuleName'\)/);
    assert.match(comment, /`config\/pmd-ruleset\.xml`/);
  });
});

describe('renderSummary', () => {
  it('marks each row as new or pre-existing, attributing the base count first', () => {
    const head = [violation('A.cls', 'R', 1), violation('A.cls', 'R', 2)];
    const {baseCounts, newTotal, preexisting} = compareScans(head, [violation('A.cls', 'R', 1)]);
    const rows = renderSummary({label: 'PMD (Apex)', headViolations: head, baseCounts, newTotal, preexisting})
      .split('\n')
      .filter((line) => line.startsWith('| `A.cls`'));
    assert.match(rows[0], /pre-existing/);
    assert.match(rows[1], /\*\*new\*\*/);
  });

  it('links the rule to its documentation, and copes with a report that carried no link', () => {
    const withUrl = violation('A.cls', 'R', 1);
    const withoutUrl = {...violation('B.cls', 'S', 1), url: undefined};
    const summary = renderSummary({
      label: 'PMD',
      headViolations: [withUrl, withoutUrl],
      baseCounts: new Map(),
      newTotal: 2,
      preexisting: 0
    });
    assert.match(summary, /\[R\]\(https:\/\/docs\.pmd-code\.org\/R\)/);
    assert.match(summary, /\| S \|/);
  });

  it('says plainly when the touched files carry nothing at all', () => {
    const summary = renderSummary({
      label: 'PMD',
      headViolations: [],
      baseCounts: new Map(),
      newTotal: 0,
      preexisting: 0
    });
    assert.match(summary, /carry no violations at all/);
  });
});

describe('renderFullScanComment', () => {
  it('reports the count and says it fails nothing', () => {
    const comment = renderFullScanComment({
      label: 'PMD (Apex)',
      reason: 'configuration changed with no source changes',
      violations: [violation('A.cls', 'R', 1)]
    });
    assert.match(comment, /^:white_check_mark:/);
    assert.match(comment, /configuration changed with no source changes/);
    assert.match(comment, /do not fail this check/);
  });
});

describe('renderFullScanSummary', () => {
  it('counts by rule, most frequent first', () => {
    const violations = [
      violation('A.cls', 'ApexDoc', 1),
      violation('B.cls', 'ApexDoc', 1),
      violation('C.cls', 'EmptyCatchBlock', 1)
    ];
    const rows = renderFullScanSummary({label: 'PMD', violations})
      .split('\n')
      .filter((line) => line.startsWith('| ') && !line.startsWith('| Rule') && !line.startsWith('| ---'));
    assert.deepEqual(rows, ['| ApexDoc | 2 |', '| EmptyCatchBlock | 1 |']);
  });
});

describe('renderNothingToDo', () => {
  it('passes with a line that names the check', () => {
    assert.equal(renderNothingToDo('PMD (Apex)'), ':white_check_mark: **PMD (Apex)**: no analyzable changes.');
  });
});
