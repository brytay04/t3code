#!/usr/bin/env bash
# Installs the fork update mirror on bryceflow. Safe to rerun.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$HOME/.local/share/t3-fork-mirror"
mkdir -p "$root/bin" "$root/www" "$root/state" "$HOME/.config/systemd/user"
install -m 755 "$here/t3-fork-sync.sh" "$here/t3-fork-fix.sh" "$here/t3-fork-mirror-tls.py" "$root/bin/"
install -m 644 "$here"/systemd/* "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now t3-fork-mirror.service t3-fork-sync.timer
# bryceflow's own t3 reaches the mirror through a local HTTPS copy (WSL cannot reach its own
# tailnet address). Keep the hostname on 127.0.0.1 inside WSL and stop WSL regenerating hosts.
host=bryceflow.tail27e15f.ts.net
grep -q " $host\$" /etc/hosts || echo "127.0.0.1 $host" | sudo tee -a /etc/hosts >/dev/null
grep -q '^generateHosts' /etc/wsl.conf || printf '[network]\ngenerateHosts = false\n' | sudo tee -a /etc/wsl.conf >/dev/null
systemctl --user start t3-fork-sync.service  # fetches the certificate
systemctl --user enable --now t3-fork-mirror-tls.service
# HTTPS on the tailnet at https://<host>.ts.net:8443/ and :9443/ (bryceflow's own policy uses
# 9443, which its local copy also answers); leaves the existing / -> :3773 alone.
"/mnt/c/Program Files/Tailscale/tailscale.exe" serve --bg --https=8443 http://127.0.0.1:8787
"/mnt/c/Program Files/Tailscale/tailscale.exe" serve --bg --https=9443 http://127.0.0.1:8787
"/mnt/c/Program Files/Tailscale/tailscale.exe" serve status
