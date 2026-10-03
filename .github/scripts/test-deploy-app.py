"""Synthetic host-command tests. No Docker, SSH, database or provider calls run."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("deploy-app.sh")
MOCK = '''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ["PLANNER_TEST_STATE"])
mode = os.environ["PLANNER_TEST_MODE"]
command = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
old_id, new_id, replacement_id = "1" * 64, "2" * 64, "3" * 64
with (root / "trace").open("a") as log:
    log.write(json.dumps([command, *args]) + "\\n")
if command in ("flock", "sleep"):
    sys.exit(1 if command == "flock" and mode == "lock-conflict" else 0)
if command == "docker":
    if args[0] == "ps": print(old_id[:12])
    elif args[0] == "inspect":
        template, container = args[2], args[3]
        if template == "{{.Id}}":
            print(next(value for value in (old_id, new_id, replacement_id) if value.startswith(container)))
        elif template == "{{.Config.Image}}":
            sha = "b" * 40 if container == new_id else "a" * 40
            print("ghcr.io/jimgreco/common-week:" + sha)
        elif template == "{{.Image}}": print("sha256:retained")
        elif template == "{{json .Config.Labels}}":
            labels = {"com.docker.compose.depends_on": "", "com.docker.compose.version": "2.26.1"}
            if mode == "missing-dependency-label": del labels["com.docker.compose.depends_on"]
            if mode == "dependency-label-drift": labels["com.docker.compose.depends_on"] = "db:service_started:false"
            if mode == "container-version-drift": labels["com.docker.compose.version"] = "2.27.0"
            print(json.dumps(labels))
        elif "config-hash" in template: print("a" * 64)
        elif "working_dir" in template: print(root / "deploy")
        elif "config_files" in template:
            print(str(root / "compose.yml") + (("," + str(root / "override.yml")) if mode == "multiple-files" else ""))
        elif "project" in template: print("deploy")
        elif "Config.Env" in template:
            print("APP_BUILD=" + ("c" if mode == "changed-live" else "a") * 40)
            print("NEXT_PUBLIC_APP_URL=https://weekofus.com")
    sys.exit(0)
stdin_model = "-" in args
while args and args[0] in ("-p", "-f", "--project-directory"):
    args = args[2:]
alternate_modes = ("no-deps", "roundtrip-drift", "config-drift", "missing-dependency-label", "dependency-label-drift", "container-version-drift", "binary-version-drift")
if args[0] == "version": print("2.27.0" if mode == "binary-version-drift" else "2.26.1")
elif args[0] == "config":
    if "--format" in args:
        print(json.dumps({"services": {"common-week": {"depends_on": {"db": {"condition": "service_started"}}, "environment": {"VALUE": "synthetic-$$literal"}}, "db": {"image": "postgres:16"}}}))
    elif stdin_model:
        model = json.load(sys.stdin)
        with (root / "models").open("a") as log: log.write(json.dumps(model) + "\\n")
        full = "depends_on" in model["services"]["common-week"]
        char = "e" if mode == "roundtrip-drift" else ("d" if full or mode == "config-drift" else "a")
        print("common-week " + char * 64)
    else: print("common-week " + ("d" if mode in alternate_modes else "a") * 64)
elif args[0] == "pull" and mode == "pull-failure": sys.exit(8)
elif args[0] == "run" and mode == "migration-failure": sys.exit(7)
elif args[0] == "up": (root / "started").touch()
elif args[0] == "ps": print(new_id if (root / "started").exists() else (replacement_id if mode == "container-replaced" else old_id))
elif args[0] == "exec" and mode == "health-failure": sys.exit(6)
'''


class DeploymentSafetyTests(unittest.TestCase):
    def run_fixture(self, mode="success", acknowledged=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deploy").mkdir()
            (root / "bin").mkdir()
            (root / "compose.yml").touch()
            (root / "override.yml").touch()
            runner = root / "mock"
            runner.write_text(MOCK)
            runner.chmod(0o755)
            for name in ("docker", "docker-compose", "flock", "sleep"):
                (root / "bin" / name).symlink_to(runner)
            # Redirect the two fixed host filesystem paths only. All deployment
            # control flow and external command arguments are the committed code.
            script = root / "deploy-app.sh"
            script.write_text(SCRIPT.read_text().replace('"$HOME/deploy', '"' + str(root / "deploy")))
            args = ["bash", str(script), "b" * 40, "a" * 40]
            if acknowledged:
                args.append("--recovery-reviewed")
            result = subprocess.run(args, text=True, capture_output=True, env={
                **os.environ, "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"],
                "PLANNER_TEST_STATE": str(root), "PLANNER_TEST_MODE": mode,
            }, timeout=10)
            trace = root / "trace"
            calls = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
            compose_calls = []
            for call in calls:
                if call[0] != "docker-compose":
                    continue
                args = call[1:]
                while args and args[0] in ("-p", "-f", "--project-directory"):
                    args = args[2:]
                compose_calls.append(args)
            return result, compose_calls, calls

    def test_success_stops_worker_before_migration_and_recreates_only_app(self):
        result, calls, all_calls = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        stop = ["stop", "-t", "60", "common-week"]
        migrate = ["run", "--rm", "--no-deps", "-T", "common-week", "node", "scripts/migrate.mjs"]
        restart = ["up", "-d", "--force-recreate", "--no-deps", "--no-build", "common-week"]
        self.assertLess(calls.index(stop), calls.index(migrate))
        self.assertLess(calls.index(migrate), calls.index(restart))
        self.assertIn(["docker", "image", "tag", "sha256:retained", "common-week-retained:" + "a" * 40], all_calls)
        self.assertFalse(any("db" in call or "rm" in call for call in calls))

    def test_short_docker_id_and_full_compose_id_identify_same_container(self):
        result, _, calls = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn(["docker", "inspect", "--format", "{{.Id}}", "1" * 12], calls)
        self.assertIn(["docker", "inspect", "--format", "{{.Id}}", "1" * 64], calls)

    def test_replacement_container_still_blocks_before_stop(self):
        result, calls, _ = self.run_fixture("container-replaced")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Live container changed", result.stdout)
        self.assertFalse(any(call[0] in ("stop", "run", "up") for call in calls))

    def test_no_deps_hash_requires_full_model_roundtrip_then_scoped_match(self):
        result, calls, all_calls = self.run_fixture("no-deps")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        stdin_hashes = [call for call in all_calls if call[0] == "docker-compose" and "-" in call]
        self.assertEqual(len(stdin_hashes), 2)
        self.assertTrue(any(call[0] == "up" for call in calls))

    def test_no_deps_alternate_rejects_uncertain_identity_and_lossy_roundtrip(self):
        for mode in ("roundtrip-drift", "missing-dependency-label", "dependency-label-drift", "container-version-drift", "binary-version-drift"):
            with self.subTest(mode=mode):
                result, calls, _ = self.run_fixture(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(call[0] in ("pull", "stop", "run", "up") for call in calls))

    def test_all_effective_compose_files_are_preserved(self):
        result, _, calls = self.run_fixture("multiple-files")
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        for call in calls:
            if call[0] == "docker-compose":
                self.assertEqual(call.count("-f"), 2)
                self.assertTrue(call[4].endswith("/compose.yml"))
                self.assertTrue(call[6].endswith("/override.yml"))

    def test_shared_host_lock_prevents_overlapping_release(self):
        result, _, calls = self.run_fixture("lock-conflict")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call[0] for call in calls], ["flock"])

    def test_configuration_drift_fails_before_pull_or_stop(self):
        result, calls, _ = self.run_fixture("config-drift")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] in ("pull", "stop", "run", "up") for call in calls))

    def test_changed_live_commit_fails_before_compose(self):
        result, calls, _ = self.run_fixture("changed-live")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_registry_failure_does_not_stop_app(self):
        result, calls, _ = self.run_fixture("pull-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] in ("stop", "run", "up") for call in calls))

    def test_failed_migration_keeps_old_worker_off(self):
        result, calls, _ = self.run_fixture("migration-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] == "up" for call in calls))
        self.assertEqual(calls[-1], ["stop", "-t", "60", "common-week"])
        self.assertIn("88c34e7 or later", result.stdout)

    def test_failed_health_stops_new_app_without_unsafe_rollback(self):
        result, calls, _ = self.run_fixture("health-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls[-1], ["stop", "-t", "60", "common-week"])
        self.assertEqual(sum(call[0] == "up" for call in calls), 1)

    def test_recovery_review_is_required_before_host_commands(self):
        result, _, calls = self.run_fixture(acknowledged=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
