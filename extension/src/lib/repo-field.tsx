// Shared repo picker used by Review PR / New Session / Spawn Agent. Shows local
// repos first (instant, recency-sorted), then a "Remote" section of everything
// you can access on GitHub (globe-tagged, owner/name), excluding ones already
// cloned locally. Remote picks are cloned on submit via resolveRepoPath().

import { Form, Icon } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { listRepos, listRemoteRepos, Repo, RemoteRepo } from "./repos";

export interface RepoOptions {
  local: Repo[];
  remote: RemoteRepo[];
  loadingRemote: boolean;
}

// Local repos synchronously; remote repos fetched in the background.
export function useRepoOptions(root?: string): RepoOptions {
  const local = useMemo(() => listRepos(root), [root]);
  const [remote, setRemote] = useState<RemoteRepo[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(true);
  useEffect(() => {
    let alive = true;
    listRemoteRepos()
      .then((r) => alive && (setRemote(r), setLoadingRemote(false)))
      .catch(() => alive && setLoadingRemote(false));
    return () => {
      alive = false;
    };
  }, []);
  return { local, remote, loadingRemote };
}

export function RepoDropdown(props: {
  id: string;
  title?: string;
  options: RepoOptions;
  defaultRepo?: string;
}) {
  const { local, remote, loadingRemote } = props.options;
  const localNames = new Set(local.map((r) => r.name));
  const remoteOnly = remote.filter((r) => !localNames.has(r.name));
  return (
    <Form.Dropdown
      id={props.id}
      title={props.title || "Repo"}
      isLoading={loadingRemote}
      defaultValue={props.defaultRepo || local[0]?.name}
    >
      <Form.Dropdown.Section title="Local">
        {local.map((r) => (
          <Form.Dropdown.Item
            key={`l:${r.name}`}
            value={r.name}
            title={r.name}
            icon={Icon.HardDrive}
          />
        ))}
      </Form.Dropdown.Section>
      <Form.Dropdown.Section
        title={loadingRemote ? "Remote (loading…)" : "Remote"}
      >
        {remoteOnly.map((r) => (
          <Form.Dropdown.Item
            key={`r:${r.nameWithOwner}`}
            value={r.nameWithOwner}
            title={r.nameWithOwner}
            icon={Icon.Globe}
          />
        ))}
      </Form.Dropdown.Section>
    </Form.Dropdown>
  );
}
