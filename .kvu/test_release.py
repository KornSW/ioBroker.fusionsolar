"""Unit tests for .kvu/release.py - run with: python -m unittest discover -s .kvu -p "test_*.py" """
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

RELEASE_PY = Path(__file__).resolve().parent / "release.py"

README = """# Title

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**

- (KornSW) Breaking Change: requires Node.js 22
- (KornSW) fixed something

### 1.3.1

- (KornSW) Updated adapter-core

### 1.3.0

- (KornSW) Version updates

## License

MIT
"""


def load_release(root: Path, branch: str = "master"):
    """Imports release.py with KVU_ROOT pointing to the given directory (and a fixed branch, independent of the
    local Git default branch and of GITHUB_REF in CI)."""
    os.environ["KVU_ROOT"] = str(root)
    os.environ["KVU_BRANCH"] = branch
    spec = importlib.util.spec_from_file_location(f"kvu_release_{id(root)}", RELEASE_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


class TempRepo:
    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="kvu-test-"))
        run_git(self.root, "init", "-q")
        run_git(self.root, "config", "user.name", "Tester")
        run_git(self.root, "config", "user.email", "tester@example.com")

    def write(self, relative: str, content: str) -> None:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def read(self, relative: str) -> str:
        return (self.root / relative).read_text(encoding="utf-8")

    def commit(self, message: str) -> None:
        run_git(self.root, "add", "-A")
        run_git(self.root, "commit", "-q", "-m", message)

    def cleanup(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)


class ClassifyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kvu = load_release(Path(tempfile.gettempdir()))

    def test_breaking_change_is_major(self):
        # regression: the WP edition used r"breaking\\s*change" and never matched
        version, grade, _ = self.kvu.classify(["Breaking Change: removed X"], (1, 3, 1))
        self.assertEqual(version, (2, 0, 0))
        self.assertEqual(grade, "major")

    def test_keywords_are_case_insensitive_and_whitespace_tolerant(self):
        self.assertEqual(self.kvu.classify(["BREAKINGCHANGE"], (1, 0, 0))[0], (2, 0, 0))
        self.assertEqual(self.kvu.classify(["new  feature: kiosk mode"], (1, 0, 0))[0], (1, 1, 0))

    def test_fix(self):
        self.assertEqual(self.kvu.classify(["fixed a typo"], (1, 2, 3))[0], (1, 2, 4))

    def test_breaking_change_below_1_is_minor(self):
        self.assertEqual(self.kvu.classify(["Breaking Change"], (0, 4, 2))[0], (0, 5, 0))

    def test_mvp(self):
        version, _, ordered = self.kvu.classify(["fix", "This is the **MVP**"], (0, 9, 1))
        self.assertEqual(version, (1, 0, 0))
        self.assertEqual(ordered[0], "This is the **MVP**")

    def test_order_major_minor_fix(self):
        _, _, ordered = self.kvu.classify(["a fix", "New Feature x", "Breaking Change y"], (1, 0, 0))
        self.assertEqual(ordered, ["Breaking Change y", "New Feature x", "a fix"])


class ReadmeSectionTests(unittest.TestCase):
    def setUp(self):
        self.repo = TempRepo()
        self.repo.write(".kvu/kvu.json", json.dumps({"changelog": {"mode": "readme-section", "file": "README.md"},
                                                     "fallbackEntry": "({author}) {subject}",
                                                     "versionInfoFile": None}))

    def tearDown(self):
        self.repo.cleanup()

    def test_releases_upcoming_entries(self):
        self.repo.write("README.md", README)
        self.repo.commit("initial")
        kvu = load_release(self.repo.root)
        kvu.main()

        readme = self.repo.read("README.md")
        self.assertNotIn("### **WORK IN PROGRESS**\n", readme.split("-->", 1)[1])
        self.assertIn("    ### **WORK IN PROGRESS**", readme)  # placeholder comment stays untouched
        self.assertRegex(readme, r"### 2\.0\.0 \(\d{4}-\d{2}-\d{2}\)\n\n- \(KornSW\) Breaking Change: requires Node\.js 22\n"
                                 r"- \(KornSW\) fixed something\n\n### 1\.3\.1")
        self.assertTrue(readme.rstrip().endswith("MIT"))
        result = json.loads(self.repo.read("dist/release-result.json"))
        self.assertEqual(result["version"], "2.0.0")
        self.assertEqual(result["tag"], "v2.0.0")
        self.assertEqual(result["previousVersion"], "1.3.1")

    def test_git_fallback_without_upcoming_section(self):
        self.repo.write("README.md", README.replace("### **WORK IN PROGRESS**\n\n- (KornSW) Breaking Change: requires Node.js 22\n"
                                                    "- (KornSW) fixed something\n\n", ""))
        self.repo.commit("initial")
        self.repo.write("a.txt", "x")
        self.repo.commit("New Feature: something new")
        self.repo.write("b.txt", "x")
        self.repo.commit("previous release -> VERSIONING")
        kvu = load_release(self.repo.root)
        kvu.main()

        readme = self.repo.read("README.md")
        self.assertIn("### 1.4.0 (", readme)
        self.assertIn("- (Tester) New Feature: something new", readme)
        self.assertNotIn("VERSIONING", readme)
        self.assertLess(readme.index("### 1.4.0"), readme.index("### 1.3.1"))
        self.assertGreater(readme.index("### 1.4.0"), readme.index("-->"))

    def test_crlf_is_preserved(self):
        self.repo.write("README.md", "")
        (self.repo.root / "README.md").write_bytes(README.replace("\n", "\r\n").encode("utf-8"))
        self.repo.commit("initial")
        load_release(self.repo.root).main()
        raw = (self.repo.root / "README.md").read_bytes()
        self.assertNotIn(b"\r\r", raw)
        self.assertEqual(raw.count(b"\n"), raw.count(b"\r\n"))


class VersionFilesTests(unittest.TestCase):
    def setUp(self):
        self.repo = TempRepo()

    def tearDown(self):
        self.repo.cleanup()

    def test_version_files_keep_their_formatting(self):
        package = {"name": "x", "version": "1.3.1", "dependencies": {"a": "^1.0.0"}}
        lock = {"name": "x", "version": "1.3.1", "lockfileVersion": 3, "packages": {"": {"name": "x", "version": "1.3.1"}}}
        io_package = {"common": {"name": "x", "version": "1.3.1", "news": {"1.3.1": {"en": "ä ö ü"}}}, "native": {}}
        self.repo.write("package.json", json.dumps(package, indent=2) + "\n")
        self.repo.write("package-lock.json", json.dumps(lock, indent=2) + "\n")
        self.repo.write("io-package.json", json.dumps(io_package, indent=4, ensure_ascii=False) + "\n")
        self.repo.write("README.md", README)
        self.repo.write(".kvu/kvu.json", json.dumps({
            "changelog": {"mode": "readme-section", "file": "README.md"},
            "versionInfoFile": "doc/versioninfo.json",
            "versionFiles": [
                {"file": "package.json", "path": ["version"]},
                {"file": "package-lock.json", "path": ["version"]},
                {"file": "package-lock.json", "path": ["packages", "", "version"]},
                {"file": "io-package.json", "path": ["common", "version"]},
            ],
        }))
        self.repo.commit("initial")
        load_release(self.repo.root).main()

        package["version"] = "2.0.0"
        lock["version"] = "2.0.0"
        lock["packages"][""]["version"] = "2.0.0"
        io_package["common"]["version"] = "2.0.0"
        self.assertEqual(self.repo.read("package.json"), json.dumps(package, indent=2) + "\n")
        self.assertEqual(self.repo.read("package-lock.json"), json.dumps(lock, indent=2) + "\n")
        self.assertEqual(self.repo.read("io-package.json"), json.dumps(io_package, indent=4, ensure_ascii=False) + "\n")
        info = json.loads(self.repo.read("doc/versioninfo.json"))
        self.assertEqual(info["currentVersion"], "2.0.0")
        self.assertEqual(info["changeGrade"], "major")


class PrereleaseTests(unittest.TestCase):
    def setUp(self):
        self.repo = TempRepo()
        self.repo.write("package.json", json.dumps({"name": "x", "version": "1.3.1"}, indent=2) + "\n")
        self.repo.write("README.md", README)
        self.repo.write(".kvu/kvu.json", json.dumps({
            "changelog": {"mode": "readme-section", "file": "README.md"},
            "versionFiles": [{"file": "package.json", "path": ["version"]}],
        }))
        self.repo.commit("initial")

    def tearDown(self):
        self.repo.cleanup()

    def test_identifier_is_sanitized(self):
        kvu = load_release(self.repo.root)
        self.assertEqual(kvu.prerelease_identifier("feature/Kiosk_Mode"), "feature-Kiosk-Mode")
        self.assertEqual(kvu.prerelease_identifier("modernize-2026"), "modernize-2026")
        self.assertEqual(kvu.prerelease_identifier("2026"), "b2026")
        self.assertEqual(kvu.prerelease_identifier("///"), "dev")

    def test_prerelease_on_other_branch_keeps_the_changelog(self):
        load_release(self.repo.root, "feature/kiosk").main()
        result = json.loads(self.repo.read("dist/release-result.json"))
        self.assertEqual(result["version"], "2.0.0-feature-kiosk.1")
        self.assertEqual(result["tag"], "v2.0.0-feature-kiosk.1")
        self.assertTrue(result["prerelease"])
        self.assertEqual(self.repo.read("README.md"), README)  # upcoming entries stay for the stable release
        self.assertEqual(json.loads(self.repo.read("package.json"))["version"], "2.0.0-feature-kiosk.1")
        info = json.loads(self.repo.read("doc/versioninfo.json"))
        self.assertEqual(info["currentVersion"], "2.0.0")
        self.assertEqual(info["currentVersionWithSuffix"], "2.0.0-feature-kiosk.1")
        self.assertEqual(info["releaseType"], "feature-kiosk")

    def test_prerelease_number_increments(self):
        run_git(self.repo.root, "tag", "v2.0.0-feature-kiosk.1")
        run_git(self.repo.root, "tag", "v2.0.0-feature-kiosk.4")
        run_git(self.repo.root, "tag", "v2.0.0-other.9")
        load_release(self.repo.root, "feature/kiosk").main()
        self.assertEqual(json.loads(self.repo.read("dist/release-result.json"))["version"], "2.0.0-feature-kiosk.5")

    def test_prerelease_tags_are_no_fallback_boundary(self):
        # without upcoming entries the commits since the last STABLE tag decide - a pre-release tag in between
        # must not hide the earlier "Breaking Change"
        self.repo.write("README.md", README.replace("### **WORK IN PROGRESS**\n\n- (KornSW) Breaking Change: requires Node.js 22\n"
                                                    "- (KornSW) fixed something\n\n", ""))
        self.repo.commit("prepare")
        run_git(self.repo.root, "tag", "v1.3.1")
        self.repo.write("a.txt", "x")
        self.repo.commit("Breaking Change: something")
        run_git(self.repo.root, "tag", "v2.0.0-dev.1")
        self.repo.write("b.txt", "x")
        self.repo.commit("a small fix")
        load_release(self.repo.root, "dev").main()
        self.assertEqual(json.loads(self.repo.read("dist/release-result.json"))["version"], "2.0.0-dev.2")

    def test_main_branch_is_configurable(self):
        self.repo.write(".kvu/kvu.json", json.dumps({
            "changelog": {"mode": "readme-section", "file": "README.md"},
            "versionFiles": [{"file": "package.json", "path": ["version"]}],
            "mainBranch": "main",
        }))
        load_release(self.repo.root, "main").main()
        self.assertEqual(json.loads(self.repo.read("dist/release-result.json"))["version"], "2.0.0")
        self.assertIn("### 2.0.0 (", self.repo.read("README.md"))


class ClassicFileModeTests(unittest.TestCase):
    def test_classic_changelog_file(self):
        repo = TempRepo()
        try:
            repo.write("doc/changelog.md", "# Change log\n\n## Upcoming Changes\n\n- New Feature: x\n\n## v 1.0.4\n"
                                           "released **2026-09-04**, including:\n - Fix\n")
            repo.commit("initial")
            load_release(repo.root).main()
            text = repo.read("doc/changelog.md")
            self.assertIn("## Upcoming Changes\n\n*(none)*\n\n## v 1.1.0\nreleased **", text)
            self.assertIn("## v 1.0.4", text)
        finally:
            repo.cleanup()


if __name__ == "__main__":
    unittest.main()
