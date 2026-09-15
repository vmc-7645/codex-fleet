// Detect missing dependencies so a first run explains itself instead of failing
// with a cryptic "command not found". Checked once, surfaced as a banner.

import { runAppleScript } from "@raycast/utils";
import { run } from "./exec";
import { terminalName } from "./terminal";

export interface Issue {
  key: string;
  title: string;
  detail: string;
}

async function onPath(cmd: string): Promise<boolean> {
  try {
    await run(cmd, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

// `id of application "X"` returns the bundle id if installed, errors otherwise.
async function appInstalled(name: string): Promise<boolean> {
  try {
    await runAppleScript(`id of application ${JSON.stringify(name)}`);
    return true;
  } catch {
    return false;
  }
}

// Return only the problems (empty = all good).
export async function preflight(): Promise<Issue[]> {
  const [hasCodex, hasGh, hasTerm] = await Promise.all([
    onPath("codex"),
    onPath("gh"),
    appInstalled(terminalName()),
  ]);
  const issues: Issue[] = [];
  if (!hasCodex)
    issues.push({
      key: "codex",
      title: "Codex CLI not found",
      detail:
        "Install Codex so `codex` is on your PATH — needed to open, resume, and review agents.",
    });
  if (!hasTerm)
    issues.push({
      key: "terminal",
      title: `${terminalName()} isn't installed`,
      detail:
        "Install it, or choose a different terminal in this extension's preferences (⌘,).",
    });
  if (!hasGh)
    issues.push({
      key: "gh",
      title: "GitHub CLI (gh) not found",
      detail:
        "Install gh and run `gh auth login` — needed for My PRs / My Issues and remote repos.",
    });
  return issues;
}
