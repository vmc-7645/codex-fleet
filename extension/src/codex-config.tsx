// Codex — config control panel: edit settings/AGENTS.md, inspect
// hooks/plugins/model, run doctor, show version.

import {
  List,
  ActionPanel,
  Action,
  Icon,
  Detail,
  Form,
  showHUD,
  closeMainWindow,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  configPaths,
  hookEvents,
  enabledPlugins,
  currentModel,
  setModel,
  ensureFile,
  codexVersion,
  availableModels,
  readSettings,
} from "./lib/config";
import { openInEditor, runDoctor } from "./lib/codex";
import { prefs } from "./lib/prefs";

export default function Command() {
  const { push } = useNavigation();
  const [version, setVersion] = useState("…");
  useEffect(() => {
    codexVersion().then(setVersion);
  }, []);
  const editor = prefs().editorCommand || "code";
  const edit = async (p: string) => {
    await closeMainWindow();
    await openInEditor(p, editor);
  };

  return (
    <List searchBarPlaceholder="Codex config…">
      <List.Section title="Edit">
        <Row
          icon={Icon.Gear}
          title="config.toml"
          onAction={() =>
            edit(ensureFile(configPaths.settings, "# Codex configuration\n"))
          }
        />
        <Row
          icon={Icon.Lock}
          title="hooks.json"
          onAction={() =>
            edit(ensureFile(configPaths.settingsLocal, '{"hooks": {}}\n'))
          }
        />
        <Row
          icon={Icon.Document}
          title="Global AGENTS.md"
          onAction={() =>
            edit(ensureFile(configPaths.globalMemory, "# Global memory\n\n"))
          }
        />
      </List.Section>
      <List.Section title="Inspect">
        <Row
          icon={Icon.Bolt}
          title="Hooks"
          subtitle={hookEvents()
            .map((h) => `${h.event}(${h.count})`)
            .join("  ")}
          onAction={() => push(<HooksView />)}
        />
        <Row
          icon={Icon.Box}
          title="Plugins"
          subtitle={enabledPlugins().join(", ") || "none"}
        />
        <Row
          icon={Icon.LightBulb}
          title="Default model"
          subtitle={currentModel()}
          onAction={() => push(<ModelPicker />)}
        />
      </List.Section>
      <List.Section title="Tools">
        <Row
          icon={Icon.Terminal}
          title="Run codex doctor"
          onAction={async () => {
            await closeMainWindow();
            await runDoctor();
          }}
        />
        <Row icon={Icon.Info} title="Version" subtitle={version} />
      </List.Section>
    </List>
  );
}

function Row({
  icon,
  title,
  subtitle,
  onAction,
}: {
  icon: Icon;
  title: string;
  subtitle?: string;
  onAction?: () => void;
}) {
  return (
    <List.Item
      icon={icon}
      title={title}
      subtitle={subtitle}
      actions={
        onAction ? (
          <ActionPanel>
            <Action title={title} icon={icon} onAction={onAction} />
          </ActionPanel>
        ) : undefined
      }
    />
  );
}

function HooksView() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hooks: any = readSettings().hooks || {};
  let md = "# Hooks\n\n";
  for (const event of Object.keys(hooks)) {
    md += `## ${event}\n\n`;
    for (const g of hooks[event] || []) {
      md += g.matcher ? `- matcher \`${g.matcher}\`\n` : `- (all)\n`;
      for (const h of g.hooks || []) md += `  - \`${h.command || h.type}\`\n`;
    }
    md += "\n";
  }
  return <Detail markdown={md} />;
}

function ModelPicker() {
  const { pop } = useNavigation();
  async function submit(values: Form.Values) {
    setModel(String(values.model));
    await showHUD(`Default model: ${String(values.model)}`);
    pop();
  }
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Model" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="model"
        title="Default model"
        defaultValue={currentModel()}
      >
        {availableModels().map((m) => (
          <Form.Dropdown.Item key={m.value} value={m.value} title={m.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
