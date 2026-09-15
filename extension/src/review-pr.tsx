// Review PR — pick a repo (local or remote) + PR number, open Codex to review
// it. Remote repos are cloned on demand. SPEC §5.4.

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
import { reviewPR } from "./lib/codex";
import { prefs } from "./lib/prefs";
import { basename } from "path";

export default function Command() {
  const root = prefs().reposRoot;
  const options = useRepoOptions(root);
  const { defaultRepo } = reposConfig(root);
  const [loading, setLoading] = useState(false);

  async function onSubmit(values: Form.Values) {
    const repoValue = String(values.repo || "");
    const n = parseInt(String(values.pr || ""), 10);
    if (!repoValue) {
      await showToast({ style: Toast.Style.Failure, title: "Pick a repo" });
      return;
    }
    if (!n || Number.isNaN(n)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Enter a PR number",
      });
      return;
    }
    setLoading(true);
    await closeMainWindow();
    try {
      if (repoValue.includes("/")) await showHUD(`Cloning ${repoValue}…`);
      const path = await resolveRepoPath(repoValue, root);
      if (!path) throw new Error("repo not found");
      await reviewPR(path, n);
      await showHUD(`Reviewing ${basename(path)}#${n}`);
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
            title="Review PR in Codex"
            icon={Icon.MagnifyingGlass}
            onSubmit={onSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="pr" title="PR Number" placeholder="e.g. 349" />
      <RepoDropdown id="repo" options={options} defaultRepo={defaultRepo} />
    </Form>
  );
}
