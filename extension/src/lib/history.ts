// Codex rollout formats are internal. Keep parsing tolerant, stream large files,
// and cache metadata by mtime and size. No auth/config content is read here.
import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  readFileSync,
} from "fs";
import { join, basename } from "path";
import { StringDecoder } from "string_decoder";
import { execFileSync } from "child_process";
import { CODEX_DIR } from "./paths";
import { run } from "./exec";

export interface TranscriptMeta {
  sessionId: string;
  path: string;
  cwd: string;
  title: string;
  updatedAt: number;
  turns: number;
  lastMessage: string;
  model: string;
  branch?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  recordedTotalTokens: number;
}
const cache = new Map<
  string,
  { mtime: number; size: number; meta: TranscriptMeta }
>();
function empty(path: string): TranscriptMeta {
  return {
    sessionId: "",
    path,
    cwd: "",
    title: "",
    updatedAt: 0,
    turns: 0,
    lastMessage: "",
    model: "",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    recordedTotalTokens: 0,
  };
}
function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}
function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (!Array.isArray(v)) return "";
  return v
    .map((b) => str(record(b).text))
    .filter(Boolean)
    .join("\n")
    .trim();
}
function eachLine(path: string, onLine: (line: string) => void): void {
  const CHUNK = 1 << 18; // 256 KB
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return;
  }
  const buf = Buffer.allocUnsafe(CHUNK);
  // A multi-byte UTF-8 char can straddle a chunk boundary; StringDecoder holds
  // the partial bytes back until the next chunk completes them, where a plain
  // buf.toString() would emit U+FFFD and corrupt the JSON.
  const decoder = new StringDecoder("utf8");
  let tail = "";
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      const text = tail + decoder.write(buf.subarray(0, n));
      let start = 0;
      for (;;) {
        const nl = text.indexOf("\n", start);
        if (nl === -1) break;
        onLine(text.slice(start, nl));
        start = nl + 1;
      }
      tail = text.slice(start);
    }
    tail += decoder.end();
    if (tail) onLine(tail);
  } finally {
    closeSync(fd);
  }
}

// Event messages avoid counting the duplicate response_item representation.
function message(
  row: Record<string, unknown>,
): { role: "u" | "a"; text: string; id?: string } | undefined {
  if (row.type !== "event_msg") return;
  const p = record(row.payload);
  if (p.type === "user_message") return { role: "u", text: str(p.message) };
  if (p.type === "agent_message") return { role: "a", text: str(p.message) };
  if (p.type === "item_completed") {
    const it = record(p.item);
    if (it.type === "UserMessage" || it.type === "userMessage")
      return { role: "u", text: text(it.content), id: str(it.id) };
    if (it.type === "AgentMessage" || it.type === "agentMessage")
      return {
        role: "a",
        text: text(it.content) || str(it.text),
        id: str(it.id),
      };
  }
}
export function parseTranscript(path: string): TranscriptMeta {
  const m = empty(path);
  const seen = new Set<string>();
  eachLine(path, (line) => {
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (!row || typeof row !== "object") return;
    const p = record(row.payload);
    if (row.type === "session_meta") {
      m.sessionId = str(p.id) || str(p.session_id);
      m.cwd = str(p.cwd);
      m.branch = str(record(p.git).branch) || undefined;
    }
    if (row.type === "turn_context") {
      m.model = str(p.model) || m.model;
    }
    const msg = message(row);
    if (msg?.text && (!msg.id || !seen.has(msg.id))) {
      if (msg.id) seen.add(msg.id);
      if (msg.role === "u") {
        m.turns++;
        if (!m.title) m.title = msg.text.replace(/\s+/g, " ").slice(0, 100);
      } else m.lastMessage = msg.text.slice(0, 1200);
    }
    if (
      row.type === "event_msg" &&
      p.type === "task_complete" &&
      str(p.last_agent_message)
    )
      m.lastMessage = str(p.last_agent_message).slice(0, 1200);
    if (row.type === "event_msg" && p.type === "token_count") {
      const u = record(record(p.info).total_token_usage);
      if (Object.keys(u).length) {
        // The snapshot is cumulative; repeated token_count rows must not be summed.
        m.inputTokens = count(u.input_tokens);
        m.outputTokens = count(u.output_tokens);
        m.cacheReadTokens = count(u.cached_input_tokens);
        m.cacheWriteTokens = count(u.cache_write_input_tokens);
        m.recordedTotalTokens = count(u.total_tokens);
      }
    }
  });
  return m;
}
function rollouts(dir: string): string[] {
  const out: string[] = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) out.push(...rollouts(path));
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(path);
    }
  } catch {
    /* Missing or concurrently removed directory. */
  }
  return out;
}
// Current Codex can migrate history to SQLite. Read only its summary index;
// never modify the database or interpret its updated_at as proof of liveness.
function indexedThreads(): Record<string, unknown>[] {
  try {
    const db = readdirSync(CODEX_DIR)
      .filter((f) => /^state_\d+\.sqlite$/.test(f))
      .sort(
        (a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]),
      )[0];
    if (!db) return [];
    return JSON.parse(
      execFileSync(
        "/usr/bin/sqlite3",
        [
          "-readonly",
          "-json",
          join(CODEX_DIR, db),
          "SELECT id,rollout_path,cwd,title,updated_at,tokens_used,model,git_branch FROM threads WHERE archived=0",
        ],
        { encoding: "utf8", timeout: 2000, maxBuffer: 8 * 1024 * 1024 },
      ),
    );
  } catch {
    return [];
  } // Older schemas / SQLite missing: rollout reader still works.
}
export function readTranscripts(
  onlyIds?: Set<string>,
): Map<string, TranscriptMeta> {
  const out = new Map<string, TranscriptMeta>();
  const index = indexedThreads();
  const paths = new Set([
    ...rollouts(join(CODEX_DIR, "sessions")),
    ...index.map((j) => str(j.rollout_path)).filter(Boolean),
  ]);
  const indexedIds = new Map(
    index.map((j) => [str(j.rollout_path), str(j.id)]),
  );
  for (const path of paths) {
    const hint =
      indexedIds.get(path) ||
      basename(path).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    if (onlyIds && hint && !onlyIds.has(hint)) continue;
    try {
      const st = statSync(path);
      const c = cache.get(path);
      const meta =
        c && c.mtime === st.mtimeMs && c.size === st.size
          ? c.meta
          : parseTranscript(path);
      meta.updatedAt = st.mtimeMs;
      cache.set(path, { mtime: st.mtimeMs, size: st.size, meta });
      if (meta.sessionId && (!onlyIds || onlyIds.has(meta.sessionId)))
        out.set(meta.sessionId, { ...meta });
    } catch {
      /* Partial migration or a removed file. */
    }
  }
  for (const j of index) {
    const id = str(j.id);
    if (!id || (onlyIds && !onlyIds.has(id))) continue;
    const m = out.get(id) || empty(str(j.rollout_path));
    m.sessionId = id;
    m.cwd = str(j.cwd) || m.cwd;
    m.title = str(j.title) || m.title;
    m.model = str(j.model) || m.model;
    m.branch = str(j.git_branch) || m.branch;
    m.updatedAt = Math.max(m.updatedAt, count(j.updated_at) * 1000);
    m.recordedTotalTokens = Math.max(
      m.recordedTotalTokens,
      count(j.tokens_used),
    );
    out.set(id, m);
  }
  try {
    for (const line of readFileSync(
      join(CODEX_DIR, "session_index.jsonl"),
      "utf8",
    ).split("\n")) {
      try {
        const j = JSON.parse(line);
        const m = out.get(j.id);
        if (m && typeof j.thread_name === "string") m.title = j.thread_name;
      } catch {
        /* Partial row. */
      }
    }
  } catch {
    /* Optional name index. */
  }
  for (const path of cache.keys()) if (!paths.has(path)) cache.delete(path);
  return out;
}
// Use Codex's own deletion command so SQLite and rollout storage stay consistent.
export async function deleteSession(sessionId: string): Promise<void> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId))
    throw new Error("A valid session UUID is required");
  await run("codex", ["delete", "--force", sessionId]);
  cache.clear();
}
export function recentMessages(
  path: string,
  max: number,
): { role: "u" | "a"; text: string }[] {
  const out: { role: "u" | "a"; text: string }[] = [];
  if (max <= 0) return out;
  const seen = new Set<string>();
  eachLine(path, (line) => {
    try {
      const msg = message(JSON.parse(line));
      if (msg?.text && (!msg.id || !seen.has(msg.id))) {
        if (msg.id) seen.add(msg.id);
        out.push({ role: msg.role, text: msg.text.slice(0, 1200) });
        if (out.length > max) out.shift();
      }
    } catch {
      /* Partial JSON row. */
    }
  });
  return out;
}
