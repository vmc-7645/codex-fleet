import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseTranscript, recentMessages } from "./history";
import { totalTokens } from "./usage";
import { parseMcpServers } from "./mcp";

const dirs: string[] = [];
function fixture(rows: unknown[]) {
  const root = mkdtempSync(join(tmpdir(), "fleet-test-"));
  dirs.push(root);
  const path = join(root, "rollout.jsonl");
  writeFileSync(
    path,
    rows.map((r) => JSON.stringify(r)).join("\n") + '\n{"partial":',
  );
  return path;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe("Codex transcripts", () => {
  it("reads legacy event messages without duplicate response items or cumulative tokens", () => {
    const path = fixture([
      {
        type: "session_meta",
        payload: { id: "abc", cwd: "/tmp/myrepo", git: { branch: "main" } },
      },
      { type: "turn_context", payload: { model: "test-model" } },
      {
        type: "event_msg",
        payload: { type: "user_message", message: "Fix the tests" },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fix the tests" }],
        },
      },
      {
        type: "event_msg",
        payload: { type: "agent_message", message: "Done ✓" },
      },
      ...[1, 2].map(() => ({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 60,
              output_tokens: 20,
              reasoning_output_tokens: 10,
              total_tokens: 120,
            },
          },
        },
      })),
    ]);
    const m = parseTranscript(path);
    expect(m).toMatchObject({
      sessionId: "abc",
      cwd: "/tmp/myrepo",
      branch: "main",
      model: "test-model",
      turns: 1,
      lastMessage: "Done ✓",
      inputTokens: 100,
      cacheReadTokens: 60,
    });
    expect(totalTokens(m)).toBe(120);
    expect(recentMessages(path, 1)).toEqual([{ role: "a", text: "Done ✓" }]);
  });
  it("reads paginated item_completed messages, deduplicates ids, and preserves total-only usage", () => {
    const message = {
      type: "event_msg",
      payload: {
        type: "item_completed",
        item: {
          type: "UserMessage",
          id: "u1",
          content: [{ type: "Text", text: "Hello" }],
        },
      },
    };
    const path = fixture([
      {
        type: "session_meta",
        payload: {
          session_id: "def",
          cwd: "/tmp/myrepo",
          history_mode: "paginated",
        },
      },
      message,
      message,
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: { type: "AgentMessage", id: "a1", content: "Ready" },
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { total_tokens: 4321 } },
        },
      },
    ]);
    const m = parseTranscript(path);
    expect(m.turns).toBe(1);
    expect(m.title).toBe("Hello");
    expect(m.lastMessage).toBe("Ready");
    expect(totalTokens(m)).toBe(4321);
  });
});
it("reads MCP JSON without claiming a configured server is connected", () => {
  const rows = parseMcpServers([
    {
      name: "remote",
      transport: { url: "https://example.com/mcp" },
      auth_status: "not_logged_in",
    },
    {
      name: "local",
      transport: { command: "node", args: ["server.js"] },
      auth_status: "unsupported",
    },
  ]);
  expect(rows[0]).toMatchObject({ needsAuth: true, connected: false });
  expect(rows[1]).toMatchObject({
    url: "node server.js",
    needsAuth: false,
    connected: false,
  });
});
it("changes only the top-level TOML model and preserves profiles/comments", async () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-config-"));
  dirs.push(root);
  vi.stubEnv("CODEX_HOME", root);
  vi.resetModules();
  writeFileSync(
    join(root, "config.toml"),
    '# Keep this comment\nmodel = "old"\n[profiles.fast]\nmodel = "profile"\n',
  );
  const config = await import("./config");
  config.setModel("new");
  expect(config.currentModel()).toBe("new");
  expect(readFileSync(join(root, "config.toml"), "utf8")).toContain(
    '# Keep this comment\n[profiles.fast]\nmodel = "profile"',
  );
  config.setModel("default");
  expect(config.currentModel()).toBe("default");
});
it("does not call recent transcripts live without a verified hook process", async () => {
  const root = mkdtempSync(join(tmpdir(), "fleet-session-"));
  dirs.push(root);
  vi.stubEnv("CODEX_HOME", root);
  vi.resetModules();
  mkdirSync(join(root, "fleet"));
  writeFileSync(
    join(root, "fleet", "a.json"),
    JSON.stringify({
      session_id: "a",
      cwd: "/tmp/myrepo",
      owner_pid: process.pid,
      owner_start: "not this process",
      state: "working",
    }),
  );
  const { readActiveSessions } = await import("./sessions");
  expect(readActiveSessions()).toEqual([]);
});
