// Run a shell command with a PATH that actually finds the user's tools. Raycast
// strips the shell PATH, so gh / codex / jq / git / codex-worktree aren't
// found otherwise. We resolve the real login-shell PATH once (covers Intel vs
// Apple-Silicon Homebrew, nvm/asdf, and custom prefixes) and union it with a
// set of standard dirs as a floor.

import { execFile } from "child_process";
import { homedir } from "os";
import { promisify } from "util";

const pexec = promisify(execFile);

// Guaranteed floor, regardless of shell config: both Homebrew roots, user-local,
// and the system dirs.
const FALLBACK_DIRS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  `${homedir()}/.local/bin`,
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

// Marker so we can recover $PATH even if the user's rc files print to stdout.
const MARK = "__CC4R_PATH__";

// The user's real login+interactive shell PATH, queried once. Returns "" if the
// shell can't be run (we still have FALLBACK_DIRS). Timed out so a slow/hanging
// rc can't wedge the extension.
async function loginShellPath(): Promise<string> {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const { stdout } = await pexec(
      shell,
      ["-ilc", `printf '%s' "${MARK}$PATH"`],
      {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      },
    );
    const i = stdout.lastIndexOf(MARK);
    return i >= 0 ? stdout.slice(i + MARK.length).trim() : "";
  } catch {
    return "";
  }
}

let pathPromise: Promise<string> | undefined;

async function resolvedPath(): Promise<string> {
  if (!pathPromise) {
    pathPromise = (async () => {
      const parts = [
        process.env.PATH || "",
        await loginShellPath(),
        FALLBACK_DIRS.join(":"),
      ]
        .join(":")
        .split(":")
        .filter(Boolean);
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of parts) {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
      return out.join(":");
    })();
  }
  return pathPromise;
}

export async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<string> {
  const PATH = await resolvedPath();
  const { stdout } = await pexec(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, PATH, ...opts.env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
