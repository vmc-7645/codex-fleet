// List git worktrees across your repos, and remove them. SPEC §5.8.

import { run } from "./exec";
import { listRepos } from "./repos";

export interface Worktree {
  repo: string;
  path: string;
  branch: string;
  isMain: boolean;
  mainPath: string; // the repo's primary worktree (where `remove` is run from)
  merged: boolean; // branch is merged into the repo's default branch (safe to remove)
}

// Branches merged into the repo's default branch (main/master).
async function mergedBranches(mainPath: string): Promise<Set<string>> {
  let def = "";
  try {
    def = (
      await run("git", [
        "-C",
        mainPath,
        "symbolic-ref",
        "--short",
        "refs/remotes/origin/HEAD",
      ])
    )
      .trim()
      .replace(/^origin\//, "");
  } catch {
    for (const c of ["main", "master"]) {
      try {
        await run("git", ["-C", mainPath, "rev-parse", "--verify", c]);
        def = c;
        break;
      } catch {
        // try next
      }
    }
  }
  if (!def) return new Set();
  try {
    const out = await run("git", [
      "-C",
      mainPath,
      "branch",
      "--merged",
      def,
      "--format=%(refname:short)",
    ]);
    const set = new Set(
      out
        .split("\n")
        .map((s) => s.trim().replace(/^\* /, ""))
        .filter(Boolean),
    );
    set.delete(def);
    return set;
  } catch {
    return new Set();
  }
}

export async function listWorktrees(
  overrideRoot?: string,
): Promise<Worktree[]> {
  const repos = listRepos(overrideRoot);
  const out: Worktree[] = [];
  for (const r of repos) {
    let txt: string;
    try {
      txt = await run("git", ["-C", r.path, "worktree", "list", "--porcelain"]);
    } catch {
      continue;
    }
    const merged = await mergedBranches(r.path);
    let path = "";
    let branch = "";
    const flush = () => {
      if (path) {
        const isMain = path === r.path;
        out.push({
          repo: r.name,
          path,
          branch,
          isMain,
          mainPath: r.path,
          merged: !isMain && merged.has(branch),
        });
      }
      path = "";
      branch = "";
    };
    for (const line of txt.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        path = line.slice("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "detached") {
        branch = "(detached)";
      }
    }
    flush();
  }
  return out;
}

export async function removeWorktree(wt: Worktree): Promise<void> {
  await run("git", [
    "-C",
    wt.mainPath,
    "worktree",
    "remove",
    wt.path,
    "--force",
  ]);
}
