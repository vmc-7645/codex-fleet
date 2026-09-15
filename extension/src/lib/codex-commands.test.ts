import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  open: vi.fn(),
  run: vi.fn(),
  transcripts: vi.fn(),
}));
vi.mock("@raycast/utils", () => ({ runAppleScript: vi.fn() }));
vi.mock("./terminal", () => ({
  openTerminalTab: mock.open,
  activateTerminalApp: vi.fn(),
  focusSupported: () => false,
  shq: (s: string) => "'" + s.replace(/'/g, "'\\''") + "'",
  asStr: JSON.stringify,
}));
vi.mock("./ghostty", () => ({
  enumerateGhostty: vi.fn(),
  focusWindowTab: vi.fn(),
}));
vi.mock("./exec", () => ({ run: mock.run }));
vi.mock("./history", () => ({ readTranscripts: mock.transcripts }));
import {
  resumeAgent,
  forkAgent,
  continueInDir,
  reviewPR,
  openMcpAuth,
  resumeFromPr,
} from "./codex";
import { Agent } from "./types";
const agent: Agent = {
  sessionId: "session-id",
  cwd: "/tmp/myrepo",
  repo: "myrepo",
  title: "Task",
  live: false,
  state: "idle",
  updatedAt: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
});
it("generates Codex resume, fork, and continue commands", async () => {
  await resumeAgent(agent);
  expect(mock.open).toHaveBeenLastCalledWith(
    agent.cwd,
    "codex resume 'session-id'",
  );
  await forkAgent(agent);
  expect(mock.open).toHaveBeenLastCalledWith(
    agent.cwd,
    "codex fork 'session-id'",
  );
  await continueInDir(agent.cwd);
  expect(mock.open).toHaveBeenLastCalledWith(agent.cwd, "codex resume --last");
});
it("seeds a PR review and authenticates MCP with the supported CLI", async () => {
  await reviewPR(agent.cwd, 42);
  expect(mock.open.mock.calls[0][1]).toContain("Review pull request #42");
  expect(mock.open.mock.calls[0][1]).not.toContain("/review");
  await openMcpAuth("my-server");
  expect(mock.open.mock.calls[1][1]).toBe("codex mcp login 'my-server'");
});
it("resumes the newest matching PR worktree session", async () => {
  mock.run
    .mockResolvedValueOnce("feat/test\n")
    .mockResolvedValueOnce(
      "worktree /tmp/myrepo-worktrees/test\nbranch refs/heads/feat/test\n",
    );
  mock.transcripts.mockReturnValue(
    new Map([
      [
        "saved",
        {
          sessionId: "saved",
          cwd: "/tmp/myrepo-worktrees/test",
          branch: "feat/test",
          updatedAt: 5,
        },
      ],
    ]),
  );
  await resumeFromPr(agent.cwd, 42);
  expect(mock.open).toHaveBeenLastCalledWith(
    "/tmp/myrepo-worktrees/test",
    "codex resume 'saved'",
  );
});
