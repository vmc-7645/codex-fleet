// `→ Codex` actions: open a terminal tab running a command (resume / fork /
// review / spawn / undo), raise the terminal, and stop an agent. Tab open/
// activate route through the terminal abstraction (default Ghostty); Focus Tab /
// Nudge / Close Tab drive an exact Ghostty tab via accessibility. SPEC §8.

import { runAppleScript } from "@raycast/utils";
import { homedir } from "os";
import { readTranscripts } from "./history";
import { readActiveSessions } from "./sessions";
import { Agent } from "./types";
import { run } from "./exec";
import { AgentTab, TabCandidate, chooseTab } from "./tabmatch";
import { enumerateGhostty, focusWindowTab } from "./ghostty";
import {
  openTerminalTab,
  activateTerminalApp,
  focusSupported,
  shq,
  asStr,
} from "./terminal";

export async function resumeAgent(a: Agent): Promise<void> {
  await openTerminalTab(a.cwd, `codex resume ${shq(a.sessionId)}`);
}

export async function forkAgent(a: Agent): Promise<void> {
  await openTerminalTab(a.cwd, `codex fork ${shq(a.sessionId)}`);
}

// The agent's working-tree changes vs HEAD, for the detail pane. Capped so a
// huge diff can't bloat the pane; returns "" when there's nothing / not a repo.
const MAX_DIFF = 20000;
export async function fullDiff(cwd: string): Promise<string> {
  if (!cwd) return "";
  try {
    const out = await run("git", ["-C", cwd, "diff", "HEAD"]);
    if (!out.trim()) return "";
    return out.length > MAX_DIFF
      ? out.slice(0, MAX_DIFF) + "\n… (diff truncated)"
      : out;
  } catch {
    return ""; // no HEAD / not a git repo / cwd gone
  }
}

// The worktree's current branch — the strong, deterministic half of the match.
async function branchOf(cwd: string): Promise<string> {
  try {
    return (
      await run("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
  } catch {
    return "";
  }
}

export async function focusAgentTab(agent: Agent): Promise<boolean> {
  if (!focusSupported()) return false; // only Ghostty exposes per-tab titles
  const id: AgentTab = {
    repo: agent.repo,
    branch: await branchOf(agent.cwd),
    task: agent.title,
    state: agent.state,
  };

  // Flatten the window/tab tree into candidates; chooseTab ranks them (score,
  // then status-emoji to disambiguate two agents on the same repo:branch, then
  // a real tab T over the window-title fallback W).
  const windows = await enumerateGhostty();
  const candidates: TabCandidate[] = [];
  for (const w of windows) {
    candidates.push({
      kind: "W",
      win: w.index,
      tab: 0,
      fs: w.fs,
      title: w.title,
    });
    for (const t of w.tabs)
      candidates.push({
        kind: "T",
        win: w.index,
        tab: t.index,
        fs: w.fs,
        title: t.title,
      });
  }

  const best = chooseTab(id, candidates);
  if (!best) return false; // no match → caller raises the terminal
  // Switch Spaces for a fullscreen target OR any background window (win !== 1):
  // a background window may sit on another Space, which activate/AXRaise can't
  // reach on their own.
  const spaceSwitch = best.fs || best.win !== 1;
  return focusWindowTab(
    best.win,
    best.kind === "T" ? best.tab : null,
    spaceSwitch,
  );
}

// Focus the agent's exact tab; fall back to just raising the terminal if no
// match (or if the terminal isn't Ghostty). Returns true only when an exact tab
// was focused, so callers can tell the difference in their HUD.
export async function focusOrRaise(agent: Agent): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) await activateTerminalApp();
  return ok;
}

// Close the agent's Ghostty tab (focus it, then ⌘W).
export async function closeAgentTab(agent: Agent): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) return false;
  await runAppleScript(
    'tell application "System Events" to keystroke "w" using {command down}',
  );
  return true;
}

// Type a follow-up into the agent's tab (focus it, then type + Return). Empty
// text just presses Return — accept a default / submit, or answer a numbered
// prompt by passing "1", "y", etc. Used by both Nudge and the Quick Reply presets.
export async function nudgeAgent(agent: Agent, text: string): Promise<boolean> {
  const ok = await focusAgentTab(agent);
  if (!ok) return false;
  const lines = ['tell application "System Events"'];
  if (text) lines.push(`  keystroke ${asStr(text)}`);
  lines.push("  key code 36", "end tell");
  await runAppleScript(lines.join("\n"));
  return true;
}

export function resumeCommand(agent: Agent): string {
  return `cd ${shq(agent.cwd)} && codex resume ${shq(agent.sessionId)}`;
}

// Open a folder in the configured editor (e.g. `code <path>`).
export async function openInEditor(
  path: string,
  editorCmd: string,
): Promise<void> {
  await run(editorCmd, [path]);
}

// Start a fresh Codex session in a repo (no worktree).
export async function newSessionInRepo(repoPath: string): Promise<void> {
  await openTerminalTab(repoPath, "codex");
}

// Open the supported MCP login/list CLI commands.
export async function openMcpAuth(name?: string): Promise<void> {
  await openTerminalTab(
    homedir(),
    name ? `codex mcp login ${shq(name)}` : "codex mcp list",
  );
}

// Run `codex doctor` in a tab.
export async function runDoctor(): Promise<void> {
  await openTerminalTab(homedir(), "codex doctor");
}

// Open the most-recent session for a directory in a new tab.
export async function continueInDir(cwd: string): Promise<void> {
  await openTerminalTab(cwd, "codex resume --last");
}

export async function reviewPR(
  repoPath: string,
  prNumber: number,
): Promise<void> {
  await openTerminalTab(
    repoPath,
    `codex ${shq(`Review pull request #${prNumber} in this repository. Use gh pr view and gh pr diff to inspect the PR, including its base and head. Report actionable findings with file and line references. Do not modify files or post a review unless asked.`)}`,
  );
}

// Create (or reuse) the worktree for `branch`. The NEW helper honors
// CODEX_WT_NO_OPEN — it skips opening a tab and prints `CODEX_WT_DIR=<path>`,
// which we return so the caller opens the tab itself (project-affinity window
// targeting, the ⌘T recipe living only in ghostty.ts).
//
// Backward-compat: an OLD installed helper (~/.local/bin, not re-run through
// helpers/install.sh) ignores CODEX_WT_NO_OPEN and opens the tab ITSELF. So we
// also pass CODEX_WT_PROMPT — the old helper uses it to start `codex <task>`
// as before — and return null to signal "already opened, nothing more to do".
// (Without this, dropping CODEX_WT_PROMPT made the old helper launch a bare
// `codex` with no prompt.)
async function makeWorktree(
  repoPath: string,
  branch: string,
  task?: string,
): Promise<string | null> {
  const env: Record<string, string> = { CODEX_WT_NO_OPEN: "1" };
  if (task) env.CODEX_WT_PROMPT = task;
  const out = await run("codex-worktree", [branch], { cwd: repoPath, env });
  const m = out.match(/^CODEX_WT_DIR=(.+)$/m);
  return m ? m[1].trim() : null; // null = old helper already opened the tab
}

export async function spawnAgent(
  repoPath: string,
  branch: string,
  task?: string,
): Promise<void> {
  const dir = await makeWorktree(repoPath, branch, task);
  if (dir) await openTerminalTab(dir, task ? `codex ${shq(task)}` : "codex");
}

// Open codex-undo in a tab — it shows its own diff + confirmation (safer than a
// silent revert). SPEC §5.1.
export async function openUndo(cwd: string): Promise<void> {
  await openTerminalTab(cwd, "codex-undo");
}

// Interrupt only a currently verified standalone Codex process.
export function stopAgent(pid: number): void {
  if (
    !Number.isInteger(pid) ||
    pid <= 1 ||
    !readActiveSessions().some((s) => s.pid === pid)
  ) {
    throw new Error(
      "This session has no verified standalone Codex process to interrupt. Focus its terminal instead.",
    );
  }
  process.kill(pid, "SIGINT");
}

// Resolve a PR branch to its local worktree and newest matching saved session.
export async function resumeFromPr(
  repoPath: string,
  prNumber: number,
): Promise<void> {
  const branch = (
    await run(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--json",
        "headRefName",
        "-q",
        ".headRefName",
      ],
      { cwd: repoPath },
    )
  ).trim();
  if (!branch) throw new Error("Could not resolve PR branch");
  const cwd = await worktreeForBranch(repoPath, branch);
  if (!cwd)
    throw new Error(
      "No local worktree for this PR. Use Check Out & Work first.",
    );
  const latest = [...readTranscripts().values()]
    .filter((m) => m.cwd === cwd && (!m.branch || m.branch === branch))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!latest)
    throw new Error(
      "No saved Codex session for this PR worktree. Use Check Out & Work first.",
    );
  await openTerminalTab(cwd, `codex resume ${shq(latest.sessionId)}`);
}

// Find the worktree (if any) that already has `branch` checked out.
async function worktreeForBranch(
  repoPath: string,
  branch: string,
): Promise<string | null> {
  try {
    const out = await run("git", [
      "-C",
      repoPath,
      "worktree",
      "list",
      "--porcelain",
    ]);
    let path = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (
        line.startsWith("branch ") &&
        line.slice("branch ".length).replace("refs/heads/", "") === branch
      )
        return path;
    }
  } catch {
    // fall through
  }
  return null;
}

// Start an agent on a PR. If the PR's branch is already checked out in a worktree
// (a branch can only live in one worktree), open the agent THERE; otherwise
// create a fresh worktree. SPEC §5.2.
export async function checkoutAndWork(
  repoPath: string,
  repo: string,
  prNumber: number,
  title: string,
): Promise<void> {
  const branch = (
    await run(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "-R",
        repo,
        "--json",
        "headRefName",
        "-q",
        ".headRefName",
      ],
      {
        cwd: repoPath,
      },
    )
  ).trim();
  if (!branch) throw new Error("could not resolve PR branch");
  const task = `Working on PR #${prNumber}: ${title}`;

  // Open the agent in the branch's existing worktree if it has one; otherwise
  // create the worktree and open it — both through the affinity opener. A fresh
  // worktree made by an OLD helper is already opened by the helper (dir === null).
  const existing = await worktreeForBranch(repoPath, branch);
  if (existing) {
    await openTerminalTab(existing, `codex ${shq(task)}`);
    return;
  }
  const dir = await makeWorktree(repoPath, branch, task);
  if (dir) await openTerminalTab(dir, `codex ${shq(task)}`);
}
