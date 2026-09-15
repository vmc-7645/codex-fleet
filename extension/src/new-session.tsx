// New Session — pick a repo (local or remote) and start a fresh Codex session
// there (no worktree). Remote repos are cloned on demand.

import {
  Form,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  showHUD,
  closeMainWindow,
  popToRoot,
} from "@raycast/api";
import { useState } from "react";
import { reposConfig, resolveRepoPath } from "./lib/repos";
import { useRepoOptions, RepoDropdown } from "./lib/repo-field";
import { newSessionInRepo } from "./lib/codex";
import { prefs } from "./lib/prefs";
import { basename } from "path";

export default function Command() {
  const root = prefs().reposRoot;
  const options = useRepoOptions(root);
  const { defaultRepo } = reposConfig(root);
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repoValue = String(values.repo || "");
    if (!repoValue) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    setLoading(true);
    await closeMainWindow();
    try {
      if (repoValue.includes("/")) await showHUD(`Cloning ${repoValue}…`);
      const path = await resolveRepoPath(repoValue, root);
      if (!path) throw new Error("repo not found");
      await newSessionInRepo(path);
      await showHUD(`New Codex session in ${basename(path)}`);
      await popToRoot();
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
            title="Start Session"
            icon={Icon.Terminal}
            onSubmit={onSubmit}
          />
        </ActionPanel>
      }
    >
      <RepoDropdown id="repo" options={options} defaultRepo={defaultRepo} />
    </Form>
  );
}
