# Fork updates

Bryce's machines run this fork (`brytay04/t3code`) instead of the official app.
Every night the fork merges the official changes, checks them and publishes a build.
The normal T3 update path (`t3 update`, the update button) then installs it.

## Branches

- `bryce/main` is the source of truth and the fork's default branch. Build and commit
  personal features here.
- `main` stays as the original fork point. Leave it alone.
- `fork-nightly/candidate` and `fork-fix/*` are scratch branches the automation writes.

## How it works

```
GitHub Actions, 11:20 UTC daily        bryceflow, hourly at :50              machines
---------------------------------      ----------------------------------    -------------------------------
merge upstream/main into bryce/main -> t3-fork-sync copies the newest     -> servers: `t3 update` reads
typecheck, lint, test fork changes     release into the mirror folder,        the mirror (managed policy)
build Linux x64 + macOS arm64 CLI      served at                              Mac: launchd helper stages the
archives and the macOS arm64 app       https://bryceflow.tail27e15f.ts.net:8443  app and swaps it in when T3
publish release v<version>             (tailnet only)                         is closed
move bryce/main to the merge commit
```

- Workflow: `.github/workflows/fork-nightly.yml`. It publishes nothing if any step fails,
  and `bryce/main` only moves after a release is published.
- Version: the upstream Nightly the build contains, with build number `N` replaced by
  `N*100 + R` (fork build `R` on that Nightly). Example: upstream `0.1.8-nightly.20261109.4429`
  becomes `0.1.8-nightly.20261109.442901`. A fork build always sorts above its official base,
  and fork and official builds never share a version. Script: `fork/resolve-version.sh`.
- Mirror (bryceflow): `~/.local/share/t3-fork-mirror/www`, laid out like a GitHub release:
  `nightly-linux.yml` and `nightly-mac.yml` at the root, files under `v<version>/`. It keeps the
  newest 3 versions. Units: `t3-fork-mirror.service` (static server on 127.0.0.1:8787) and
  `t3-fork-sync.timer`. Tailscale Serve publishes it on `:8443` and `:9443`. Install or
  reinstall with `fork/bryceflow/install.sh`.
- bryceflow itself cannot reach its own tailnet address from WSL, so inside WSL
  `/etc/hosts` points `bryceflow.tail27e15f.ts.net` at 127.0.0.1 (with `generateHosts = false`
  in `/etc/wsl.conf`), and `t3-fork-mirror-tls.service` answers `https://...:9443` locally with
  the Tailscale certificate (renewed by the sync job). That is why bryceflow's policy uses
  `:9443`; 8443 cannot be bound inside this WSL.
- Servers: a managed policy sets `limits.updates.feedUrl` to the mirror, so `t3 update` and
  the update button read the mirror instead of GitHub. bryceflow: `/etc/t3code/policy.json`
  (feedUrl `:9443`). fw-server-01 has no passwordless sudo, so it uses
  `~/.config/t3code/policy.json` (feedUrl `:8443`), named by `T3CODE_DEV_MANAGED_POLICY_PATH`
  in a systemd drop-in (`~/.config/systemd/user/t3code.service.d/fork-policy.conf`) and in
  `~/.profile`/`~/.bashrc`. Only non-official builds honor that variable, which fork builds are.
  Moving it to `/etc/t3code/policy.json` later is fine. The file:

  ```json
  {
    "schemaVersion": 1,
    "organization": "Bryce",
    "limits": { "updates": { "mode": "auto", "feedUrl": "https://bryceflow.tail27e15f.ts.net:8443" } }
  }
  ```

- Mac: the builds are not Apple-signed, so the app's own updater cannot install them.
  `fork/mac/t3-fork-mac-update.sh` runs every 5 minutes (launchd
  `com.brytay04.t3-fork-update`): it downloads and checks the zip from `nightly-mac.yml`,
  stages it in `~/Library/Application Support/T3 Fork Updates/staged`, and when T3 Code is not
  running swaps it into `/Applications`, keeping the previous app in `.../backup`. Log:
  `~/Library/Logs/t3-fork-update.log`. Install with `fork/mac/install.sh`.

## When a night fails

1. GitHub emails Bryce about the failed run.
2. Within the hour, `t3-fork-sync` on bryceflow starts a headless Claude agent
   (`fork/bryceflow/t3-fork-fix.sh`) on a `fork-fix/<date>` branch. If it commits a fix, the
   branch is pushed and the workflow reruns on it; that run publishes and moves `bryce/main`
   only if it passes.
3. If the agent gives up, or its rerun fails too, it opens a GitHub issue assigned to Bryce.
   Machines keep the last good build. Logs: `~/.local/share/t3-fork-mirror/state/` on bryceflow.

To fix by hand: merge `upstream/main` into `bryce/main`, run `fork/run-fork-checks.sh`, push,
then run the workflow (below).

## Force an update

- New build now: `gh workflow run fork-nightly.yml -R brytay04/t3code -f force=true`
  (or Actions > Fork nightly > Run workflow).
- Pull it into the mirror now: on bryceflow, `systemctl --user start t3-fork-sync.service`.
- Server: `t3 update --yes` (use the active binary,
  `~/.t3/runtime/versions/<current>/t3`, if `~/.local/bin/t3` is stale). `--yes` restarts the
  background service, which interrupts running threads.
- Mac: quit T3 Code; the helper installs the staged build within 5 minutes. Run it at once with
  `launchctl kickstart gui/$(id -u)/com.brytay04.t3-fork-update`.

## Roll back

- Server, to an older fork build still in the mirror (the newest 3):
  `t3 update <version> --allow-downgrade --yes`.
- Server, back to the official app: remove `/etc/t3code/policy.json`, then
  `t3 update <official-version> --allow-downgrade --yes` (official builds come from GitHub again).
- Mac: quit T3 Code, then
  `mv "/Applications/T3 Code (Nightly).app" ~/.Trash/ && mv ~/Library/Application\ Support/T3\ Fork\ Updates/backup/*.app /Applications/`.
  To stop updates, `launchctl bootout gui/$(id -u)/com.brytay04.t3-fork-update`.
- Stop the nightly build: `gh workflow disable fork-nightly.yml -R brytay04/t3code`.
