#!/usr/bin/env bash
# Builds a throwaway Salesforce DX repository, so the action can be run against
# it exactly as a caller would.
#
# Three refs, each answering one question:
#
#   base            one violation, and a flow PMD has no language for
#   change          a second violation of the same rule in the same file, plus
#                   an edit to that flow — the ratchet has to report one new
#                   violation rather than two, and has to be unbothered by a
#                   changed file the scanner skips
#   metadata-only   the flow alone — the default names no extensions, so this
#                   change still runs a scan rather than being skipped
#
# Usage: test/fixtures/setup.sh <directory>
set -euo pipefail

target="${1:?Pass the directory to build the fixture repository in}"
fixtures="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rm -rf "$target"
mkdir -p "$target/force-app/main/default/classes" "$target/force-app/main/default/flows" "$target/config"
cd "$target"

# `base` and `change`, never `head`: a branch called `head` makes every later
# `git` call warn that the name HEAD is ambiguous.
git init --quiet --initial-branch=base
git config user.email "smoke@example.com"
git config user.name "Smoke Test"

cp "$fixtures/ruleset.xml" config/ruleset.xml
cp "$fixtures/base/Smoke.cls" force-app/main/default/classes/Smoke.cls
cp "$fixtures/base/Smoke.flow-meta.xml" force-app/main/default/flows/Smoke.flow-meta.xml
git add -A
git commit --quiet -m "One empty catch block"

git checkout --quiet -b metadata-only
cp "$fixtures/head/Smoke.flow-meta.xml" force-app/main/default/flows/Smoke.flow-meta.xml
git add -A
git commit --quiet -m "Edit the flow and nothing else"

git checkout --quiet base
git checkout --quiet -b change
cp "$fixtures/head/Smoke.cls" force-app/main/default/classes/Smoke.cls
cp "$fixtures/head/Smoke.flow-meta.xml" force-app/main/default/flows/Smoke.flow-meta.xml
git add -A
git commit --quiet -m "A second empty catch block, and an unrelated flow edit"

echo "Fixture repository ready in $target (base branch: base, head: $(git rev-parse --short HEAD))"
