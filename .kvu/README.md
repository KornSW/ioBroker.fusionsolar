# KVU – Korn Versioning Utility (generic edition)

KVU calculates the next [semantic version](https://semver.org) automatically on every push to the main branch, writes it
into the project files and the change log, commits the result, tags it and hands the release over to the CI workflow.

This is the generic edition of the `release.py` used in the `WP-*` repositories. The WordPress specific parts (plugin
headers, ZIP assets, self-updater) are not part of it; new are a configuration file, change logs inside a Markdown
section (e.g. the `## Changelog` of a README) and version files.

## How the version is calculated

1. KVU reads the **upcoming entries** of the change log (classic file: `## Upcoming Changes`, README section:
   `### **WORK IN PROGRESS**`).
2. If there are none, it takes the **Git commit subjects** since the last version tag (max. 20, commits containing
   `VERSIONING` are ignored, `[skip ci]` markers are removed).
3. If there is nothing at all, the entry is "New revision without significant changes".
4. Every entry is classified (case-insensitive, any whitespace between the words):

   | Entry contains | Change | Example 1.3.1 -> |
   | --- | --- | --- |
   | `Breaking Change` | major (while 0.x: minor) | 2.0.0 |
   | `New Feature` | minor | 1.4.0 |
   | `**MVP**` | 1.0.0 (only while 0.x) | - |
   | anything else | fix / patch | 1.3.2 |

   The highest grade wins. The entries are written in the order major, minor, fix.
5. The previous version is the newest release heading of the change log (`## v x.y.z` resp. `### x.y.z ...`).

## Branches and pre-releases

| Branch | Result | Change log |
| --- | --- | --- |
| main branch (`mainBranch`, default `master`) | stable version `x.y.z` | upcoming entries become the release `x.y.z` |
| any other branch | pre-release `x.y.z-<branch>.<n>`, e.g. `2.0.0-feature-kiosk.3` | **untouched** - the entries stay "upcoming" until the main branch releases them |

- `x.y.z` is calculated exactly like a stable release (so a branch shows which version the merge will produce).
- `<branch>` is the branch name reduced to `[a-zA-Z0-9-]` (`feature/kiosk` -> `feature-kiosk`; purely numeric names get
  a `b` prefix) - this is the pre-release format accepted by SemVer and by ioBroker (`x.y.z-<id>.<n>`).
- `<n>` is the next free number for `v<x.y.z>-<branch>.*` among the Git tags.
- Only **stable** tags (`vX.Y.Z`) are a boundary for the commit fallback - pre-release tags never shorten the range.
- Disable with `"prereleaseOnOtherBranches": false` (then every branch releases stable versions, like the WP edition).
- The branch is taken from `KVU_BRANCH`, else `GITHUB_REF` (`refs/heads/...`), else the local Git checkout.

## Writing change log entries

Either write them into the upcoming block before pushing (preferred - they become the release notes):

```markdown
### **WORK IN PROGRESS**

- (KornSW) **New Feature:** kiosk mode
- (KornSW) fixed the unit of the battery power
```

or just use meaningful commit subjects, e.g. `New Feature: kiosk mode` or `Breaking Change: requires Node.js 22`.
With `"fallbackEntry": "({author}) {subject}"` the commit author is prefixed (ioBroker changelog style).

## Configuration (`.kvu/kvu.json`, optional)

| Key | Default | Meaning |
| --- | --- | --- |
| `changelog.mode` | `file` | `file` = classic KVU change log file, `readme-section` = a `## <section>` of a Markdown file |
| `changelog.file` | `doc/changelog.md` | change log file (for `readme-section` e.g. `README.md`) |
| `changelog.section` | `Changelog` | name of the `##` section (`readme-section` only) |
| `changelog.upcomingHeading` | `**WORK IN PROGRESS**` | `###` heading of the upcoming entries (`readme-section` only) |
| `changelog.releaseHeading` | `{version} ({date})` | `###` heading of a release (`readme-section` only) |
| `changelog.keepEmptyUpcoming` | `false` | keep an empty upcoming block after a release (`readme-section` only) |
| `fallbackEntry` | `{subject}` | format of entries taken from commits (`{subject}`, `{author}`) |
| `versionFiles` | `[]` | JSON files receiving the version: `{ "file": "package.json", "path": ["version"] }`; `"optional": true` skips missing files |
| `versionInfoFile` | `doc/versioninfo.json` | version info for other tools (`null` = disabled) |
| `distDirectory` | `dist` | output: `release-result.json`, `release-notes.md` (not committed) |
| `mainBranch` | `master` | branch that releases stable versions |
| `prereleaseOnOtherBranches` | `true` | other branches release `x.y.z-<branch>.<n>` pre-releases |

Lines inside HTML comments and fenced code blocks are ignored when searching headings (the ioBroker placeholder comment
contains a `### **WORK IN PROGRESS**` line). Line endings (LF/CRLF) and JSON indentation are preserved.

## Output

`release.py` prints a JSON line and writes `dist/release-result.json`:

```json
{ "version": "2.0.0", "tag": "v2.0.0", "previousVersion": "1.3.1", "changeGrade": "major",
  "branch": "master", "prerelease": false,
  "notes": "dist/release-notes.md", "versionFiles": ["package.json", "package-lock.json", "io-package.json"] }
```

## CI integration (this repository)

See the `KVU HOOK` block in [.github/workflows/test-and-release.yml](../.github/workflows/test-and-release.yml):
tests -> `versioning` (KVU, commit `<subject> -> VERSIONING`, annotated tag, atomic push) -> `deploy` (npm publish with
provenance + GitHub release; pre-releases with the npm dist-tag `next` and as GitHub pre-release). The workflow runs for
pushes to all branches except `dependabot/*`. With the repository secret `KVU_DEPLOY_KEY` (SSH deploy key with write access) the push
triggers a tag run which publishes; without it the release is published in the same run.

## Tests

```bash
python -m unittest discover -s .kvu -p "test_*.py"     # or: npm run test:kvu
```
