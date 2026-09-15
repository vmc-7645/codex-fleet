import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { parse } from "smol-toml";
import { run } from "./exec";
import { CODEX_DIR } from "./paths";

export const configPaths = {
  settings: join(CODEX_DIR, "config.toml"),
  settingsLocal: join(CODEX_DIR, "hooks.json"),
  globalMemory: join(CODEX_DIR, "AGENTS.md"),
};
type Hooks = Record<
  string,
  { matcher?: string; hooks?: { command?: string; type?: string }[] }[]
>;
type Settings = {
  hooks?: Hooks;
  plugins?: Record<string, { enabled?: boolean }>;
  model?: string;
};
export function readSettings(): Settings {
  const config = existsSync(configPaths.settings)
    ? (parse(readFileSync(configPaths.settings, "utf8")) as Settings)
    : {};
  const fileHooks = existsSync(configPaths.settingsLocal)
    ? (JSON.parse(readFileSync(configPaths.settingsLocal, "utf8"))
        .hooks as Hooks)
    : {};
  const hooks: Hooks = { ...config.hooks };
  for (const [event, groups] of Object.entries(fileHooks || {}))
    hooks[event] = [...(hooks[event] || []), ...groups];
  return { ...config, hooks };
}
export function hookEvents(): { event: string; count: number }[] {
  return Object.entries(readSettings().hooks || {}).map(([event, groups]) => ({
    event,
    count: groups.reduce((n, g) => n + (g.hooks?.length || 0), 0),
  }));
}
export function enabledPlugins(): string[] {
  return Object.entries(readSettings().plugins || {})
    .filter(([, p]) => p.enabled !== false)
    .map(([name]) => name);
}
export function currentModel(): string {
  return readSettings().model || "default";
}
export function setModel(model: string): void {
  mkdirSync(CODEX_DIR, { recursive: true });
  const original = existsSync(configPaths.settings)
    ? readFileSync(configPaths.settings, "utf8")
    : "";
  const parsed = parse(original);
  // TOML permits many equivalent key spellings. Reject ones the line editor
  // cannot preserve instead of appending a duplicate setting.
  const lines = original.split("\n");
  const table = lines.findIndex((l) => /^\s*\[/.test(l));
  const topEnd = table < 0 ? lines.length : table;
  const index = lines.findIndex(
    (l, i) => i < topEnd && /^\s*model\s*=/.test(l),
  );
  if (parsed.model !== undefined && index < 0)
    throw new Error(
      "Edit this model setting directly in config.toml (nonstandard TOML key).",
    );
  if (index >= 0) lines.splice(index, 1);
  if (model && model !== "default")
    lines.unshift(`model = ${JSON.stringify(model)}`);
  const next = lines.join("\n");
  parse(next); // Validate before touching the original.
  if (original)
    writeFileSync(`${configPaths.settings}.bak.${Date.now()}`, original, {
      mode: 0o600,
    });
  writeFileSync(configPaths.settings, next, { mode: 0o600 });
}
export function availableModels(): { title: string; value: string }[] {
  const out = [{ title: "Default (unset)", value: "default" }];
  try {
    const cache = JSON.parse(
      readFileSync(join(CODEX_DIR, "models_cache.json"), "utf8"),
    );
    for (const m of cache.models || [])
      if (typeof m.slug === "string" && m.visibility !== "hide")
        out.push({ title: m.display_name || m.slug, value: m.slug });
  } catch {
    /* The CLI fills this cache after login. */
  }
  const current = currentModel();
  if (!out.some((m) => m.value === current))
    out.push({ title: current, value: current });
  return out;
}
export function ensureFile(path: string, template: string): string {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, template, { mode: 0o600 });
  return path;
}
export async function codexVersion(): Promise<string> {
  try {
    return (await run("codex", ["--version"])).trim();
  } catch {
    return "unknown";
  }
}
