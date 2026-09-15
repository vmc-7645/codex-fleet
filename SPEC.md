# Codex Fleet implementation specification

## Scope and provenance

Port of vmc-7645/claude-fleet commit `81dc33dd9d01561f9a72ddf6bf48397eaaceba06`.
Preserve the 14 Raycast command surfaces, GitHub discovery and CI logic, terminal
abstraction, Ghostty accessibility matching/window affinity, handoffs, and shell
helper workflows. Codex adapters replace provider-specific interfaces.

## Commands and data flow

`agents` combines `lib/sessions.ts` (trusted-hook registry) with `lib/history.ts`
(saved history) using `lib/rank.ts`. Live agents sort by state-change time; recent
sessions sort by last activity. Menu bar and Next Waiting Agent load only active
transcript metadata. `lib/fleet.ts` supplies task, permission mode, diff and tool.

`my-prs`, `review-requests`, `my-issues`, and repo pickers reuse `gh` JSON and local
git discovery. PR review starts an interactive Codex session with a review prompt;
PR resume matches the PR branch to a local worktree, then selects its newest
saved session. Missing mappings report an actionable error.

`spawn`, `worktrees`, and `new-session` open through `lib/terminal.ts`.
`codex-worktree` honors `CODEX_WT_NO_OPEN=1`, returning `CODEX_WT_DIR=<path>`;
the extension chooses the terminal/window. A direct helper invocation uses Ghostty.

`lib/codex.ts` uses `codex resume <id>`, `codex fork <id>`, `codex resume --last`,
`codex doctor`, and `codex mcp login <server>`. All dynamic shell arguments are
quoted. Session deletion uses the CLI after the UI's destructive confirmation,
keeping Codex-managed storage consistent.

## Lifecycle integration

`helpers/install.sh` installs into the default user directories or an isolated
`--prefix`, preserving unrelated hook handlers. It wires `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`,
`Interrupt`, and `SessionEnd` in `hooks.json`. Users trust definitions in `/hooks`.

`fleet-event.py` validates session IDs, writes registry files atomically with
private permissions, and walks process ancestry to locate Codex. An owner PID
plus process start time provides liveness; PID reuse invalidates an entry.
`SessionEnd` marks the record ended. Unknown owners do not become live agents.
Shared app-server PIDs are excluded from Stop actions. Standalone terminal owners
can receive OSC title updates; hooks emit no model-facing output.

## History, usage, and configuration

History discovery recurses through `$CODEX_HOME/sessions`. A chunked UTF-8 reader
handles partial rows; metadata is cached by mtime and size. `session_meta`,
`turn_context`, legacy user/agent events, newer completed message items, and
cumulative token events provide the UI model. Duplicate completed item IDs are
ignored. The optional SQLite summary reader is read-only, bounded, and falls
back to rollouts on missing/unsupported schemas. Session names override derived
prompt titles. Internal formats may change; unknown records are ignored.

Usage uses cumulative total tokens, or input plus output if a total is absent.
Cached input and reasoning output are subsets, not additional tokens. No model
price table or subscription billing inference is used.

Configuration is TOML parsed with `smol-toml`. Setting the default model changes
only the top-level unquoted model key, retains comments/profiles, validates the
result, and backs up the original. Unusual key spellings require direct editing.
Models come from the CLI cache rather than a hard-coded catalog. MCP uses JSON
configuration/auth output, never labels a configured server as connected.
Personal skill creation validates names and uses `~/.agents/skills`; discovery
also includes `$CODEX_HOME/skills`.

## Checkpoints and recovery

Every submitted turn snapshots tracked and untracked non-ignored files via a
temporary git index. Clean trees are included. Refs live under
`refs/codex-checkpoints/<worktree-key>/turn`, with 20 retained per worktree.
Undo shows a diff, asks for confirmation, requires a safety snapshot, restores
tracked paths using `git restore`, and removes remaining untracked paths. This
restores file content, not the original staged/unstaged split. It does not rewind
commits or external effects. Avoid undo while another process edits the worktree.

`codex-restore` lists or reopens non-ended, stopped fleet entries seen within a
week, using process start times to avoid mistaking recycled PIDs for agents.

## Validation and limits

Vitest covers inherited GitHub/Ghostty behavior plus Codex parsing, tokens, MCP,
TOML editing, liveness and CLI construction. Python tests use temporary git repos
and installation prefixes to verify checkpoint/undo, worktree reuse, lifecycle
states, and idempotent hook merging. Live Raycast/Ghostty UI requires macOS manual
verification. No service or daemon is installed by this project.
