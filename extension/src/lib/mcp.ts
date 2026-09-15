import { run } from "./exec";
export interface McpServer {
  name: string;
  url: string;
  status: string;
  connected: boolean;
  needsAuth: boolean;
}
export function parseMcpServers(value: unknown): McpServer[] {
  if (!Array.isArray(value))
    throw new Error("Unexpected codex mcp list JSON response");
  return value
    .filter((v) => v && typeof v.name === "string")
    .map((v) => {
      const auth = String(v.auth_status || "unknown");
      const enabled = v.enabled !== false;
      return {
        name: v.name,
        url:
          v.transport?.url ||
          [v.transport?.command, ...(v.transport?.args || [])]
            .filter(Boolean)
            .join(" "),
        status: enabled ? auth.replace(/_/g, " ") : "disabled",
        connected: false,
        needsAuth: enabled && auth === "not_logged_in",
      };
    });
}
export async function listMcpServers(): Promise<McpServer[]> {
  return parseMcpServers(
    JSON.parse(await run("codex", ["mcp", "list", "--json"])),
  );
}
