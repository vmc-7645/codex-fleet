// Liveness comes from installed Codex Fleet lifecycle hooks, never transcript mtime.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { FLEET_DIR } from "./paths";

export interface CodexSession {
  sessionId: string;
  cwd: string;
  pid: number;
  status: "busy" | "idle";
  name?: string;
  updatedAt: number;
}
export function processIdentity(pid: number): string {
  if (!Number.isInteger(pid) || pid <= 1) return "";
  try {
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();
  } catch {
    return "";
  }
}
export function readActiveSessions(): CodexSession[] {
  const out: CodexSession[] = [];
  let files: string[];
  try {
    files = readdirSync(FLEET_DIR);
  } catch {
    return out;
  }
  const identities = new Map<number, string>();
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    try {
      const j = JSON.parse(readFileSync(join(FLEET_DIR, f), "utf8"));
      if (
        j.ended ||
        typeof j.session_id !== "string" ||
        typeof j.cwd !== "string" ||
        !j.owner_start
      )
        continue;
      if (!identities.has(j.owner_pid))
        identities.set(j.owner_pid, processIdentity(j.owner_pid));
      if (identities.get(j.owner_pid) !== j.owner_start) continue;
      // Only standalone TUI processes are safe to SIGINT. App-server PIDs are shared.
      out.push({
        sessionId: j.session_id,
        cwd: j.cwd,
        pid: j.standalone ? j.owner_pid : 0,
        status: j.state === "working" ? "busy" : "idle",
        name: j.task,
        updatedAt: Number(j.state_since || j.last_seen || 0) * 1000,
      });
    } catch {
      /* Skip partial/malformed registry entries. */
    }
  }
  return out;
}
