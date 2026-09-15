// Spawn Agent — pick a repo, give a task (+optional branch), and launch an
// agent in a fresh worktree. SPEC §5.3.

import {
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
} from "@raycast/api";
import { useState } from "react";
import { reposConfig, resolveRepoPath } from "./lib/repos";
import { useRepoOptions, RepoDropdown } from "./lib/repo-field";
import { spawnAgent } from "./lib/codex";
import { prefs } from "./lib/prefs";
import { basename } from "path";

function slug(task: string): string {
  const s = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s || "task";
}

export default function Command() {
  const root = prefs().reposRoot;
  const options = useRepoOptions(root);
  const { defaultRepo } = reposConfig(root);
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repoValue = String(values.repo || "");
    const task = String(values.task || "").trim();
    const branchIn = String(values.branch || "").trim();
    if (!repoValue) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    const branch = branchIn || `agent/${slug(task || "task")}`;
    setLoading(true);
    await closeMainWindow();
    try {
      if (repoValue.includes("/")) await showHUD(`Cloning ${repoValue}…`);
      const path = await resolveRepoPath(repoValue, root);
      if (!path) throw new Error("repo not found");
      await spawnAgent(path, branch, task || undefined);
      await showHUD(`Spawned ${basename(path)}:${branch}`);
    } catch (e) {
      await showHUD(`❌ ${String(e).slice(0, 80)}`);
      setLoading(false);
    }
  }

  return (
    <Form
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Spawn Agent"
            icon={Icon.Rocket}
            onSubmit={onSubmit}
          />
        </ActionPanel>
      }
    >
      <RepoDropdown id="repo" options={options} defaultRepo={defaultRepo} />
      <Form.TextField
        id="task"
        title="Task"
        placeholder="what should the agent do?"
      />
      <Form.TextField
        id="branch"
        title="Branch"
        placeholder="optional — defaults to agent/<slug>"
      />
    </Form>
  );
}
