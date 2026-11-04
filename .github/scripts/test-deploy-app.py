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
    if args[0] == "exec":
        program = args[3] if args[1] == "-i" else args[2]
        if program == "psql": print(10 ** 20 if mode == "disk-full" else 4096)
        elif program == "pg_dump":
            if mode == "backup-failure": sys.exit(4)
            sys.stdout.write("PGDMP synthetic archive")
        elif program == "pg_restore":
            sys.stdin.read()
            if mode == "unreadable-backup": sys.exit(1)
            if mode != "incomplete-backup":
                # A real listing continues long after the matching table line.
                try:
                    print("215; 1259 16401 TABLE public planning_items common_week_app")
                    for index in range(200000): print(f"{index}; 0 0 ACL public table_{index} common_week_app")
                    sys.stdout.flush()
                except BrokenPipeError:
                    sys.exit(141)
        sys.exit(0)
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
elif args[0] == "run" and "scripts/migrate.mjs" in args and mode == "migration-failure": sys.exit(7)
elif args[0] == "run" and "--before-migration" in args and mode == "role-preflight-failure": sys.exit(9)
elif args[0] == "run" and "--require-compatible" in args and mode == "role-postcheck-failure": sys.exit(9)
elif args[0] == "up": (root / "started").touch()
elif args[0] == "ps": print(new_id if (root / "started").exists() else (replacement_id if mode == "container-replaced" else old_id))
elif args[0] == "exec" and mode == "health-failure": sys.exit(6)
'''


class DeploymentSafetyTests(unittest.TestCase):
    def run_fixture(self, mode="success", acknowledged=True, flag="--recovery-reviewed", old_backups=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "deploy").mkdir()
            backups = root / "deploy" / "backups" / "common-week"
            if old_backups:
                backups.mkdir(parents=True)
                for index in range(old_backups):
                    (backups / f"common-week-20260101T{index:06d}Z-before-{'0' * 40}.dump").write_text("old")
                (backups / "unrelated-notes.txt").write_text("keep")
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
                args.append(flag)
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
            self.backups = sorted(p.name for p in backups.iterdir()) if backups.exists() else []
            return result, compose_calls, calls

    def test_success_stops_worker_before_migration_and_recreates_only_app(self):
        result, calls, all_calls = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        stop = ["stop", "-t", "60", "common-week"]
        migrate = ["run", "--rm", "--no-deps", "-T", "common-week", "node", "scripts/migrate.mjs"]
        restart = ["up", "-d", "--force-recreate", "--no-deps", "--no-build", "common-week"]
        preflight = ["run", "--rm", "--no-deps", "-T", "common-week", "node", "scripts/check-offline-recovery-role.mjs", "--before-migration"]
        postcheck = ["run", "--rm", "--no-deps", "-T", "common-week", "node", "scripts/check-offline-recovery-role.mjs", "--require-compatible"]
        self.assertLess(calls.index(preflight), calls.index(stop))
        self.assertLess(calls.index(stop), calls.index(migrate))
        self.assertLess(calls.index(migrate), calls.index(postcheck))
        self.assertLess(calls.index(postcheck), calls.index(restart))
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

    def test_wrong_database_role_fails_before_stopping_app(self):
        result, calls, _ = self.run_fixture("role-preflight-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] in ("stop", "up") or "scripts/migrate.mjs" in call for call in calls))

    def test_wrong_receipt_owner_after_migration_keeps_worker_off(self):
        result, calls, _ = self.run_fixture("role-postcheck-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] == "up" for call in calls))
        self.assertEqual(calls[-1], ["stop", "-t", "60", "common-week"])

    def test_failed_health_stops_new_app_without_unsafe_rollback(self):
        result, calls, _ = self.run_fixture("health-failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls[-1], ["stop", "-t", "60", "common-week"])
        self.assertEqual(sum(call[0] == "up" for call in calls), 1)

    def test_verified_backup_precedes_stop_and_uses_no_credentials(self):
        for flag in ("--automatic-backup", "--recovery-reviewed"):
            with self.subTest(flag=flag):
                result, _, calls = self.run_fixture(flag=flag)
                self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
                dump = next(i for i, c in enumerate(calls) if c[:2] == ["docker", "exec"] and "pg_dump" in c)
                verify = next(i for i, c in enumerate(calls) if c[:3] == ["docker", "exec", "-i"] and "pg_restore" in c)
                stop = next(i for i, c in enumerate(calls) if c[0] == "docker-compose" and "stop" in c)
                self.assertLess(dump, verify)
                self.assertLess(verify, stop)
                self.assertEqual(calls[dump], ["docker", "exec", "shared_db", "pg_dump", "-U", "admin", "-d", "common_week", "-Fc"])
                self.assertEqual(len(self.backups), 1)
                self.assertRegex(self.backups[0], r"^common-week-\d{8}T\d{6}Z-before-" + "b" * 40 + r"\.dump$")
                self.assertIn("Verified pre-release backup", result.stdout)

    def test_backup_problems_stop_release_while_current_build_serves(self):
        for mode, message in (("backup-failure", "backup failed"), ("unreadable-backup", "could not be read back"), ("incomplete-backup", "missing the planner tables"), ("disk-full", "Not enough free disk")):
            with self.subTest(mode=mode):
                result, calls, _ = self.run_fixture(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stdout)
                self.assertFalse(any(call[0] in ("stop", "up") or "scripts/migrate.mjs" in call for call in calls))
                self.assertEqual(self.backups, [])

    def test_backup_retention_keeps_twenty_newest_release_backups_only(self):
        result, _, _ = self.run_fixture(old_backups=25)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        dumps = [name for name in self.backups if name.endswith(".dump")]
        self.assertEqual(len(dumps), 20)
        self.assertIn("unrelated-notes.txt", self.backups)
        self.assertTrue(any(("b" * 40) in name for name in dumps))

    def test_unknown_release_flag_is_rejected_before_host_commands(self):
        result, _, calls = self.run_fixture(flag="--skip-backup")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_recovery_review_is_required_before_host_commands(self):
        result, _, calls = self.run_fixture(acknowledged=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
