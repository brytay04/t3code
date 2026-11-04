# Bryce's Nightly branch

`bryce/integrated-app` in `brytay04/t3code` carries the personal features on top of
the latest published upstream Nightly, not unreleased `upstream/main` commits.
The current base is `v0.1.8-nightly.20261104.4179` (`9e85538535`).

For an update, fetch the latest published Nightly tag, back up the branch, and
rebase only the personal commits onto that tag. Compare the old and new series
with `git range-diff`. Run `vp run check:changed <nightly-tag>` before pushing
with a lease tied to the previously observed remote head.

Build versions append `.bryce.N` to the upstream Nightly version. The app keeps
the Nightly name, bundle ID, `~/.t3` state directory, and `t3code-v2` Electron
profile. This is a replacement for the daily Nightly app. It must not run at the
same time as the official app against that profile. Stage the replacement and
install after the running app exits; keep the previous application as a backup.

Personal builds have no automatic update feed. Update by rebasing and rebuilding
so an official release cannot silently discard the personal changes. SSH server
bootstrapping requires a runtime archive for the exact personal version on each
remote host; the official release repository does not contain those archives.
