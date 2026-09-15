#!/usr/bin/env python3
"""Codex hook adapter. Writes fleet state; emits no model-facing context."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def command(args):
    try:
        return subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=2, text=True).strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def owner():
    pid = os.getppid()
    for _ in range(12):
        if pid <= 1:
            break
        args = command(["ps", "-p", str(pid), "-o", "args="])
        executable = command(["ps", "-p", str(pid), "-o", "comm="])
        if Path(executable).name.lower() in ("codex", "codex-cli"):
            start = command(["ps", "-p", str(pid), "-o", "lstart="])
            standalone = not re.search(r"\b(app-server|exec|exec-server)\b", args)
            tty = command(["ps", "-p", str(pid), "-o", "tty="])
            return pid, start, standalone, tty
        parent = command(["ps", "-p", str(pid), "-o", "ppid="])
        pid = int(parent) if parent.isdigit() else 0
    return 0, "", False, ""


def clean(value, limit=60):
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", str(value))).strip()[:limit]


def main():
    payload = json.load(sys.stdin)
    sid = payload.get("session_id", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", sid):
        return
    root = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "fleet"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root / (sid + ".json")
    try:
        entry = json.loads(path.read_text())
    except (OSError, ValueError):
        entry = {}
    event = payload.get("hook_event_name", "")
    states = {"SessionStart": "idle", "UserPromptSubmit": "working", "PreToolUse": "working", "PostToolUse": "working", "PermissionRequest": "waiting", "Stop": "done", "Interrupt": "idle", "SessionEnd": "idle"}
    state = states.get(event, entry.get("state", "idle"))
    now = datetime.datetime.now().timestamp()
    cwd = payload.get("cwd") or os.getcwd()
    pid, start, standalone, tty = owner()
    if state != entry.get("state"):
        entry["state_since"] = now
    entry.update(session_id=sid, cwd=cwd, state=state, last_seen=now, ended=event == "SessionEnd")
    if pid:
        entry.update(owner_pid=pid, owner_start=start, standalone=standalone, tty=tty)
    entry.setdefault("started", now)
    entry.setdefault("state_since", now)
    entry["repo"] = Path(cwd).name
    entry["branch"] = command(["git", "-C", cwd, "branch", "--show-current"])
    if payload.get("prompt"):
        entry["task"] = clean(payload["prompt"])
    if payload.get("permission_mode"):
        entry["mode"] = payload["permission_mode"]
    tool = payload.get("tool_name", "")
    if tool:
        entry["last_tool"] = clean(tool)
    entry["state_reason"] = clean(payload.get("tool_input", {}).get("description") or tool or "approval requested", 200) if state == "waiting" else ""
    if state in ("done", "waiting"):
        entry["diff"] = command(["git", "-C", cwd, "diff", "--shortstat"])
    fd, tmp = tempfile.mkstemp(prefix=".fleet-", dir=root)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(entry, f)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    # Codex does not support Claude's terminalSequence hook output. A standalone
    # TUI's verified controlling tty can receive OSC; app-server sessions cannot.
    if standalone and re.fullmatch(r"(?:ttys[0-9]+|pts/[0-9]+)", tty):
        title = {"working": "⚙️", "waiting": "🔔", "done": "✅", "idle": "💤"}[state] + " " + clean(entry["repo"])
        if entry["branch"]:
            title += ":" + clean(entry["branch"])
        if entry.get("task"):
            title += " — " + clean(entry["task"], 40)
        try:
            fd = os.open("/dev/" + tty, os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)
            try:
                os.write(fd, ("\x1b]2;" + title + "\x07").encode())
            finally:
                os.close(fd)
        except OSError:
            pass


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, AttributeError):
        pass  # A status helper must not fail an agent turn.
