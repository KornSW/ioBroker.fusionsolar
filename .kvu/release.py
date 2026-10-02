#!/usr/bin/env python3
"""KVU - Korn Versioning Utility (generic edition, derived from the WP-* release.py).

Calculates the next semantic version from the change log ("upcoming" entries) or - as a fallback - from the
Git commit subjects since the last version tag, materializes the version into the configured files, writes the
release into the change log and prints a JSON result for the CI workflow.

Change grade rules (case-insensitive, whitespace between the words optional):
  - "Breaking Change" -> major (0.x: minor)
  - "New Feature"     -> minor
  - "**MVP**"         -> 1.0.0 (only while the major version is 0)
  - anything else     -> fix

Branches: on the main branch (config "mainBranch", default "master") a stable version is released; on any other
branch a pre-release "<version>-<branch>.<n>" (e.g. 2.0.0-feature-kiosk.3) is created without touching the change log.

Configuration: .kvu/kvu.json (optional, see .kvu/README.md). Without a configuration file KVU behaves like the
original: change log in doc/changelog.md, version info in doc/versioninfo.json.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(os.environ.get("KVU_ROOT") or Path(__file__).resolve().parents[1])
CONFIG_FILE = ROOT / ".kvu" / "kvu.json"

SKIP_MARKERS_RE = re.compile(r"\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]", re.I)
SEMVER_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")

DEFAULT_CONFIG = {
    "changelog": {
        # "file": classic KVU change log file / "readme-section": a "## <section>" in a Markdown file
        "mode": "file",
        "file": "doc/changelog.md",
        # only for mode "readme-section":
        "section": "Changelog",
        "upcomingHeading": "**WORK IN PROGRESS**",
        "releaseHeading": "{version} ({date})",
        "keepEmptyUpcoming": False,
    },
    # format of change log entries taken from Git commit subjects (fallback); placeholders {subject}, {author}
    "fallbackEntry": "{subject}",
    # JSON files that receive the version; "path" is the list of keys to the version property
    "versionFiles": [],
    "versionInfoFile": "doc/versioninfo.json",
    "distDirectory": "dist",
    # releases from the main branch are stable; on any other branch a pre-release "<version>-<branch>.<n>" is created
    "mainBranch": "master",
    "prereleaseOnOtherBranches": True,
}

STABLE_TAG_RE = re.compile(r"^v?\d+\.\d+\.\d+$")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def load_config() -> dict:
    config = json.loads(json.dumps(DEFAULT_CONFIG))
    if CONFIG_FILE.exists():
        user = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        for key, value in user.items():
            if isinstance(value, dict) and isinstance(config.get(key), dict):
                config[key].update(value)
            else:
                config[key] = value
    return config


def read_lines(path: Path) -> tuple[list[str], str]:
    # read binary: read_text() would translate CRLF and the original line endings would get lost
    raw = path.read_bytes().decode("utf-8-sig")
    newline = "\r\n" if "\r\n" in raw else "\n"
    return raw.splitlines(), newline


def write_lines(path: Path, lines: list[str], newline: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(newline.join(lines).rstrip() + newline)


def parse_entries(lines: list[str]) -> list[str]:
    """Extracts the change entries (one per non-empty line, bullets removed) of an 'upcoming' block."""
    result = []
    for line in lines:
        s = line.strip()
        if not s or s == "*(none)*":
            continue
        if s.lower().startswith("released **"):
            continue
        if s.startswith("<!--"):
            continue
        if s.startswith("- ") or s.startswith("* "):
            s = s[2:].strip()
        result.append(s)
    return result


# ---------------------------------------------------------------------------------------------------------------------
# Change log stores
# ---------------------------------------------------------------------------------------------------------------------

class ChangelogFileStore:
    """Classic KVU change log: '## Upcoming Changes' followed by '## v x.y.z' blocks."""

    RELEASE_HEADER_RE = re.compile(r"^\s*##\s+v\s+(\d+)\.(\d+)\.(\d+)\s*$", re.I)
    UPCOMING_RE = re.compile(r"^\s*##\s+Upcoming Changes(?:\s+\(([^)]+)\))?\s*$", re.I)

    def __init__(self, cfg: dict):
        self.path = ROOT / cfg["file"]

    def read(self) -> tuple[tuple[int, int, int], list[str]]:
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text("# Change log\n\n## Upcoming Changes\n\n*(none)*\n", encoding="utf-8")
        self.lines, self.newline = read_lines(self.path)

        self.upcoming_idx = None
        self.first_release_idx = None
        latest = (0, 0, 0)
        for i, line in enumerate(self.lines):
            if self.UPCOMING_RE.match(line) and self.upcoming_idx is None:
                self.upcoming_idx = i
                continue
            rm = self.RELEASE_HEADER_RE.match(line)
            if rm and self.first_release_idx is None:
                self.first_release_idx = i
                latest = tuple(map(int, rm.groups()))

        if self.upcoming_idx is None:
            fail(f"{self.path.name} is missing '## Upcoming Changes'.")
        if self.first_release_idx is None:
            self.first_release_idx = len(self.lines)

        return latest, parse_entries(self.lines[self.upcoming_idx + 1:self.first_release_idx])

    def write(self, version: str, date_info: str, changes: list[str]) -> None:
        before = self.lines[:self.upcoming_idx]
        history = self.lines[self.first_release_idx:]
        block = [
            "## Upcoming Changes",
            "",
            "*(none)*",
            "",
            f"## v {version}",
            f"released **{date_info}**, including:",
        ]
        block.extend(f" - {c}" for c in changes)
        block.extend(["", ""])
        write_lines(self.path, before + block + history, self.newline)



class ReadmeSectionStore:
    """Change log inside a Markdown file (e.g. README.md):

        ## Changelog
        ### **WORK IN PROGRESS**      <- upcoming entries (optional)
        - entry
        ### 1.2.3 (2026-01-31)        <- releases, newest first
        - entry
    """

    # Markdown headings may be indented by up to 3 spaces (more = code block)
    H2_RE = re.compile(r"^ {0,3}##[ \t]+(.+?)\s*$")
    H3_RE = re.compile(r"^ {0,3}###[ \t]+(.+?)\s*$")
    RELEASE_RE = re.compile(r"^v?\s*(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?:\s+.*)?$")

    def __init__(self, cfg: dict):
        self.path = ROOT / cfg["file"]
        self.section = cfg["section"]
        self.upcoming_heading = cfg["upcomingHeading"]
        self.release_heading = cfg["releaseHeading"]
        self.keep_empty_upcoming = bool(cfg.get("keepEmptyUpcoming"))

    @staticmethod
    def normalize(text: str) -> str:
        return re.sub(r"[\s*_]+", " ", text).strip().lower()

    @staticmethod
    def hidden_lines(lines: list[str]) -> set[int]:
        """Indices of lines inside HTML comments or fenced code blocks (e.g. the ioBroker
        '### **WORK IN PROGRESS**' placeholder comment) - they must never be taken as headings."""
        hidden = set()
        in_comment = False
        fence = None
        for i, line in enumerate(lines):
            stripped = line.strip()
            if fence:
                hidden.add(i)
                if stripped.startswith(fence):
                    fence = None
                continue
            if in_comment:
                hidden.add(i)
                if "-->" in line:
                    in_comment = False
                continue
            if stripped.startswith("```") or stripped.startswith("~~~"):
                fence = stripped[:3]
                hidden.add(i)
                continue
            if "<!--" in line:
                hidden.add(i)
                if "-->" not in line.split("<!--", 1)[1]:
                    in_comment = True
        return hidden

    def read(self) -> tuple[tuple[int, int, int], list[str]]:
        if not self.path.exists():
            fail(f"{self.path.name} not found.")
        self.lines, self.newline = read_lines(self.path)
        hidden = self.hidden_lines(self.lines)

        self.section_start = None
        self.section_end = len(self.lines)
        for i, line in enumerate(self.lines):
            h2 = self.H2_RE.match(line)
            if not h2 or i in hidden:
                continue
            if self.section_start is None:
                if self.normalize(h2.group(1)) == self.normalize(self.section):
                    self.section_start = i
            else:
                self.section_end = i
                break
        if self.section_start is None:
            fail(f"{self.path.name} has no '## {self.section}' section.")

        self.upcoming_idx = None
        self.upcoming_end = None
        self.first_release_idx = None
        latest = (0, 0, 0)
        upcoming_key = self.normalize(self.upcoming_heading)
        for i in range(self.section_start + 1, self.section_end):
            h3 = self.H3_RE.match(self.lines[i])
            if not h3 or i in hidden:
                continue
            title = h3.group(1)
            if self.upcoming_idx is not None and self.upcoming_end is None:
                self.upcoming_end = i
            if self.normalize(title) == upcoming_key and self.upcoming_idx is None and self.first_release_idx is None:
                self.upcoming_idx = i
                continue
            rm = self.RELEASE_RE.match(title)
            if rm and self.first_release_idx is None:
                self.first_release_idx = i
                latest = tuple(map(int, rm.groups()[:3]))
        if self.upcoming_idx is not None and self.upcoming_end is None:
            self.upcoming_end = self.section_end
        if self.first_release_idx is None:
            self.first_release_idx = self.upcoming_end if self.upcoming_idx is not None else self.section_end

        incoming = []
        if self.upcoming_idx is not None:
            incoming = parse_entries(self.lines[self.upcoming_idx + 1:self.upcoming_end])
        return latest, incoming

    def write(self, version: str, date_info: str, changes: list[str]) -> None:
        heading = self.release_heading.format(version=version, date=date_info)
        block = [f"### {heading}", ""]
        block.extend(f"- {c}" for c in changes)
        block.append("")
        if self.keep_empty_upcoming:
            block = [f"### {self.upcoming_heading}", "", "*(none)*", ""] + block

        if self.upcoming_idx is not None:
            start, end = self.upcoming_idx, self.upcoming_end
        else:
            start = end = self.first_release_idx
            # keep a blank line between the preceding content and the new block
            if start > 0 and self.lines[start - 1].strip():
                block = [""] + block
        new_lines = self.lines[:start] + block + self.lines[end:]
        write_lines(self.path, new_lines, self.newline)



def create_store(config: dict):
    cfg = config["changelog"]
    if cfg.get("mode") == "readme-section":
        return ReadmeSectionStore(cfg)
    if cfg.get("mode", "file") == "file":
        return ChangelogFileStore(cfg)
    fail(f"Unknown changelog mode '{cfg.get('mode')}'.")


# ---------------------------------------------------------------------------------------------------------------------
# Git fallback and classification (unchanged KVU semantics)
# ---------------------------------------------------------------------------------------------------------------------

def newest_merged_version_tag() -> str | None:
    try:
        tags = git(
            "for-each-ref",
            "--merged=HEAD",
            "--sort=-creatordate",
            "--format=%(refname:short)",
            "refs/tags",
        ).splitlines()
    except subprocess.CalledProcessError:
        return None

    # only STABLE version tags are a boundary - pre-release tags of a branch (v2.0.0-dev.3) must not shorten the
    # range, otherwise a later pre-release would lose e.g. a "Breaking Change" of an earlier commit
    for tag in tags:
        if STABLE_TAG_RE.match(tag):
            return tag
    return None


# ---------------------------------------------------------------------------------------------------------------------
# Branch / pre-release handling
# ---------------------------------------------------------------------------------------------------------------------

def current_branch() -> str:
    """Branch name: KVU_BRANCH > GitHub Actions (GITHUB_REF=refs/heads/...) > local Git checkout."""
    explicit = os.environ.get("KVU_BRANCH", "").strip()
    if explicit:
        return explicit
    github_ref = os.environ.get("GITHUB_REF", "")
    if github_ref.startswith("refs/heads/"):
        return github_ref[len("refs/heads/"):]
    try:
        return git("rev-parse", "--abbrev-ref", "HEAD")
    except subprocess.CalledProcessError:
        return ""


def prerelease_identifier(branch: str) -> str:
    """Converts a branch name into a pre-release identifier ([a-zA-Z0-9-], as required by SemVer and ioBroker)."""
    identifier = re.sub(r"[^0-9A-Za-z-]+", "-", branch)
    identifier = re.sub(r"-{2,}", "-", identifier).strip("-")
    if not identifier:
        identifier = "dev"
    if identifier.isdigit():
        # purely numeric identifiers must not have leading zeros in SemVer - avoid the problem completely
        identifier = f"b{identifier}"
    return identifier


def next_prerelease_number(base_version: str, identifier: str) -> int:
    """Next free number n for the tag v<base>-<identifier>.<n> (all tags of the repository are considered)."""
    try:
        tags = git("tag", "--list", f"v{base_version}-{identifier}.*").splitlines()
    except subprocess.CalledProcessError:
        tags = []
    pattern = re.compile(rf"^v{re.escape(base_version)}-{re.escape(identifier)}\.(\d+)$")
    numbers = [int(m.group(1)) for m in (pattern.match(t.strip()) for t in tags) if m]
    return max(numbers, default=0) + 1


def git_fallback_changes(entry_format: str) -> list[str]:
    boundary = newest_merged_version_tag()
    range_arg = f"{boundary}..HEAD" if boundary else "HEAD"
    try:
        records = subprocess.check_output(
            ["git", "log", range_arg, "--format=%an%x09%s", "--max-count=20"],
            cwd=ROOT,
            text=True,
        ).splitlines()
    except subprocess.CalledProcessError:
        records = []

    result = []
    for record in records:
        author, _, subject = record.partition("\t")
        if "VERSIONING" in subject.upper():
            continue
        subject = SKIP_MARKERS_RE.sub("", subject).strip()
        if subject:
            result.append(entry_format.format(subject=subject, author=author))
    return result


def classify(changes: list[str], previous: tuple[int, int, int]):
    grade = "fix"
    mvp = False
    groups = {"major": [], "minor": [], "fix": []}
    mvp_lines = []

    for change in changes:
        lower = change.lower()
        if "**mvp**" in lower:
            mvp = True
            mvp_lines.append(change)

        # New Feature / Breaking Change may originate either from the
        # Markdown changelog or directly from a Git commit subject.
        # Recognition is case-insensitive and permits any amount of
        # whitespace between the two words, including no whitespace.
        is_breaking_change = re.search(r"breaking\s*change", change, re.IGNORECASE) is not None
        is_new_feature = re.search(r"new\s*feature", change, re.IGNORECASE) is not None

        if is_breaking_change:
            group = "major"
            grade = "major"
        elif is_new_feature:
            group = "minor"
            if grade != "major":
                grade = "minor"
        else:
            group = "fix"

        groups[group].append(change)

    if mvp_lines:
        for line in reversed(mvp_lines):
            for group in groups.values():
                while line in group:
                    group.remove(line)
            groups["major"].insert(0, line)

    ordered = groups["major"] + groups["minor"] + groups["fix"]

    major, minor, patch = previous
    if mvp and major == 0:
        next_version = (1, 0, 0)
    elif grade == "major":
        if major == 0:
            next_version = (major, minor + 1, 0)
        else:
            next_version = (major + 1, 0, 0)
    elif grade == "minor":
        next_version = (major, minor + 1, 0)
    else:
        if previous == (0, 0, 0):
            next_version = (0, 1, 0)
        else:
            next_version = (major, minor, patch + 1)

    change_grade = "initial" if previous == (0, 0, 0) else grade
    return next_version, change_grade, ordered


def version_string(v: tuple[int, int, int]) -> str:
    return f"{v[0]}.{v[1]}.{v[2]}"


# ---------------------------------------------------------------------------------------------------------------------
# Version files
# ---------------------------------------------------------------------------------------------------------------------

def detect_indent(raw: str) -> int:
    for line in raw.splitlines()[1:]:
        stripped = line.lstrip(" ")
        if stripped and len(stripped) != len(line):
            return len(line) - len(stripped)
    return 2


def materialize_version_files(version_files: list[dict], version: str) -> list[str]:
    """Writes the version into JSON files. Returns the list of changed files."""
    changed = []
    for spec in version_files:
        path = ROOT / spec["file"]
        if not path.exists():
            if spec.get("optional"):
                continue
            fail(f"Version file {spec['file']} not found.")
        raw = path.read_bytes().decode("utf-8-sig")
        newline = "\r\n" if "\r\n" in raw else "\n"
        data = json.loads(raw)

        node = data
        keys = spec["path"]
        for key in keys[:-1]:
            if not isinstance(node, dict) or key not in node:
                fail(f"Path {keys} not found in {spec['file']}.")
            node = node[key]
        if not isinstance(node, dict) or keys[-1] not in node:
            fail(f"Path {keys} not found in {spec['file']}.")
        node[keys[-1]] = version

        text = json.dumps(data, ensure_ascii=False, indent=detect_indent(raw)) + "\n"
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(text.replace("\n", newline))
        if spec["file"] not in changed:
            changed.append(spec["file"])
    return changed


# ---------------------------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------------------------

def main() -> None:
    config = load_config()
    store = create_store(config)

    previous, changes = store.read()
    if not changes:
        changes = git_fallback_changes(config["fallbackEntry"])
    if not changes:
        changes = ["New revision without significant changes"]

    next_version_tuple, change_grade, ordered_changes = classify(changes, previous)
    base_version = version_string(next_version_tuple)

    # Outside of the main branch a pre-release "<base>-<branch>.<n>" is created. Pre-releases do NOT touch the
    # change log: the upcoming entries stay in place until the main branch releases them as a stable version.
    branch = current_branch()
    prerelease_id = ""
    if config.get("prereleaseOnOtherBranches") and branch and branch not in (config["mainBranch"], "HEAD"):
        prerelease_id = prerelease_identifier(branch)
        next_version = f"{base_version}-{prerelease_id}.{next_prerelease_number(base_version, prerelease_id)}"
    else:
        next_version = base_version

    now = dt.datetime.now().astimezone()
    date_info = now.strftime("%Y-%m-%d")
    time_info = now.strftime("%H:%M:%S")

    if not prerelease_id:
        store.write(next_version, date_info, ordered_changes)
    changed_files = materialize_version_files(config["versionFiles"], next_version)

    notes = "".join(f"- {change}\n" for change in ordered_changes)
    if config.get("versionInfoFile"):
        version_info = {
            "currentVersionWithSuffix": next_version,
            "releaseType": prerelease_id,
            "currentVersion": base_version,
            "currentMajor": next_version_tuple[0],
            "currentMinor": next_version_tuple[1],
            "currentFix": next_version_tuple[2],
            "previousVersion": version_string(previous),
            "changeGrade": change_grade,
            "versionTimeInfo": time_info,
            "versionDateInfo": date_info,
            "versionNotes": notes,
        }
        version_info_path = ROOT / config["versionInfoFile"]
        version_info_path.parent.mkdir(parents=True, exist_ok=True)
        version_info_path.write_text(json.dumps(version_info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    dist = ROOT / config["distDirectory"]
    dist.mkdir(parents=True, exist_ok=True)
    release_notes = dist / "release-notes.md"
    release_notes.write_text(notes, encoding="utf-8")

    result = {
        "version": next_version,
        "tag": f"v{next_version}",
        "previousVersion": version_string(previous),
        "changeGrade": change_grade,
        "branch": branch,
        "prerelease": bool(prerelease_id),
        "notes": release_notes.relative_to(ROOT).as_posix(),
        "versionFiles": changed_files,
    }
    (dist / "release-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
