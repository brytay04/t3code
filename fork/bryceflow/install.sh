#!/usr/bin/env bash
# Installs the fork update mirror on bryceflow. Safe to rerun.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$HOME/.local/share/t3-fork-mirror"
mkdir -p "$root/bin" "$root/www" "$root/state" "$HOME/.config/systemd/user"
install -m 755 "$here/t3-fork-sync.sh" "$here/t3-fork-fix.sh" "$root/bin/"
install -m 644 "$here"/systemd/* "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now t3-fork-mirror.service t3-fork-sync.timer
# HTTPS on the tailnet at https://<host>.ts.net:8443/ ; leaves the existing / -> :3773 alone.
"/mnt/c/Program Files/Tailscale/tailscale.exe" serve --bg --https=8443 http://127.0.0.1:8787
"/mnt/c/Program Files/Tailscale/tailscale.exe" serve status
