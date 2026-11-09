#!/usr/bin/env bash
# Checks for the fork's own changes, after merging upstream: typecheck everything, then lint
# and test the files the fork changes compared with upstream/main, plus the full web unit
# suite (fast, and where most fork features live). Upstream's own CI already covers the rest.
set -euo pipefail

base="${1:-upstream/main}"

echo "::group::Typecheck"
vp run typecheck
echo "::endgroup::"

mapfile -t changed < <(git diff --name-only --diff-filter=d "$base" HEAD -- '*.ts' '*.tsx' \
  | grep -v '^\.github/' || true)

if ((${#changed[@]} > 0)); then
  echo "::group::Lint fork changes"
  vp lint "${changed[@]}"
  echo "::endgroup::"
fi

tests_in() {
  local dir="$1"
  for file in "${changed[@]}"; do
    [[ "$file" == "$dir"/* && "$file" =~ \.test\.tsx?$ && "$file" != *.browser.test.* ]] \
      && echo "${file#"$dir"/}"
  done
}

for dir in apps/server packages/shared packages/contracts packages/client-runtime apps/desktop; do
  mapfile -t tests < <(tests_in "$dir")
  if ((${#tests[@]} > 0)); then
    echo "::group::Tests in $dir"
    (cd "$dir" && vp test run "${tests[@]}")
    echo "::endgroup::"
  fi
done

echo "::group::Web unit tests"
(cd apps/web && vp test run --project unit)
echo "::endgroup::"
