#!/usr/bin/env bash
# Started by t3-fork-sync.sh when a Fork nightly run fails. A headless Claude agent tries to
# fix it on a fork-fix/<date> branch; if it commits a fix, the branch is pushed and the
# workflow is rerun on it (that run moves bryce/main and publishes only if it passes).
# If the failed run was already a fix attempt, or the agent gives up, Bryce gets a GitHub
# issue (GitHub emails and pushes it). Machines keep the last good build either way.
set -euo pipefail

RUN_ID="$1"
REPO="${T3_FORK_REPO:-brytay04/t3code}"
ROOT="${T3_FORK_MIRROR_ROOT:-$HOME/.local/share/t3-fork-mirror}"
WORK="$ROOT/fix-repo"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
RUN_URL="https://github.com/$REPO/actions/runs/$RUN_ID"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

notify() {
  local title="$1" body="$2"
  log "Notifying: $title"
  gh issue create --repo "$REPO" --assignee brytay04 --title "$title" --body "$body" >/dev/null \
    || log "Could not open the GitHub issue."
}

title="$(gh run view "$RUN_ID" --repo "$REPO" --json displayTitle --jq .displayTitle)"
if [[ "$title" == *fork-fix/* ]]; then
  notify "Fork nightly still failing after the fix agent ($(date +%F))" \
    "The fix agent's rerun failed too: $RUN_URL

Machines keep the last good build. Fix by hand on \`bryce/main\` (see docs/fork/updates.md), then run the Fork nightly workflow."
  exit 0
fi

if [[ ! -d "$WORK/.git" ]]; then
  git clone --quiet "git@github.com:$REPO.git" "$WORK"
  git -C "$WORK" remote add upstream https://github.com/pingdotgg/t3code.git
fi
cd "$WORK"
git fetch --quiet origin
git fetch --quiet upstream main
branch="fork-fix/$(date +%Y%m%d-%H%M)"
git reset --quiet --hard
git clean -fdq
git checkout --quiet -B "$branch" origin/bryce/main
start="$(git rev-parse HEAD)"

gh run view "$RUN_ID" --repo "$REPO" --log-failed 2>/dev/null | tail -n 400 > "$ROOT/state/failure-$RUN_ID.log" || true

prompt="You are fixing Bryce's T3 Code fork after its nightly build failed.
Repository: $WORK (branch $branch, from origin/bryce/main). Remote 'upstream' is pingdotgg/t3code.
Failed run: $RUN_URL. The end of its failed-job log is in $ROOT/state/failure-$RUN_ID.log.

The nightly job merges upstream/main into bryce/main, then runs fork/run-fork-checks.sh
(typecheck, lint and tests for the fork's changes), then builds and releases.

Do this:
1. Read the log. If the merge failed, run 'git merge upstream/main' and resolve every conflict,
   keeping both upstream's change and the fork's feature. Prefer upstream's shapes and APIs and
   adapt the fork's code to them. If checks failed, fix the code.
2. Install with 'pnpm install --frozen-lockfile' if node_modules is missing. This machine has
   little free memory: run one heavy command at a time, and run only focused checks: the
   typecheck of the packages you touched and the test files for the fork features you touched
   (vp test run <files> inside the package). CI runs the full checks after you.
3. Commit the result on $branch (a merge commit if you merged). Do not push, do not touch any
   other branch, and never push to upstream.
4. Finish with one line: 'RESULT: FIXED' if you committed a fix you believe passes, otherwise
   'RESULT: GAVE UP: <one-sentence reason>'."

log "Running the fix agent on $branch..."
output="$("$CLAUDE" -p "$prompt" --model claude-opus-5-5 --dangerously-skip-permissions \
  --add-dir "$ROOT/state" 2>&1 | tee "$ROOT/state/agent-$RUN_ID.log" | tail -n 20)" || true

if grep -q 'RESULT: FIXED' <<<"$output" && [[ "$(git rev-parse HEAD)" != "$start" ]] \
  && [[ -z "$(git status --porcelain --untracked-files=no)" ]]; then
  git push --quiet origin "$branch"
  gh workflow run fork-nightly.yml --repo "$REPO" -f source_ref="$branch"
  log "Pushed $branch and reran Fork nightly on it."
else
  reason="$(grep -o 'RESULT: GAVE UP:.*' <<<"$output" | head -n 1)"
  notify "Fork nightly failed and the fix agent could not fix it ($(date +%F))" \
    "Failed run: $RUN_URL
Agent: ${reason:-no result line; see ~/.local/share/t3-fork-mirror/state/agent-$RUN_ID.log on bryceflow}

Machines keep the last good build. Fix by hand on \`bryce/main\` (see docs/fork/updates.md), then run the Fork nightly workflow."
fi
