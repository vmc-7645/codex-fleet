// Custom slash-command skills in ~/.agents/skills/<name>/SKILL.md. A skill is
// "disabled" by renaming SKILL.md → SKILL.md.disabled (Codex then ignores
// it).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import { CODEX_DIR } from "./paths";

export interface Skill {
  name: string;
  path: string; // the SKILL.md (or .disabled) file
  dir: string;
  description: string;
  disabled: boolean;
}

const SKILLS_DIR = join(homedir(), ".agents", "skills");

function frontmatterDesc(file: string): string {
  try {
    const txt = readFileSync(file, "utf8");
    const fm = txt.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return "";
    const d = fm[1].match(/^description:\s*(.+)$/m);
    return d ? d[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

export function listSkills(): Skill[] {
  const out: Skill[] = [];
  const seen = new Set<string>();
  for (const root of [SKILLS_DIR, join(CODEX_DIR, "skills")]) {
    let dirs: string[];
    try {
      dirs = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of dirs) {
      if (name.startsWith(".")) continue;
      const dir = join(root, name);
      const active = join(dir, "SKILL.md");
      const off = join(dir, "SKILL.md.disabled");
      const path = existsSync(active) ? active : existsSync(off) ? off : "";
      if (!path) continue;
      const real = realpathSync(path);
      if (seen.has(real)) continue;
      seen.add(real);
      out.push({
        name,
        path,
        dir,
        description: frontmatterDesc(path),
        disabled: path === off,
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function toggleSkill(skill: Skill): void {
  const active = join(skill.dir, "SKILL.md");
  const off = join(skill.dir, "SKILL.md.disabled");
  if (skill.disabled) renameSync(off, active);
  else renameSync(active, off);
}

export function createSkill(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error(
      "Use lowercase letters, digits, and hyphens for the skill name.",
    );
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      `---\nname: ${name}\ndescription: TODO — what this command does and when to use it.\n---\n\n# ${name}\n\nTODO: instructions.\n`,
    );
  }
  return file;
}
