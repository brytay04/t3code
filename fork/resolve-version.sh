#!/usr/bin/env bash
# Prints the fork build version for HEAD, for example 0.1.8-nightly.20261109.442901.
#
# The version is the newest upstream Nightly that HEAD contains, with its build number N
# replaced by N*100 + R, where R (1-99) counts fork builds on that same Nightly. So a fork
# build always sorts above the official build it is based on, and an official build and a
# fork build never share a version (the pinned runtime caches by version).
#
# Needs: upstream tags fetched under refs/upstream-tags/, and GH_TOKEN for `gh release list`.
set -euo pipefail

repo="${GITHUB_REPOSITORY:-brytay04/t3code}"

base_tag="$(git for-each-ref --merged HEAD --sort=-version:refname --count=1 \
  --format='%(refname:lstrip=2)' 'refs/upstream-tags/v*-nightly.*')"
if [[ -z "$base_tag" ]]; then
  echo "HEAD contains no upstream Nightly tag." >&2
  exit 1
fi
base="${base_tag#v}"                     # 0.1.8-nightly.20261109.4429
if [[ ! "$base" =~ ^([0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8})\.([0-9]+)$ ]]; then
  echo "Unexpected upstream Nightly tag: $base_tag" >&2
  exit 1
fi
prefix="${BASH_REMATCH[1]}"
upstream_n="${BASH_REMATCH[2]}"

last_rev=0
while read -r tag; do
  if [[ "$tag" =~ ^v${prefix//./\\.}\.${upstream_n}([0-9]{2})$ ]]; then
    rev=$((10#${BASH_REMATCH[1]}))
    ((rev > last_rev)) && last_rev=$rev
  fi
done < <(gh release list --repo "$repo" --limit 200 --json tagName --jq '.[].tagName')

next_rev=$((last_rev + 1))
if ((next_rev > 99)); then
  echo "Out of fork build numbers for $base_tag." >&2
  exit 1
fi
printf '%s.%d%02d\n' "$prefix" "$upstream_n" "$next_rev"
