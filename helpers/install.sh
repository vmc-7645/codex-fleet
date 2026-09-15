#!/usr/bin/env bash
# Install helpers and merge hooks.json. Never changes config.toml or hook trust.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="$HOME/.local/bin"
codex_dir="${CODEX_HOME:-$HOME/.codex}"
merge=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-merge) merge=0; shift ;;
    --prefix) [ "$#" -ge 2 ] || exit 2; bin="$2/bin"; codex_dir="$2/codex"; shift 2 ;;
    *) echo 'usage: helpers/install.sh [--no-merge] [--prefix <directory>]' >&2; exit 2 ;;
  esac
done
command -v python3 >/dev/null || { echo 'python3 is required' >&2; exit 1; }
command -v jq >/dev/null || { echo 'jq is required' >&2; exit 1; }
mkdir -p "$bin" "$codex_dir/hooks/codex-fleet" "$codex_dir/completions"
for name in codex-worktree codex-undo codex-restore; do
  cp "$here/bin/$name" "$bin/$name"
  chmod +x "$bin/$name"
done
cp "$here/hooks/"* "$codex_dir/hooks/codex-fleet/"
chmod +x "$codex_dir/hooks/codex-fleet/"*
cp "$here/completions/codex-worktree.zsh" "$codex_dir/completions/"
python3 - "$here/hooks.settings.json" "$codex_dir" "$merge" <<'PY'
import json,os,shlex,sys,tempfile,time
from pathlib import Path
source,root,merge=sys.argv[1:]
root=Path(root).resolve()
add=json.loads(Path(source).read_text())['hooks']
for groups in add.values():
    for group in groups:
        for hook in group['hooks']:
            hook['command']=shlex.quote(str(root/'hooks'/'codex-fleet'/hook['command']))
if merge == '0':
    print(json.dumps({'hooks':add},indent=2));sys.exit(0)
p=root/'hooks.json'
original=p.read_text() if p.exists() else '{}'
cur=json.loads(original)
if not isinstance(cur,dict) or not isinstance(cur.get('hooks',{}),dict):
    raise ValueError('hooks.json must contain a hooks object')
if p.exists():
    backup=p.with_name(p.name+'.bak.'+str(time.time_ns()));backup.write_text(original);backup.chmod(0o600)
managed='/hooks/codex-fleet/'
for event,groups in add.items():
    existing=cur.setdefault('hooks',{}).get(event,[])
    kept=[]
    for group in existing:
        handlers=[h for h in group.get('hooks',[]) if managed not in h.get('command','')]
        if handlers:kept.append({**group,'hooks':handlers})
    cur['hooks'][event]=kept+groups
fd,tmp=tempfile.mkstemp(prefix='.hooks-',dir=root)
with os.fdopen(fd,'w') as f:json.dump(cur,f,indent=2);f.write('\n')
os.replace(tmp,p)
print('Merged '+str(p))
PY
printf 'Installed Codex Fleet helpers in %s\n' "$bin"
printf 'Restart Codex, then use /hooks to review and trust the installed hooks.\n'
printf 'Optional zsh completion: source "%s/completions/codex-worktree.zsh"\n' "$codex_dir"
