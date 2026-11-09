#!/usr/bin/env bash
# Runs hourly on bryceflow (t3-fork-sync.timer):
#   1. Copies the newest fork release from GitHub into the update mirror folder, checksums
#      first, then swaps the feed files (nightly-*.yml) in last so clients never see a
#      version whose files are missing. Keeps the newest 3 versions.
#   2. If the newest Fork nightly run failed, starts the fix agent once for that run.
set -euo pipefail

REPO="${T3_FORK_REPO:-brytay04/t3code}"
ROOT="${T3_FORK_MIRROR_ROOT:-$HOME/.local/share/t3-fork-mirror}"
WWW="$ROOT/www"
STATE="$ROOT/state"
KEEP=3
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$WWW" "$STATE"
exec 9>"$STATE/sync.lock"
flock -n 9 || { echo "Another sync is running."; exit 0; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

sync_release() {
  local tag version dir staging
  tag="$(gh release list --repo "$REPO" --limit 1 --exclude-drafts --json tagName --jq '.[0].tagName // ""')"
  [[ -n "$tag" ]] || { log "No fork releases yet."; return 0; }
  version="${tag#v}"
  dir="$WWW/v$version"
  if [[ -f "$dir/.complete" ]]; then
    log "Mirror already has $version."
  else
    staging="$WWW/.staging-v$version"
    rm -rf "$staging"
    mkdir -p "$staging"
    log "Downloading $tag..."
    gh release download "$tag" --repo "$REPO" --dir "$staging" \
      --pattern 't3-*.tar.gz' --pattern '*.zip' --pattern 'SHA256SUMS' --pattern 'nightly-*.yml'
    (cd "$staging" && sha256sum --check --quiet SHA256SUMS)
    grep -q "^version: $version\$" "$staging/nightly-linux.yml"
    grep -q "^version: $version\$" "$staging/nightly-mac.yml"
    touch "$staging/.complete"
    rm -rf "$dir"
    mv "$staging" "$dir"
    log "Mirrored $version."
  fi
  # Feed files last, each swapped atomically.
  local feed
  for feed in "$dir"/nightly-*.yml; do
    cp "$feed" "$WWW/.$(basename "$feed").tmp"
    mv -f "$WWW/.$(basename "$feed").tmp" "$WWW/$(basename "$feed")"
  done
  # Prune old versions (version sort, newest first).
  local old
  while read -r old; do
    [[ -n "$old" ]] || continue
    log "Pruning $old."
    rm -rf "${WWW:?}/$old"
  done < <(cd "$WWW" && ls -d v*/ 2>/dev/null | tr -d / | sort -rV | tail -n +$((KEEP + 1)))
}

check_failed_run() {
  local run id conclusion
  run="$(gh run list --repo "$REPO" --workflow fork-nightly.yml --limit 1 \
    --json databaseId,status,conclusion --jq '.[0] // empty')"
  [[ -n "$run" ]] || return 0
  id="$(jq -r .databaseId <<<"$run")"
  conclusion="$(jq -r .conclusion <<<"$run")"
  [[ "$conclusion" == "failure" ]] || return 0
  if grep -qx "$id" "$STATE/handled-runs" 2>/dev/null; then return 0; fi
  echo "$id" >> "$STATE/handled-runs"
  log "Fork nightly run $id failed; starting the fix agent."
  "$SCRIPT_DIR/t3-fork-fix.sh" "$id" || log "Fix agent exited with an error."
}

# Keeps the local HTTPS copy's Tailscale certificate fresh (renews when under 30 days).
refresh_cert() {
  local tls="$ROOT/tls" host="${T3_FORK_MIRROR_HOST:-bryceflow.tail27e15f.ts.net}"
  local ts="/mnt/c/Program Files/Tailscale/tailscale.exe"
  [[ -x "$ts" ]] || return 0
  mkdir -p "$tls"
  local before
  before="$(sha256sum "$tls/mirror.crt" 2>/dev/null || true)"
  "$ts" cert --min-validity 720h --cert-file - "$host" > "$tls/.crt.tmp" \
    && "$ts" cert --min-validity 720h --key-file - "$host" > "$tls/.key.tmp" \
    && [[ -s "$tls/.crt.tmp" && -s "$tls/.key.tmp" ]] \
    && chmod 600 "$tls/.key.tmp" && mv "$tls/.crt.tmp" "$tls/mirror.crt" && mv "$tls/.key.tmp" "$tls/mirror.key"
  rm -f "$tls/.crt.tmp" "$tls/.key.tmp"
  if [[ "$before" != "$(sha256sum "$tls/mirror.crt" 2>/dev/null || true)" ]]; then
    systemctl --user restart t3-fork-mirror-tls.service || true
  fi
}

refresh_cert || log "Certificate refresh failed."
sync_release || log "Release sync failed."
check_failed_run || log "Failed-run check failed."
