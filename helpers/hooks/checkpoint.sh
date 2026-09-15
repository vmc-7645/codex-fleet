#!/usr/bin/env bash
#
# Snapshot the working tree at the START of a turn (UserPromptSubmit) so
# `codex-undo` can roll back exactly what an agent changed. The snapshot is a
# commit stored under refs/codex-checkpoints/<worktree-key>/turn/<timestamp>.
#
# It never touches the user's index, worktree, HEAD, branches, or stash — it
# builds the snapshot in a throwaway index. Checkpoints are per-worktree and
# capped to the newest 20.
#
# macOS bash 3.2 compatible.
set -uo pipefail

input="$(cat)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
cwd="${cwd:-$PWD}"
cd "$cwd" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0


key="$(printf '%s' "$top" | tr -c 'A-Za-z0-9' '-' | sed -e 's/^-*//' -e 's/-*$//')"
stamp="$(python3 -c 'import time; print(time.time_ns())')"
turns="refs/codex-checkpoints/${key}/turn"

# Full snapshot (tracked changes + new untracked files, minus ignored) built in
# a throwaway index so the user's real index is untouched.
ti="$(mktemp "${TMPDIR:-/tmp}/codex-ckpt.XXXXXX")" || exit 0
GIT_INDEX_FILE="$ti" git read-tree HEAD 2>/dev/null \
  || GIT_INDEX_FILE="$ti" git read-tree --empty 2>/dev/null
GIT_INDEX_FILE="$ti" git add -A 2>/dev/null || { rm -f "$ti"; exit 1; }
tree="$(GIT_INDEX_FILE="$ti" git write-tree 2>/dev/null)"
rm -f "$ti"
[ -n "$tree" ] || exit 0

head="$(git rev-parse -q --verify HEAD 2>/dev/null || true)"
if [ -n "$head" ]; then
  commit="$(git commit-tree "$tree" -p "$head" -m "codex checkpoint $stamp" 2>/dev/null)"
else
  commit="$(git commit-tree "$tree" -m "codex checkpoint $stamp" 2>/dev/null)"
fi
[ -n "$commit" ] || exit 0
git update-ref "${turns}/${stamp}" "$commit" 2>/dev/null || true

# Retention: keep the newest 20 turn checkpoints for this worktree.
n=0
git for-each-ref --sort=-refname --format='%(refname)' "$turns" 2>/dev/null \
  | while IFS= read -r r; do
      n=$((n + 1))
      [ "$n" -gt 20 ] && git update-ref -d "$r" 2>/dev/null || true
    done
exit 0
