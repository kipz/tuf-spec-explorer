#!/usr/bin/env python3
"""Scrape upstream TUF sources and report drift against src/tuf-spec-data.json.

Handles only the facts that are mechanically extractable from upstream: TAP
numbers, titles, statuses, URLs, spec version/date/editors, the spec's attack
list, the incorporated-TAP list, and the spec's section anchors. Everything
else in the data file (constraint analysis, interactions, security impact,
implementation support) is judgment work left to the caller.

Usage:
    python3 scrape_sources.py [--data PATH] [--cache DIR] [--out DIR]
                              [--offline] [--write-provenance] [--json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

TAPS_REPO = "https://github.com/theupdateframework/taps.git"
SPEC_REPO = "https://github.com/theupdateframework/specification.git"
CONFORMANCE_REPO = "https://github.com/theupdateframework/tuf-conformance.git"
TAP_URL_TEMPLATE = "https://github.com/theupdateframework/taps/blob/master/tap{n}.md"
CONFORMANCE_REPORT_URL = "https://theupdateframework.github.io/tuf-conformance/"

# Data statuses are the four the renderer's types.ts allows. Incorporated TAPs
# carry "Final" in the data file but sit in the README's Accepted bucket, so
# their status is never compared.
DATA_STATUSES = {"Accepted", "Draft", "Rejected", "Deferred"}

# Statuses a TAP header can carry that the renderer's four-value enum has no slot
# for. A toggleable TAP reaching one of these is a signal it may now belong in
# incorporatedTaps[].
TERMINAL_STATUSES = {"Final", "Superseded", "Withdrawn"}


# ---------------------------------------------------------------- fetching


def run(cmd: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed:\n{result.stderr.strip()}")
    return result.stdout


def repo_identity(url: str) -> str:
    """Reduce a git remote to 'host/owner/repo'.

    Comparing remote URLs literally is wrong: a global
    `url.git@github.com:.insteadOf https://github.com/` rewrites clone URLs to
    SSH, so the origin we stored never matches the HTTPS URL we asked for.
    """
    cleaned = url.strip().lower().removesuffix(".git")
    cleaned = re.sub(r"^(https?|ssh|git)://", "", cleaned)
    cleaned = re.sub(r"^[^@/]+@", "", cleaned)  # strip user@
    cleaned = cleaned.replace(":", "/", 1)  # scp-style host:owner/repo
    return re.sub(r"/+", "/", cleaned)


class ParseError(RuntimeError):
    """An upstream document did not yield a field we require. Raised rather than
    tolerated: a scraper that silently drops a field it cannot parse reports
    "no drift" for a value it never actually compared."""


class CacheSafetyError(RuntimeError):
    """The cache directory is not ours to destroy. Never caught — downgrading this
    to "upstream unavailable" would hide the very thing it protects against."""


# Written into each clone we create. Its presence is the only thing that proves a
# checkout is disposable: a matching origin and a clean tree can both be true of
# someone's real working clone, which may also hold unpushed commits.
OWNED_MARKER = ".refresh-tuf-data-cache"


def sync_repo(url: str, dest: Path, offline: bool) -> str:
    """Shallow-clone or fast-forward dest. Returns the checked-out commit sha."""
    if not dest.exists():
        if offline:
            raise RuntimeError(f"--offline but no cached clone at {dest}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--depth", "1", "--quiet", url, str(dest)])
        (dest / OWNED_MARKER).write_text(
            "Disposable clone created by .claude/skills/refresh-tuf-data.\n"
            "This file marks the directory as safe to reset --hard. Delete it and the\n"
            "script will refuse to touch this checkout.\n"
        )
    elif not offline:
        # `git reset --hard` below is unrecoverable, so only ever run it on a clone
        # this script created. Requiring our own marker is the only check that
        # actually establishes that: a matching origin and a clean tree can both
        # hold for a real working clone carrying unpushed commits.
        if not (dest / OWNED_MARKER).exists():
            raise CacheSafetyError(
                f"refusing to touch {dest}: it has no {OWNED_MARKER} marker, so this "
                "script did not create it and cannot safely reset it. Point --cache at a "
                "throwaway directory, or delete this one if it really is disposable."
            )
        try:
            origin = run(["git", "remote", "get-url", "origin"], cwd=dest).strip()
        except RuntimeError as exc:
            raise CacheSafetyError(f"{dest} exists but is not a git checkout: {exc}") from exc
        if repo_identity(origin) != repo_identity(url):
            raise CacheSafetyError(
                f"refusing to reset {dest}: its origin is {origin!r}, expected {url!r}. "
                "Point --cache at a directory this script owns."
            )
        dirty = [
            line
            for line in run(["git", "status", "--porcelain"], cwd=dest).splitlines()
            if line.strip() and not line.endswith(OWNED_MARKER)
        ]
        if dirty:
            raise CacheSafetyError(
                f"refusing to reset {dest}: it has uncommitted changes:\n"
                + "\n".join(dirty)
                + "\nThis script discards local state on refresh, so point --cache at a "
                "throwaway directory instead of a working clone."
            )
        run(["git", "fetch", "--depth", "1", "--quiet", "origin"], cwd=dest)
        head = run(["git", "rev-parse", "--abbrev-ref", "origin/HEAD"], cwd=dest).strip()
        # The marker says we created this clone, not that nothing was committed
        # into it since. Anything not reachable from the remote would be lost.
        try:
            ahead = run(["git", "rev-list", "--count", f"{head}..HEAD"], cwd=dest).strip()
        except RuntimeError:
            ahead = "0"  # shallow history can't be walked; the reset is a no-op anyway
        if ahead not in ("", "0"):
            raise CacheSafetyError(
                f"refusing to reset {dest}: it has {ahead} commit(s) not present on {head}, "
                "which the reset would discard. Move that work elsewhere, or delete this "
                "directory if it is disposable."
            )
        run(["git", "reset", "--hard", "--quiet", head], cwd=dest)
    return run(["git", "rev-parse", "HEAD"], cwd=dest).strip()


def validate_upstream(upstream: dict) -> None:
    """Fail loudly when an extraction came back empty.

    Every drift check compares a data value against a scraped one. If the scrape
    silently yields nothing — because upstream restructured a document and a
    pattern stopped matching — the comparison is skipped and the report claims
    the field is clean. That failure is invisible and points the wrong way, so
    treat an empty required extraction as a hard error instead.
    """
    problems: list[str] = []
    spec = upstream["spec"]
    for field in ("version", "lastModified"):
        if not spec.get(field):
            problems.append(f"spec.{field} could not be parsed from tuf-spec.md's metadata block")
    for field, what in (
        ("editors", "Editor: lines in the metadata block"),
        ("attacks", "the goals-to-protect-against-specific-attacks bullet list"),
        ("anchors", "{#section} anchors"),
        ("incorporatedTaps", "the tuf-augmentation-proposal-tap-support section"),
    ):
        if not spec.get(field):
            problems.append(f"spec.{field} came back empty — check {what}")

    if not upstream["taps"]:
        problems.append("no tapN.md files were found in the TAP repo checkout")
    for tap in upstream["taps"]:
        if not tap["title"]:
            problems.append(f"TAP {tap['tap']} has no Title: in its header block")
        if not tap["status"]:
            problems.append(f"TAP {tap['tap']} has no status in the README index or its header")

    if problems:
        raise ParseError(
            "upstream parsing failed, so drift cannot be assessed:\n"
            + "\n".join(f"  - {p}" for p in problems)
            + "\n\nThe upstream document format has probably changed; fix the parsers "
            "in this script rather than trusting a report built on missing values."
        )


# ---------------------------------------------------------------- parsing


def parse_tap_header(text: str) -> dict[str, str]:
    """TAP files open with an RFC-style '* Key: value' block, values wrapping
    onto indented continuation lines."""
    header: dict[str, str] = {}
    key = None
    for line in text.splitlines():
        if not line.strip():
            break
        match = re.match(r"\*\s*([A-Za-z-]+):\s*(.*)$", line)
        if match:
            key = match.group(1)
            header[key] = match.group(2).strip()
        elif key and line.startswith((" ", "\t")):
            header[key] = f"{header[key]} {line.strip()}".strip()
        else:
            break
    return header


def parse_readme_statuses(text: str) -> dict[int, str]:
    """The TAP repo README groups TAPs under '## Status' headings; that
    grouping is the authoritative status."""
    statuses: dict[int, str] = {}
    current = None
    for line in text.splitlines():
        heading = re.match(r"^##\s+(\w[\w -]*)\s*$", line)
        if heading:
            current = heading.group(1).strip()
            continue
        entry = re.match(r"^\s*[*-]\s*\[TAP\s+(\d+):", line)
        if entry and current in DATA_STATUSES:
            statuses[int(entry.group(1))] = current
    return statuses


def parse_spec_metadata(text: str) -> dict[str, object]:
    """Bikeshed metadata block at the top of tuf-spec.md."""
    block = re.search(r"<pre class='metadata'>(.*?)</pre>", text, re.DOTALL)
    body = block.group(1) if block else ""
    version = re.search(r"Text Macro:\s*VERSION\s+(\S+)", body)
    date = re.search(r"^Date:\s*(\S+)", body, re.MULTILINE)
    editors = []
    for raw in re.findall(r"^Editor:\s*(.+)$", body, re.MULTILINE):
        name, _, affiliation = raw.partition(",")
        name = name.strip()
        affiliation = affiliation.strip()
        editors.append(f"{name} ({affiliation})" if affiliation else name)
    return {
        "version": version.group(1) if version else None,
        "lastModified": date.group(1) if date else None,
        "editors": editors,
    }


def parse_spec_attacks(text: str) -> list[str]:
    """Bullet list under 'Goals to protect against specific attacks'. Names are
    normalised to match the data file: trailing 'attack(s)' and punctuation
    stripped."""
    section = re.search(
        r"\{#goals-to-protect-against-specific-attacks\}(.*?)\n#{1,4} ",
        text,
        re.DOTALL,
    )
    if not section:
        return []
    attacks = []
    for name in re.findall(r"^\+\s+\*\*(.+?)\*\*", section.group(1), re.MULTILINE):
        name = re.sub(r"\s+", " ", name).strip().rstrip(".")
        name = re.sub(r"\s+attacks?$", "", name, flags=re.IGNORECASE)
        attacks.append(name)
    return sorted(attacks)


def parse_spec_incorporated(text: str) -> list[dict[str, object]]:
    """The spec names the TAPs folded into the current major version."""
    section = re.search(
        r"\{#tuf-augmentation-proposal-tap-support\}(.*?)\n# ", text, re.DOTALL
    )
    if not section:
        return []
    body = re.sub(r"\s+", " ", section.group(1))
    return [
        {"tap": int(num), "title": title.strip()}
        for num, title in re.findall(r"\[TAP (\d+)\]\([^)]*\):\s*([^-\[]+?)\s*(?=- \[TAP|$)", body)
    ]


def parse_spec_anchors(text: str) -> set[str]:
    return set(re.findall(r"\{#([a-z0-9-]+)\}", text))


def split_spec_sections(text: str) -> dict[str, str]:
    """Map each section anchor to its body text, so two spec releases can be
    compared section by section rather than as an opaque blob."""
    parts = re.split(r"\{#([a-z0-9-]+)\}", text)
    sections: dict[str, str] = {}
    # parts alternates: preamble, anchor, body, anchor, body, ...
    for i in range(1, len(parts) - 1, 2):
        sections[parts[i]] = re.sub(r"\s+", " ", parts[i + 1]).strip()
    return sections


def spec_section_diff(spec_dir: Path, from_version: str, offline: bool) -> dict[str, object]:
    """Diff tuf-spec.md between the version the data records and the current
    checkout, per section. Answers the question a version bump raises: did any
    section a base constraint cites actually move?"""
    tag = f"v{from_version}"
    if not offline:
        try:
            run(["git", "fetch", "--depth", "1", "--quiet", "origin", "tag", tag], cwd=spec_dir)
        except RuntimeError as exc:
            return {"available": False, "reason": f"could not fetch tag {tag}: {exc}"}
    try:
        old_text = run(["git", "show", f"{tag}:tuf-spec.md"], cwd=spec_dir)
    except RuntimeError:
        return {"available": False, "reason": f"tag {tag} not present in the local checkout"}

    old = split_spec_sections(old_text)
    new = split_spec_sections((spec_dir / "tuf-spec.md").read_text())
    changed = sorted(k for k in old.keys() & new.keys() if old[k] != new[k])
    return {
        "available": True,
        "fromTag": tag,
        "changedSections": changed,
        "addedSections": sorted(new.keys() - old.keys()),
        "removedSections": sorted(old.keys() - new.keys()),
    }


def parse_conformance_clients(conf_dir: Path) -> list[dict[str, str]]:
    """The publish-report workflow's matrix is the authoritative list of clients
    under conformance test, and it is checked into the repo.

    Raises rather than returning empty: an empty list would silently disable the
    implementation cross-check while the report still looked complete.
    """
    workflow = conf_dir / ".github" / "workflows" / "publish-report.yml"
    if not workflow.exists():
        raise ParseError(
            f"{workflow} does not exist — the tuf-conformance workflow has been moved or "
            "renamed, so the conformance-tested client list cannot be read. Fix the path "
            "in this script rather than skipping the implementations check."
        )
    lines = workflow.read_text().splitlines()

    # Scope to the strategy matrix's `include:` block. The workflow has other
    # `- name:` list items (an upload artifact, the pages environment) that are
    # not clients, so parsing the whole file misreads them as malformed entries.
    include_at = next(
        (i for i, line in enumerate(lines) if re.match(r"^\s*include:\s*$", line)), None
    )
    if include_at is None:
        raise ParseError(
            f"{workflow} has no strategy matrix `include:` block — the workflow layout has "
            "changed, so the conformance-tested client list cannot be read. Fix the parser "
            "in this script rather than skipping the implementations check."
        )
    indent = len(lines[include_at]) - len(lines[include_at].lstrip())
    block: list[str] = []
    for line in lines[include_at + 1 :]:
        if line.strip() and (len(line) - len(line.lstrip())) <= indent:
            break
        block.append(line)

    # Read keys per entry rather than requiring `name` and `repo` to be adjacent
    # and in that order: a reordered or extended entry would otherwise be skipped
    # while its neighbours still parsed, leaving the list quietly incomplete.
    entries = re.split(r"^\s*-\s+(?=\w+:)", "\n".join(block), flags=re.MULTILINE)[1:]
    clients: list[dict[str, str]] = []
    partial: list[str] = []
    for entry in entries:
        fields = dict(re.findall(r"^\s*(\w+):\s*(\S+)\s*$", entry, re.MULTILINE))
        name, repo = fields.get("name"), fields.get("repo")
        if name and repo and "/" in repo:
            clients.append({"name": name, "repo": repo, "url": f"https://github.com/{repo}"})
        else:
            partial.append(name or f"<unnamed entry: {sorted(fields)}>")

    if not clients:
        raise ParseError(
            f"{workflow} exists but no client matrix entries were parsed from it — its "
            "format has probably changed. Fix the pattern in this script; an empty list "
            "would disable the implementations cross-check without saying so."
        )
    if partial:
        raise ParseError(
            f"{workflow}: parsed {len(clients)} client(s) but these entries have a name "
            f"and no readable repo: {', '.join(partial)}. Partial parsing would drop "
            "clients from the cross-check silently, so fix the pattern in this script."
        )
    return clients


# ---------------------------------------------------------------- drift


@dataclass
class Report:
    groups: dict[str, list[str]] = field(default_factory=dict)

    def add(self, group: str, message: str) -> None:
        self.groups.setdefault(group, []).append(message)

    @property
    def count(self) -> int:
        return sum(len(v) for v in self.groups.values())


def check_drift(data: dict, upstream: dict, provenance: dict | None) -> Report:
    report = Report()
    spec = data.get("spec", {})
    up_spec = upstream["spec"]

    # validate_upstream() has already established these are non-empty, so an
    # unguarded comparison cannot silently pass on a failed parse.
    if spec.get("version") != up_spec["version"]:
        report.add(
            "spec",
            f"spec.version: data has {spec.get('version')!r}, upstream is {up_spec['version']!r}",
        )
    if spec.get("lastModified") != up_spec["lastModified"]:
        report.add(
            "spec",
            f"spec.lastModified: data has {spec.get('lastModified')!r}, "
            f"upstream is {up_spec['lastModified']!r}",
        )
    if spec.get("editors") != up_spec["editors"]:
        report.add(
            "spec",
            f"spec.editors differ:\n    data:     {spec.get('editors')}\n"
            f"    upstream: {up_spec['editors']}",
        )

    data_attacks = sorted(spec.get("attacks", []))
    if data_attacks != up_spec["attacks"]:
        for missing in sorted(set(up_spec["attacks"]) - set(data_attacks)):
            report.add("spec", f"spec.attacks missing upstream attack {missing!r}")
        for extra in sorted(set(data_attacks) - set(up_spec["attacks"])):
            report.add("spec", f"spec.attacks has {extra!r} which is not in the spec")

    anchors = upstream["spec"]["anchors"]
    for key, constraint in spec.get("constraints", {}).items():
        section = constraint.get("specSection")
        if section and section not in anchors:
            report.add(
                "spec",
                f"spec.constraints.{key}.specSection {section!r} is not a section "
                "anchor in tuf-spec.md",
            )

    # --- TAP coverage across the three arrays the renderer reads
    toggleable = {t["tap"]: t for t in data.get("taps", [])}
    incorporated = {t["tap"]: t for t in data.get("incorporatedTaps", [])}
    process = {t["tap"]: t for t in data.get("processTaps", [])}
    classified = set(toggleable) | set(incorporated) | set(process)
    up_taps = {t["tap"]: t for t in upstream["taps"]}

    # Each TAP belongs to exactly one of the three arrays. A set union hides a
    # TAP listed twice, and the renderer would show it twice.
    groups = {"taps[]": toggleable, "incorporatedTaps[]": incorporated, "processTaps[]": process}
    for num in sorted(classified):
        holders = [name for name, group in groups.items() if num in group]
        if len(holders) > 1:
            report.add(
                "taps",
                f"TAP {num} appears in more than one array ({', '.join(holders)}); "
                "each TAP belongs to exactly one",
            )
    for name, group in groups.items():
        seen: set[int] = set()
        for entry in data.get(name.rstrip("[]"), []):
            if entry["tap"] in seen:
                report.add("taps", f"TAP {entry['tap']} is listed twice within {name}")
            seen.add(entry["tap"])

    for num in sorted(set(up_taps) - classified):
        up = up_taps[num]
        report.add(
            "taps",
            f"TAP {num} ({up['title']!r}, status {up['status']}) exists upstream but "
            "is in none of taps[], incorporatedTaps[], processTaps[]",
        )
    for num in sorted(classified - set(up_taps)):
        report.add("taps", f"TAP {num} is in the data but has no tap{num}.md upstream")

    for num in sorted(set(up_taps) & classified):
        up = up_taps[num]
        entry = toggleable.get(num) or incorporated.get(num) or process.get(num)
        placeholder = "<" in up["title"]  # tap2.md is the submission template
        # Not guarded on the data title being non-empty: a missing title is drift
        # in its own right, and skipping the comparison would report it as clean.
        if not placeholder and (entry.get("title") or "").lower() != up["title"].lower():
            report.add(
                "taps",
                f"TAP {num} title: data has {entry.get('title')!r}, upstream is {up['title']!r}",
            )
        if num in incorporated:
            # Incorporated TAPs carry the header's terminal status ("Final"), not
            # the README's Accepted bucket.
            header_status = up["headerStatus"]
            if header_status in TERMINAL_STATUSES and entry.get("status") != header_status:
                report.add(
                    "taps",
                    f"TAP {num} status: incorporatedTaps has {entry.get('status')!r}, "
                    f"tap{num}.md header says {header_status!r}",
                )
        elif num in toggleable:
            if entry.get("status") != up["status"]:
                report.add(
                    "taps",
                    f"TAP {num} status: data has {entry.get('status')!r}, upstream is "
                    f"{up['status']!r}",
                )
            expected_url = TAP_URL_TEMPLATE.format(n=num)
            if entry.get("url") != expected_url:
                report.add(
                    "taps", f"TAP {num} url: data has {entry.get('url')!r}, expected {expected_url!r}"
                )
            header_status = up["headerStatus"]
            if header_status in DATA_STATUSES and header_status != up["status"]:
                report.add(
                    "taps",
                    f"TAP {num}: upstream README says {up['status']!r} but the tap{num}.md "
                    f"header says {header_status!r} — upstream is inconsistent, check both",
                )
            elif header_status in TERMINAL_STATUSES:
                report.add(
                    "taps",
                    f"TAP {num} is in the toggleable taps[] but tap{num}.md header status is "
                    f"{header_status!r} — check whether it has been folded into the spec and "
                    "belongs in incorporatedTaps[] instead",
                )

    up_incorporated = {t["tap"] for t in up_spec["incorporatedTaps"]}
    for num in sorted(up_incorporated - set(incorporated)):
        report.add(
            "taps",
            f"TAP {num} is listed as incorporated by tuf-spec.md but is not in "
            "incorporatedTaps[]",
        )
    for num in sorted(set(incorporated) - up_incorporated):
        report.add(
            "taps",
            f"TAP {num} is in incorporatedTaps[] but tuf-spec.md does not list it as "
            "incorporated into this major version",
        )

    # --- body changes since the last recorded refresh
    if provenance is None:
        report.add(
            "bodies",
            "no provenance baseline recorded, so TAP body changes cannot be detected. "
            "Re-run with --write-provenance after this refresh to enable it next time.",
        )
    else:
        baseline = provenance.get("taps", {})
        for num in sorted(set(up_taps) & classified):
            recorded = baseline.get(str(num))
            if recorded is None:
                report.add("bodies", f"TAP {num} has no recorded hash; treat its analysis as unverified")
            elif recorded != up_taps[num]["sha256"]:
                report.add(
                    "bodies",
                    f"TAP {num} body changed upstream since the last refresh; re-derive its "
                    "constraintChanges, dependencies, requiresMajorBump and securityImpact",
                )

    return report


def check_conformance(data: dict, clients: list[dict[str, str]], available: bool = True) -> Report:
    """Cross-check implementations[] against the clients upstream actually
    conformance-tests. Two blind spots this closes: a tested client we don't list
    at all, and a tested client whose conformancePercent we never recorded."""
    report = Report()
    if not available:
        # Surfaced as a finding, not just a header note, so it also reaches
        # drift.json and --json consumers who never see stdout.
        report.add(
            "implementations",
            "the tuf-conformance repo could not be reached, so the implementations "
            "cross-check did NOT run — no conclusion either way about missing clients "
            "or missing conformancePercent values",
        )
        return report
    by_url = {i.get("githubUrl", "").rstrip("/"): i for i in data.get("implementations", [])}
    for client in clients:
        impl = by_url.get(client["url"])
        if impl is None:
            report.add(
                "implementations",
                f"{client['name']} ({client['url']}) is conformance-tested upstream but is "
                "not in implementations[] — check whether it belongs there",
            )
        elif "conformancePercent" not in impl:
            report.add(
                "implementations",
                f"{impl['id']} is conformance-tested upstream but has no conformancePercent. "
                f"Check {CONFORMANCE_REPORT_URL} — the report shows 'No data' for some clients, "
                "and omitting the field is the right answer for those",
            )
    return report


def check_spec_sections(data: dict, diff: dict) -> Report:
    """A spec version bump only matters to this data file if a section a base
    constraint cites actually changed."""
    report = Report()
    if not diff.get("available"):
        report.add(
            "spec",
            f"could not diff spec prose across releases ({diff.get('reason')}), so whether "
            "any base constraint's section moved is unverified",
        )
        return report

    cited: dict[str, list[str]] = {}
    for constraint in data.get("spec", {}).get("constraints", {}).values():
        cited.setdefault(constraint.get("specSection", ""), []).append(constraint.get("id", ""))

    changed = diff["changedSections"]
    for section in changed:
        if section in cited:
            report.add(
                "spec",
                f"spec section {section!r} changed since {diff['fromTag']} and is cited by "
                f"{', '.join(sorted(cited[section]))} — re-read it and check the constraint text",
            )
    other = [s for s in changed if s not in cited]
    if other:
        report.add(
            "spec",
            f"{len(other)} other spec section(s) changed since {diff['fromTag']} "
            f"(no base constraint cites them): {', '.join(other[:8])}"
            + (" ..." if len(other) > 8 else ""),
        )
    for section in diff["removedSections"]:
        if section in cited:
            report.add(
                "spec",
                f"spec section {section!r} no longer exists but is cited by "
                f"{', '.join(sorted(cited[section]))}",
            )
    return report


def check_readme_tap_titles(readme: str, upstream_taps: list[dict]) -> Report:
    """The appendix labels each TAP link with a description. Those labels are
    hand-written paraphrases and drift from the real titles unnoticed, because
    nothing about a wrong label breaks the build — a reader just learns the wrong
    subject for a TAP.
    """
    report = Report()
    titles = {t["tap"]: t["title"] for t in upstream_taps}
    for num, label in re.findall(
        r"/taps/blob/master/tap(\d+)\.md\)\s*[—-]\s*([^\n(]+)", readme
    ):
        num = int(num)
        upstream_title = titles.get(num)
        if not upstream_title:
            continue
        cleaned = re.sub(r"\s*\(incorporated\)\s*$", "", label).strip().rstrip(".")
        ratio = SequenceMatcher(None, cleaned.lower(), upstream_title.lower()).ratio()
        if ratio < 0.7:
            report.add(
                "docs",
                f"README.md labels TAP {num} {cleaned!r} but its upstream title is "
                f"{upstream_title!r}",
            )
    return report


def check_readme_counts(readme: str, data: dict) -> Report:
    """README.md quotes counts in prose and in the data-model appendix; they
    silently rot when the data changes."""
    report = Report()
    actual = {
        "taps": len(data.get("taps", [])),
        "incorporated": len(data.get("incorporatedTaps", [])),
        "interactions": len(data.get("tapInteractions", [])),
        "implementations": len(data.get("implementations", [])),
        "constraints": len(data.get("spec", {}).get("constraints", {})),
    }
    patterns = {
        "taps": (r"(\d+)\s+TAPs\b", "toggleable TAPs"),
        "incorporated": (r"(\d+)\s+TAPs already incorporated", "incorporated TAPs"),
        "interactions": (r"(\d+)\s+(?:cross-TAP )?interactions", "interactions"),
        "implementations": (r"(\d+)\s+TUF client libraries", "implementations"),
        "constraints": (r"(\d+)\s+base spec constraints", "base constraints"),
    }
    for key, (pattern, label) in patterns.items():
        found = {int(m) for m in re.findall(pattern, readme)}
        if found and actual[key] not in found:
            report.add(
                "docs",
                f"README.md says {sorted(found)} {label} but the data has {actual[key]}",
            )

    by_type: dict[str, int] = {}
    for interaction in data.get("tapInteractions", []):
        by_type[interaction["type"]] = by_type.get(interaction["type"], 0) + 1
    for label, key in (("synergies", "synergy"), ("tensions", "tension"), ("conflicts", "conflict")):
        found = {int(m) for m in re.findall(rf"(\d+)\s+{label}", readme)}
        if found and by_type.get(key, 0) not in found:
            report.add("docs", f"README.md says {sorted(found)} {label} but the data has {by_type.get(key, 0)}")

    urls = set(re.findall(r"https://github\.com/[\w.-]+/[\w.-]+", readme))
    for impl in data.get("implementations", []):
        if impl["githubUrl"] not in urls:
            report.add(
                "docs",
                f"README.md's source list does not mention {impl['id']} ({impl['githubUrl']})",
            )

    # Every TAP should appear in the appendix's resource list; a newly added TAP is
    # easy to add to the data and forget here.
    listed_taps = {int(m) for m in re.findall(r"/taps/blob/master/tap(\d+)\.md", readme)}
    for group in ("taps", "incorporatedTaps"):
        for entry in data.get(group, []):
            if entry["tap"] not in listed_taps:
                report.add(
                    "docs",
                    f"README.md's appendix source list does not link TAP {entry['tap']} "
                    f"({entry.get('title', '')})",
                )

    # Prose references to the spec version rot independently of spec.version.
    version = data.get("spec", {}).get("version")
    if version:
        mentioned = set(re.findall(r"v?(1\.0\.\d+)", readme))
        stale = sorted(v for v in mentioned if v != version)
        if stale:
            report.add(
                "docs",
                f"README.md mentions spec version(s) {stale} but the data says {version}",
            )
    return report


# ---------------------------------------------------------------- main


def main() -> int:
    skill_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, help="path to tuf-spec-data.json")
    parser.add_argument("--readme", type=Path, help="path to the repo README.md")
    parser.add_argument("--cache", type=Path, default=skill_root / ".cache")
    parser.add_argument("--out", type=Path, help="where to write upstream.json/drift.json")
    parser.add_argument("--offline", action="store_true", help="use cached clones, do not fetch")
    parser.add_argument("--provenance", type=Path, help="path to the provenance baseline file")
    parser.add_argument(
        "--write-provenance",
        action="store_true",
        help="record current upstream TAP hashes so the next run can detect body changes",
    )
    parser.add_argument(
        "--provenance-note",
        help="what was actually verified in this refresh, recorded alongside the hashes",
    )
    parser.add_argument("--json", action="store_true", help="print the drift report as JSON")
    args = parser.parse_args()

    repo_root = skill_root.parents[2]  # <repo>/.claude/skills/<skill>/
    data_path = args.data or repo_root / "src" / "tuf-spec-data.json"
    readme_path = args.readme or repo_root / "README.md"
    out_dir = args.out or args.cache / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    taps_dir = args.cache / "taps"
    spec_dir = args.cache / "specification"
    conf_dir = args.cache / "tuf-conformance"
    taps_commit = sync_repo(TAPS_REPO, taps_dir, args.offline)
    spec_commit = sync_repo(SPEC_REPO, spec_dir, args.offline)
    # The conformance repo is the one optional source: a refresh is still useful
    # without it. Tolerate it being unreachable, but never swallow a
    # CacheSafetyError — that would report a refusal to touch someone's clone as
    # ordinary upstream unavailability.
    try:
        conf_commit = sync_repo(CONFORMANCE_REPO, conf_dir, args.offline)
    except CacheSafetyError:
        raise
    except RuntimeError:
        conf_commit = None

    readme_statuses = parse_readme_statuses((taps_dir / "README.md").read_text())
    taps = []
    for path in sorted(taps_dir.glob("tap*.md"), key=lambda p: int(re.sub(r"\D", "", p.stem))):
        num = int(re.sub(r"\D", "", path.stem))
        raw = path.read_bytes()
        header = parse_tap_header(raw.decode("utf-8", "replace"))
        taps.append(
            {
                "tap": num,
                "title": header.get("Title", ""),
                "status": readme_statuses.get(num, header.get("Status", "")),
                "headerStatus": header.get("Status", ""),
                "url": TAP_URL_TEMPLATE.format(n=num),
                "lastModified": header.get("Last-Modified", ""),
                "created": header.get("Created", ""),
                "tufVersion": header.get("TUF-Version", ""),
                "author": header.get("Author", ""),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "path": str(path),
            }
        )

    spec_text = (spec_dir / "tuf-spec.md").read_text()
    spec = parse_spec_metadata(spec_text)
    spec["attacks"] = parse_spec_attacks(spec_text)
    spec["incorporatedTaps"] = parse_spec_incorporated(spec_text)
    spec["anchors"] = parse_spec_anchors(spec_text)
    spec["path"] = str(spec_dir / "tuf-spec.md")

    data_for_diff = json.loads(data_path.read_text())
    spec["sectionDiff"] = spec_section_diff(
        spec_dir, data_for_diff.get("spec", {}).get("version", ""), args.offline
    )
    conformance_clients = parse_conformance_clients(conf_dir) if conf_commit else []

    upstream = {
        "sources": {
            "taps": {"repo": TAPS_REPO, "commit": taps_commit, "checkout": str(taps_dir)},
            "spec": {"repo": SPEC_REPO, "commit": spec_commit, "checkout": str(spec_dir)},
            "conformance": {
                "repo": CONFORMANCE_REPO,
                "commit": conf_commit,
                "checkout": str(conf_dir),
                "report": CONFORMANCE_REPORT_URL,
            },
        },
        "taps": taps,
        "spec": spec,
        "conformanceClients": conformance_clients,
    }

    validate_upstream(upstream)

    serialisable = json.loads(json.dumps(upstream, default=lambda o: sorted(o)))
    (out_dir / "upstream.json").write_text(json.dumps(serialisable, indent=2) + "\n")

    data = json.loads(data_path.read_text())
    # Lives outside --cache (which is gitignored) so it can be committed and give
    # every clone the same body-change baseline.
    provenance_path = args.provenance or skill_root / "provenance.json"
    provenance = json.loads(provenance_path.read_text()) if provenance_path.exists() else None

    report = check_drift(data, upstream, provenance)
    for extra in (
        check_spec_sections(data, spec["sectionDiff"]),
        check_conformance(data, conformance_clients, available=conf_commit is not None),
        check_readme_counts(readme_path.read_text(), data) if readme_path.exists() else Report(),
        check_readme_tap_titles(readme_path.read_text(), taps) if readme_path.exists() else Report(),
    ):
        for group, messages in extra.groups.items():
            for message in messages:
                report.add(group, message)

    (out_dir / "drift.json").write_text(json.dumps(report.groups, indent=2) + "\n")

    if args.write_provenance:
        provenance_path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "_meaning": (
                "Hashes of the upstream TAP bodies as of the refresh that wrote this file. "
                "A later run compares against them to say which TAPs changed. This records "
                "which revisions were looked at — it is not a claim that every derived field "
                "was re-derived from scratch. The 'note' field, when present, says what that "
                "refresh actually verified and what it did not."
            ),
            "tapsCommit": taps_commit,
            "specCommit": spec_commit,
            "taps": {str(t["tap"]): t["sha256"] for t in taps},
        }
        if args.provenance_note:
            record["note"] = args.provenance_note
        provenance_path.parent.mkdir(parents=True, exist_ok=True)
        provenance_path.write_text(json.dumps(record, indent=2) + "\n")

    if args.json:
        print(json.dumps(report.groups, indent=2))
        return 0

    labels = {
        "spec": "Base spec (spec{})",
        "taps": "TAP inventory (taps[], incorporatedTaps[], processTaps[])",
        "bodies": "TAP bodies (derived analysis may be stale)",
        "implementations": "Implementations (implementations[])",
        "docs": "Repo docs (README.md)",
    }
    print(f"taps@{taps_commit[:8]}  specification@{spec_commit[:8]}", end="")
    print(f"  tuf-conformance@{conf_commit[:8]}" if conf_commit else "  tuf-conformance@unavailable")
    print(f"upstream facts: {out_dir / 'upstream.json'}")
    print(f"{len(taps)} TAPs upstream, spec {spec['version']} ({spec['lastModified']})\n")
    if report.count == 0:
        print("No drift detected in the fields this script checks.\n")
    else:
        for group in ("spec", "taps", "bodies", "implementations", "docs"):
            messages = report.groups.get(group)
            if not messages:
                continue
            print(f"## {labels[group]}  ({len(messages)})")
            for message in messages:
                print(f"  - {message}")
            print()

    # A clean report above means "these checks passed", not "the data is current".
    # Stating the gap explicitly stops the four tidy sections reading as exhaustive.
    print("## Not checked by this script — verify these yourself if they matter")
    print("  - Every derived field: constraintChanges, dependencies, requiresMajorBump,")
    print("    securityImpact, incompatibilities, and all tapInteractions. Body hashes tell")
    print("    you a TAP moved, never whether the analysis of it is right.")
    print("  - Whether an implementation's tapSupport level matches what the TAP specifies.")
    print("    The presence of a mechanism is not conformance with it.")
    print(f"  - Current conformance percentages: {CONFORMANCE_REPORT_URL}")
    print("  - Implementations nobody has added yet. This script only cross-checks against")
    print("    the conformance-tested client list, which is far from every TUF client.")
    print("  - Whether interaction coverage is complete for the current TAP set.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ParseError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
