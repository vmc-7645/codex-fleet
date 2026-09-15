# Codex Fleet helpers

Run `./install.sh` to install the three commands to `~/.local/bin`, hook scripts
to `${CODEX_HOME:-~/.codex}/hooks/codex-fleet`, and zsh completion to the Codex
completions directory. Requirements: Bash, Python 3, jq, git; Ghostty for direct
tab opening on macOS.

The installer backs up and merges `hooks.json` without changing `config.toml`
or hook trust. Restart Codex and review/trust the new definitions with `/hooks`.
It prints a completion source line for optional addition to `.zshrc`.

- `--no-merge`: install files and print hook configuration.
- `--prefix /tmp/example`: install entirely within an isolated prefix for testing.

## Commands

- `codex-worktree <branch> [dir-name]`: create/reuse a validated worktree, open
  Codex in Ghostty. `CODEX_WT_PROMPT` supplies the initial task.
  `CODEX_WT_NO_OPEN=1` skips opening and prints `CODEX_WT_DIR=<path>` for Raycast.
- `codex-undo [--list]`: preview and restore the latest start-of-turn checkpoint.
  Requires confirmation and a safety snapshot. Preserves files that existed at
  checkpoint time and removes later additions. Restores file contents, not the
  original staging split; does not rewind commits or external side effects.
- `codex-restore [--list|--yes]`: reopen crashed/stopped, non-ended sessions from
  the fleet registry, skipping verified live owners and entries older than a week.

## Hooks

`fleet-register.sh` delegates to `fleet-event.py`. Events map to idle, working,
waiting, done, and ended states. A verified Codex owner PID and process start time
provide liveness. Standalone CLI owners can receive a terminal title; shared
app-server owners are never exposed as targets for SIGINT. `tab-status.sh` is a
compatibility entry point to the same adapter and is not wired a second time.

`checkpoint.sh` runs on UserPromptSubmit. It snapshots even clean worktrees via a
temporary index, keeping the user's index untouched and retaining 20 checkpoint
refs per worktree. Ignored files are excluded.

```sh
python3 -m unittest discover -s helpers/tests -v
```

Tests use temporary directories and do not install hooks in your Codex config.
