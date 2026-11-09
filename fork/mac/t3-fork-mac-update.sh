#!/bin/bash
# T3 Code fork "update on quit" helper for macOS, run every 5 minutes by launchd
# (com.brytay04.t3-fork-update). The fork's builds are not signed by Apple, so the app's
# built-in updater cannot install them; this does it instead:
#   1. Reads nightly-mac.yml from bryceflow's update mirror.
#   2. Downloads and checks the app zip, ad-hoc signs the app, and stages it while T3 runs.
#   3. When T3 Code is not running, swaps the staged app into /Applications, keeping the
#      previous app as the one backup.
# Log: ~/Library/Logs/t3-fork-update.log
set -euo pipefail

FEED_URL="${T3_FORK_FEED_URL:-https://bryceflow.tail27e15f.ts.net:8443}"
DIR="$HOME/Library/Application Support/T3 Fork Updates"
STAGED="$DIR/staged"
BACKUP="$DIR/backup"
APP_NAME_DEFAULT="T3 Code (Nightly).app"
MIN_FREE_KB=$((2 * 1024 * 1024)) # 2 GB: zip + unpacked app + backup

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

mkdir -p "$DIR"
LOCK="$DIR/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A crashed run leaves the lock behind; take it back after an hour.
  if [[ -n "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]]; then
    rm -rf "$LOCK" && mkdir "$LOCK"
  else
    exit 0
  fi
fi
trap 'rm -rf "$LOCK" "$DIR/download.zip" "$DIR/.unpack"' EXIT

app_version() {
  /usr/bin/defaults read "$1/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true
}

app_running() {
  /usr/bin/pgrep -f "/Contents/MacOS/T3 Code" >/dev/null 2>&1
}

# --- What the mirror offers -------------------------------------------------------------
feed="$(/usr/bin/curl -fsS --max-time 30 "$FEED_URL/nightly-mac.yml")" || {
  log "Mirror unreachable ($FEED_URL)."
  feed=""
}
version="" zip="" sha512=""
if [[ -n "$feed" ]]; then
  version="$(printf '%s\n' "$feed" | /usr/bin/sed -n 's/^version: *//p' | head -n 1 | tr -d "\"'")"
  # The first files[] entry whose url is a .zip, and its sha512.
  read -r zip sha512 < <(printf '%s\n' "$feed" | /usr/bin/awk '
    /^  - url: .*\.zip$/ { url = $3; next }
    url != "" && /^    sha512: / { print url, $2; exit }
  ') || true
fi

# --- Stage the new build while T3 runs ---------------------------------------------------
staged_app="$(find "$STAGED" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
installed_app="/Applications/$(basename "${staged_app:-$APP_NAME_DEFAULT}")"
installed_version="$(app_version "$installed_app")"

if [[ -n "$version" && -n "$zip" && -n "$sha512" && "$version" != "$installed_version" \
  && "$(app_version "${staged_app:-/nonexistent}")" != "$version" ]]; then
  free_kb="$(df -k "$DIR" | awk 'NR == 2 { print $4 }')"
  if ((free_kb < MIN_FREE_KB)); then
    log "Not staging $version: only $((free_kb / 1024)) MB free."
  else
    log "Downloading $version ($zip)..."
    /usr/bin/curl -fsS --max-time 1800 -o "$DIR/download.zip" "$FEED_URL/v$version/$zip"
    actual="$(/usr/bin/openssl dgst -sha512 -binary "$DIR/download.zip" | /usr/bin/base64)"
    if [[ "$actual" != "$sha512" ]]; then
      log "Checksum mismatch for $zip; discarding it."
    else
      rm -rf "$DIR/.unpack"
      mkdir -p "$DIR/.unpack"
      /usr/bin/ditto -x -k "$DIR/download.zip" "$DIR/.unpack"
      new_app="$(find "$DIR/.unpack" -maxdepth 1 -name '*.app' -print -quit)"
      if [[ -z "$new_app" || "$(app_version "$new_app")" != "$version" ]]; then
        log "The zip for $version did not hold a $version app; discarding it."
      else
        /usr/bin/xattr -dr com.apple.quarantine "$new_app" 2>/dev/null || true
        # CI builds are unsigned (only the linker signature), which fails bundle verification.
        # An ad-hoc signature seals the bundle the way the previous local builds were.
        if ! /usr/bin/codesign --verify --deep --strict "$new_app" 2>/dev/null; then
          /usr/bin/codesign --force --deep --sign - "$new_app"
        fi
        rm -rf "$STAGED"
        mkdir -p "$STAGED"
        mv "$new_app" "$STAGED/"
        staged_app="$STAGED/$(basename "$new_app")"
        installed_app="/Applications/$(basename "$new_app")"
        log "Staged $version; it installs when T3 Code is not running."
      fi
    fi
  fi
fi

# --- Swap it in when T3 is closed ---------------------------------------------------------
staged_version="$(app_version "${staged_app:-/nonexistent}")"
if [[ -z "$staged_version" ]]; then exit 0; fi
if [[ "$staged_version" == "$(app_version "$installed_app")" ]]; then
  rm -rf "$STAGED"
  exit 0
fi
if app_running; then exit 0; fi

log "Installing $staged_version over $(app_version "$installed_app")..."
rm -rf "$BACKUP"
mkdir -p "$BACKUP"
if [[ -d "$installed_app" ]]; then
  mv "$installed_app" "$BACKUP/"
fi
if mv "$staged_app" "$installed_app"; then
  rm -rf "$STAGED"
  log "Installed $staged_version. Backup: $BACKUP/$(basename "$installed_app")"
else
  log "Install failed; restoring the previous app."
  [[ -d "$BACKUP/$(basename "$installed_app")" ]] && mv "$BACKUP/$(basename "$installed_app")" "$installed_app"
  exit 1
fi
