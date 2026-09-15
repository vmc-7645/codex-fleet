# zsh completion for `codex-worktree`: complete the first argument with the
# 35 most-recently-committed local branches. Self-contained — initializes
# zsh's completion system if the surrounding shell hasn't already.
#
#   source ~/.codex/completions/codex-worktree.zsh   # from ~/.zshrc

# Bring up compdef if no completion framework is loaded (bare .zshrc).
if ! whence compdef >/dev/null 2>&1; then
  autoload -Uz compinit && compinit -i
fi

_codex_worktree() {
  # Only complete the first positional argument (the branch).
  (( CURRENT == 2 )) || return 0
  local -a branches
  # Most-recently-committed local branches, excluding auto-generated
  # worktree-agent-* branches, capped at 35.
  branches=(${(f)"$(git for-each-ref --sort=-committerdate \
    --format='%(refname:short)' refs/heads 2>/dev/null \
    | grep -v '^worktree-agent-' | head -35)"})
  (( ${#branches} )) && compadd -a branches
}

compdef _codex_worktree codex-worktree 2>/dev/null
