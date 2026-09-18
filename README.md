# salesforce-pmd-action

Runs [PMD](https://pmd.github.io/) over the Apex a change touched and fails only
on violations **that change introduced**.

A ruleset applied to an existing codebase finds violations that predate the
check. Failing every pull request that happens to touch such a file makes the
check unactionable — the author cannot fix what they did not write, so they
learn to ignore it. This action analyzes the changed files twice, as merged and
as they stand on the base branch, and fails only where a (file, rule) pair
gained violations. Everything else is reported, in the job summary, as
pre-existing.

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0          # the ratchet reads the base branch from git

- uses: malyavi/salesforce-pmd-action@v1
  with:
    source-dirs: force-app
    ruleset: config/pmd-ruleset.xml
```

That is the whole of it for a Salesforce DX repository. Everything below is a
knob you probably do not need.

## What a run does

1. Diffs the base branch against `HEAD` and splits the result into source the
   scan covers and configuration whose change makes a scan worth running.
2. Downloads the pinned PMD release (once per job; a second call in the same job
   reuses it).
3. Scans the changed files as they are, then materializes their base-branch
   versions under a mirror directory and scans those.
4. Compares the two per (file, rule) pair, and fails when a pair grew.
5. Writes a section of the shared pull request comment, a table of every
   violation in the touched files to the job summary, and the counts as outputs.

With no base branch to compare against — a push, a workflow dispatch — it runs a
**full informational scan** instead: every finding is reported and nothing
fails, because there is nothing to attribute. The same happens when only the
configuration changed, which is how a ruleset edit proves it still parses.

## What it scans, and what it leaves alone

`extensions` defaults to `cls,trigger,page,component` — what PMD has a
Salesforce language for, taken from the distribution rather than assumed:

| | PMD language | In the default |
| --- | --- | --- |
| `.cls`, `.trigger` | Apex | **yes** — and every rule in the default ruleset |
| `.page`, `.component` | Visualforce, with its own rule categories including `category/visualforce/security.xml` | **yes** |
| `.cmp`, `.app`, `.evt` (Aura) | none | no |
| `.email` (email templates) | none | no |
| `.js` (LWC) | Ecmascript — but its parser predates ES6 | no |
| `.html` (LWC), `.xml` | HTML and XML — rules about web pages, Maven and WSDL | no |

Aura bundles and email templates are not a judgement call: PMD maps them to no
language, and answers a file list holding only those with *"No files to
analyze"*. LWC is: PMD does read `.js`, but an LWC module comes back as four
parse errors (`identifier is a reserved word: import`) and then a violation
invented from the wreckage — worse than not looking.

Visualforce earns its place even though the default Apex ruleset holds no rule
that fires on a page. It costs nothing until you add the Visualforce categories,
and a caller who adds them should not then have to discover a filter that was
quietly excluding the files.

Clear the filter if your ruleset reaches further than that list does — every
changed file under `source-dirs` is then handed to PMD, which skips what it
cannot read:

```yaml
- uses: malyavi/salesforce-pmd-action@v1
  with:
    extensions: ''
```

## Why the branch tip rather than the merge base

A pull request is checked out as the merge result. Comparing against the merge
base would count a violation *another* change added to the same file since then
as this change's, because it is present in the checkout and absent from the
base. Comparing against the target branch tip puts that violation on both sides,
where it cancels out.

## Why (file, rule) pairs rather than individual violations

Line numbers move with every edit, so matching individual violations across the
two scans would report an ordinary refactor as a page of new findings. A pair
whose count did not grow passes, even when the violations inside it moved. The
cost is that a pull request which fixes one violation and adds another in the
same file and rule reports neither — and a listed finding is a line from the
pair rather than provably the new one, which the comment says in as many words.

## Requirements

- **`fetch-depth: 0`** on the checkout. The action reads the base branch's file
  contents out of git; a shallow clone does not have them.
- **A JDK.** Installed by the action unless `setup-java: false`.
- **Node 20 or newer**, which every GitHub-hosted runner already has.
- **`pull-requests: write`** permission if you want the comment.

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `source-dirs` | `force-app` | Directories holding the source to analyze, comma- or newline-separated. A path outside them is ignored, which is what keeps a sample or vendored tree out of the scan. |
| `extensions` | `cls,trigger,page,component` | Extensions the scan covers, without the dot — what PMD has a Salesforce language for. Empty clears the filter. |
| `ruleset` | `rulesets/apex/quickstart.xml` | A path in the repository, or one of PMD's built-in rulesets. |
| `config-paths` | — | Extra paths whose change triggers a full informational scan, as globs (`*`, `**`, `?`). The ruleset always counts as one. |
| `mode` | `auto` | `auto` ratchets when there is a base branch and scans fully when there is not; `diff` insists on the ratchet and fails if it cannot; `full` always scans whole and never fails. |
| `base-ref` | `origin/<base branch>` | What to ratchet against. Set it to give a push event a ratchet, for example `HEAD~1`. |
| `fail-on-new` | `true` | Whether a new violation fails the run. Off is how a repository adopts the check before enforcing it. |
| `pmd-version` | `7.27.0` | Pinned deliberately: a new rule in a new release would otherwise arrive as somebody's new violations. |
| `pmd-download-url` | — | A mirror of the distribution zip, for a runner that cannot reach GitHub releases. |
| `pmd-args` | — | Extra arguments for `pmd check`, for example `--minimum-priority 3`. |
| `max-listed` | `20` | New violations listed in the comment before collapsing into a count. |
| `label` | `PMD (Apex)` | How the check names itself in every message. Set it to the job's name. |
| `working-directory` | `.` | For a repository whose project is not at its root. |
| `comment` | `true` | Whether to write the pull request comment at all. |
| `comment-section` | `pmd` | The section of the shared comment this action owns. |
| `comment-tag` | `<!-- malyavi-pr-status-comment -->` | Identifies the shared comment. Give every action reporting into one comment the same tag. |
| `comment-section-order` | — | Fixed rendering order for the sections, comma-separated. Unlisted sections render last. |
| `pr-number` | from the event | The pull request to comment on. |
| `github-token` | `github.token` | Used to read and write the comment. |
| `setup-java` | `true` | Turn off when the job already set up a JDK. |
| `java-version` | `21` | |
| `java-distribution` | `temurin` | |

## Outputs

| Output | What it holds |
| --- | --- |
| `outcome` | `passed`, `failed` or `skipped`. |
| `new-violations` | Violations the change introduced. |
| `preexisting-violations` | Violations in the touched files that predate it. |
| `files-analyzed` | How many files the ratchet compared. |
| `report-path` | PMD's own JSON report for the head scan, for a later step to upload. |

## The shared comment

Several checks can report into one pull request comment, each owning a section.
Give them the same `comment-tag` and the same `comment-section-order`, and each
writes only its own section:

```yaml
- uses: malyavi/salesforce-pmd-action@v1
  with:
    comment-tag: '<!-- ci-status -->'
    comment-section-order: validation,jest,pmd
```

A write is read-modify-write, so two jobs finishing in the same instant can lose
one section until the next push. That is accepted: the window is milliseconds
wide and the alternative is cross-job locking for a status comment.

## Suppressing a finding

```apex
// The retry is the caller's, and this catch is how it is signalled.
@SuppressWarnings('PMD.EmptyCatchBlock')
```

A suppression is a decision, so write the reason next to it. The ratchet has no
opinion about them: a suppressed finding is not a finding.

## Development

```bash
npm test                          # unit suite, no dependencies
python3 test/check-action-yaml.py  # action.yml parses and is shaped right
test/fixtures/setup.sh /tmp/fix    # a two-commit repository to run against
```

The suite is Node's own test runner, so the repository has no dependencies to
install — which is also why the action needs no build step and no `dist/`.
