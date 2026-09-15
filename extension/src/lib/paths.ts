import { homedir } from "os";
import { join } from "path";

export const CODEX_DIR = process.env.CODEX_HOME || join(homedir(), ".codex");
export const FLEET_DIR = join(CODEX_DIR, "fleet");
