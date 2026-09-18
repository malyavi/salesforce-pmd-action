#!/usr/bin/env bash
# Builds a throwaway Salesforce DX repository with two commits, so the action
# can be run against it exactly as a caller would: a `base` branch holding one
# violation, and a head commit that adds a second one of the same rule in the
# same file. That shape is the whole point — the ratchet has to report one new
# violation rather than two.
#
# Usage: test/fixtures/setup.sh <directory>
set -euo pipefail

target="${1:?Pass the directory to build the fixture repository in}"
fixtures="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

rm -rf "$target"
mkdir -p "$target/force-app/main/default/classes" "$target/config"
cd "$target"

# `base` and `change`, never `head`: a branch called `head` makes every later
# `git` call warn that the name HEAD is ambiguous.
git init --quiet --initial-branch=base
git config user.email "smoke@example.com"
git config user.name "Smoke Test"

cp "$fixtures/ruleset.xml" config/ruleset.xml
cp "$fixtures/base/Smoke.cls" force-app/main/default/classes/Smoke.cls
git add -A
git commit --quiet -m "One empty catch block"

git checkout --quiet -b change
cp "$fixtures/head/Smoke.cls" force-app/main/default/classes/Smoke.cls
git add -A
git commit --quiet -m "A second empty catch block"

echo "Fixture repository ready in $target (base branch: base, head: $(git rev-parse --short HEAD))"
