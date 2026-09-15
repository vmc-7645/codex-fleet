import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HELPERS = Path(__file__).resolve().parents[1]


class HelpersTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="codex-fleet-tests-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "myrepo"
        self.repo.mkdir()
        self.run_cmd(["git", "init", "-q", str(self.repo)])
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        (self.repo / "original.txt").write_text("original\n")
        self.git("add", ".")
        self.git("commit", "-qm", "Initial")

    def tearDown(self):
        self.temp.cleanup()

    def run_cmd(self, args, **kwargs):
        return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs).stdout

    def git(self, *args):
        return self.run_cmd(["git", "-C", str(self.repo), *args])

    def checkpoint(self):
        self.run_cmd(["bash", str(HELPERS / "hooks/checkpoint.sh")], input=json.dumps({"cwd": str(self.repo)}))

    def test_clean_checkpoint_undo_removes_new_tracked_files(self):
        self.checkpoint()
        self.assertTrue(self.git("for-each-ref", "refs/codex-checkpoints"))
        (self.repo / "original.txt").write_text("changed\n")
        (self.repo / "added.txt").write_text("new\n")
        self.git("add", "added.txt")
        self.run_cmd(["bash", str(HELPERS / "bin/codex-undo")], cwd=self.repo, input="y\n")
        self.assertEqual((self.repo / "original.txt").read_text(), "original\n")
        self.assertFalse((self.repo / "added.txt").exists())
        self.assertIn("/preundo/", self.git("for-each-ref", "refs/codex-checkpoints"))

    def test_checkpoint_preserves_index_and_existing_untracked_files(self):
        (self.repo / "original.txt").write_text("staged\n")
        self.git("add", "original.txt")
        (self.repo / "original.txt").write_text("unstaged\n")
        (self.repo / "personal.txt").write_text("keep\n")
        before = self.git("diff", "--cached")
        self.checkpoint()
        self.assertEqual(before, self.git("diff", "--cached"))
        (self.repo / "personal.txt").unlink()
        self.run_cmd(["bash", str(HELPERS / "bin/codex-undo")], cwd=self.repo, input="y\n")
        self.assertEqual((self.repo / "personal.txt").read_text(), "keep\n")
        self.assertEqual((self.repo / "original.txt").read_text(), "unstaged\n")

    def test_installer_merges_idempotently_and_preserves_other_handlers(self):
        prefix = self.root / "install with spaces"
        codex = prefix / "codex"
        codex.mkdir(parents=True)
        path = codex / "hooks.json"
        path.write_text(json.dumps({"description": "Keep me", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo other"}]}]}}))
        args = ["bash", str(HELPERS / "install.sh"), "--prefix", str(prefix)]
        self.run_cmd(args)
        first = json.loads(path.read_text())
        self.run_cmd(args)
        self.assertEqual(first, json.loads(path.read_text()))
        self.assertEqual(first["description"], "Keep me")
        self.assertEqual(len(first["hooks"]["Stop"]), 2)
        self.assertIn("PermissionRequest", first["hooks"])
        self.assertNotIn("Notification", first["hooks"])
        self.assertFalse((codex / "config.toml").exists())

    def test_hook_records_states_without_emitting_context(self):
        codex = self.root / "codex"
        env = {**os.environ, "CODEX_HOME": str(codex)}
        payload = {"session_id": "test-session", "cwd": str(self.repo), "prompt": "Test the hook", "hook_event_name": "UserPromptSubmit"}
        def send(event):
            payload["hook_event_name"] = event
            self.assertEqual(self.run_cmd(["python3", str(HELPERS / "hooks/fleet-event.py")], env=env, input=json.dumps(payload)), "")
            return json.loads((codex / "fleet/test-session.json").read_text())
        self.assertEqual(send("UserPromptSubmit")["state"], "working")
        self.assertEqual(send("PermissionRequest")["state"], "waiting")
        self.assertEqual(send("Stop")["state"], "done")
        self.assertTrue(send("SessionEnd")["ended"])

    def test_worktree_creation_and_reuse_without_opening_terminal(self):
        env = {**os.environ, "CODEX_WT_NO_OPEN": "1"}
        args = ["bash", str(HELPERS / "bin/codex-worktree"), "feat/test"]
        self.assertIn("CODEX_WT_DIR=", self.run_cmd(args, cwd=self.repo, env=env))
        self.assertIn("reusing", self.run_cmd(args, cwd=self.repo, env=env))
        wrong = subprocess.run(["bash", str(HELPERS / "bin/codex-worktree"), "feat/other", "test"], cwd=self.repo, env=env, capture_output=True)
        self.assertNotEqual(wrong.returncode, 0)


if __name__ == "__main__":
    unittest.main()
