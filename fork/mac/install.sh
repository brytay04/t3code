#!/bin/bash
# Installs the fork's update-on-quit helper for the current macOS user. Safe to rerun.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="$HOME/Library/Application Support/T3 Fork Updates"
plist="$HOME/Library/LaunchAgents/com.brytay04.t3-fork-update.plist"
mkdir -p "$dir" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install -m 755 "$here/t3-fork-mac-update.sh" "$dir/t3-fork-mac-update.sh"
sed "s|__HOME__|$HOME|g" "$here/com.brytay04.t3-fork-update.plist" > "$plist"
launchctl bootout "gui/$(id -u)/com.brytay04.t3-fork-update" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Installed. Log: ~/Library/Logs/t3-fork-update.log"
