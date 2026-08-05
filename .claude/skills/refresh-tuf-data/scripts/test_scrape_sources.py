#!/usr/bin/env python3
"""Tests for scrape_sources.py.

Run: python3 -m unittest discover -s .claude/skills/refresh-tuf-data/scripts -v

The bias here is deliberate: most of these cover *failure* behaviour rather
than the happy path. The recurring bug in this script has been silently
skipping a comparison when an extraction came back empty, which produces a
report that says "no drift" about a field it never looked at. A test that only
feeds well-formed input cannot catch that, so nearly every parser has a
companion test asserting it raises on malformed input.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from scrape_sources import (  # noqa: E402
    CacheSafetyError,
    OWNED_MARKER,
    ParseError,
    Report,
    check_conformance,
    check_drift,
    check_readme_counts,
    check_readme_tap_titles,
    check_spec_sections,
    parse_conformance_clients,
    parse_readme_statuses,
    parse_spec_attacks,
    parse_spec_incorporated,
    parse_spec_metadata,
    parse_tap_header,
    repo_identity,
    split_spec_sections,
    sync_repo,
    validate_upstream,
)

SPEC_METADATA = """<pre class='metadata'>
Title: The Update Framework Specification
Date: 2026-07-15
Editor: Justin Cappos, NYU
Editor: Marina Moore, Edera
Editor: Nobody
Text Macro: VERSION 1.0.35
</pre>
"""

SPEC_ATTACKS = """
### Goals to protect against specific attacks ### {#goals-to-protect-against-specific-attacks}

+ **Rollback attacks.**  An attacker cannot trick clients.

+ **Endless data attacks.**  Huge amounts of data.

+ **Vulnerability to key compromises.** A single key.

### Goals for PKI ### {#goals-for-pki}
"""

SPEC_INCORPORATED = """
### TUF Augmentation Proposal (TAP) support ### {#tuf-augmentation-proposal-tap-support}

This major version adheres to the following TAPs:

- [TAP 6](https://github.com/theupdateframework/taps/blob/master/tap6.md):
    Include specification version in metadata
- [TAP 11](https://github.com/theupdateframework/taps/blob/master/tap11.md):
    Using POUFs for Interoperability

# System overview # {#system-overview}
"""

WORKFLOW = """name: Publish client conformance report
jobs:
  fetch-results:
    strategy:
      matrix:
        include:
          - name: python-tuf
            repo: theupdateframework/python-tuf
            workflow: conformance.yml
          - name: tuf-js
            repo: theupdateframework/tuf-js
            workflow: conformance.yml
    steps:
      - name: Upload
        uses: actions/upload-artifact@v7
        with:
          name: tuf-conformance-results
          path: ./results/
  deploy-pages:
    environment:
      - name: github-pages
"""


def write_workflow(root: Path, body: str) -> Path:
    path = root / ".github" / "workflows" / "publish-report.yml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    return root


def minimal_upstream(**spec_overrides) -> dict:
    spec = {
        "version": "1.0.35",
        "lastModified": "2026-07-15",
        "editors": ["Justin Cappos (NYU)"],
        "attacks": ["Rollback"],
        "anchors": {"file-formats-keys"},
        "incorporatedTaps": [{"tap": 6, "title": "Include specification version in metadata"}],
    }
    spec.update(spec_overrides)
    return {
        "spec": spec,
        "taps": [
            {
                "tap": 3,
                "title": "Multi-role delegations",
                "status": "Accepted",
                "headerStatus": "Accepted",
                "sha256": "abc",
            }
        ],
    }


class RepoIdentityTest(unittest.TestCase):
    """A global `url.git@github.com:.insteadOf https://github.com/` rewrite means a
    clone's stored origin never literally matches the URL it was cloned from."""

    def test_ssh_and_https_forms_are_the_same_repo(self):
        https = "https://github.com/theupdateframework/taps.git"
        for equivalent in (
            "git@github.com:theupdateframework/taps.git",
            "ssh://git@github.com/theupdateframework/taps",
            "https://github.com/theupdateframework/taps",
            "HTTPS://GitHub.com/theupdateframework/taps.git",
        ):
            self.assertEqual(repo_identity(https), repo_identity(equivalent), equivalent)

    def test_different_repos_and_hosts_stay_different(self):
        base = repo_identity("https://github.com/theupdateframework/taps.git")
        self.assertNotEqual(base, repo_identity("git@github.com:someone/my-work.git"))
        self.assertNotEqual(base, repo_identity("git@gitlab.com:theupdateframework/taps.git"))


class TapHeaderTest(unittest.TestCase):
    def test_reads_fields_and_joins_continuation_lines(self):
        header = parse_tap_header(
            "* TAP: 3\n"
            "* Title: Multi-role delegations\n"
            "* Author: Trishank Karthik Kuppusamy, Sebastien Awwad,\n"
            "          Justin Cappos\n"
            "* Status: Accepted\n"
            "\n"
            "# Abstract\n"
        )
        self.assertEqual(header["TAP"], "3")
        self.assertEqual(header["Title"], "Multi-role delegations")
        self.assertEqual(header["Status"], "Accepted")
        self.assertIn("Sebastien Awwad, Justin Cappos", header["Author"])

    def test_stops_at_the_blank_line_so_body_text_is_not_absorbed(self):
        header = parse_tap_header("* TAP: 9\n\n# Abstract\n\n* Status: NotAStatus\n")
        self.assertNotIn("Status", header)


class ReadmeStatusTest(unittest.TestCase):
    def test_groups_taps_under_their_status_heading(self):
        statuses = parse_readme_statuses(
            "# TAPs\n\n## Accepted\n\n* [TAP 3: Multi-role](tap3.md)\n"
            "* [TAP 15: Succinct](tap15.md)\n\n## Draft\n\n* [TAP 16: Merkle](tap16.md)\n"
            "\n## License\n\n* [Not a tap](x.md)\n"
        )
        self.assertEqual(statuses, {3: "Accepted", 15: "Accepted", 16: "Draft"})

    def test_ignores_headings_that_are_not_statuses(self):
        self.assertEqual(parse_readme_statuses("## Acknowledgements\n\n* [TAP 1: x](tap1.md)\n"), {})


class SpecParsingTest(unittest.TestCase):
    def test_metadata_version_date_and_editor_affiliations(self):
        spec = parse_spec_metadata(SPEC_METADATA)
        self.assertEqual(spec["version"], "1.0.35")
        self.assertEqual(spec["lastModified"], "2026-07-15")
        self.assertEqual(
            spec["editors"], ["Justin Cappos (NYU)", "Marina Moore (Edera)", "Nobody"]
        )

    def test_metadata_yields_none_when_the_block_is_missing(self):
        # validate_upstream turns this into a hard error; the parser itself is
        # only responsible for not inventing a value.
        spec = parse_spec_metadata("no metadata block here")
        self.assertIsNone(spec["version"])
        self.assertEqual(spec["editors"], [])

    def test_attacks_are_normalised_and_sorted(self):
        self.assertEqual(
            parse_spec_attacks(SPEC_ATTACKS),
            ["Endless data", "Rollback", "Vulnerability to key compromises"],
        )

    def test_attacks_empty_when_section_anchor_is_renamed(self):
        self.assertEqual(parse_spec_attacks(SPEC_ATTACKS.replace("goals-to-protect", "goals-x")), [])

    def test_incorporated_taps(self):
        self.assertEqual(
            parse_spec_incorporated(SPEC_INCORPORATED),
            [
                {"tap": 6, "title": "Include specification version in metadata"},
                {"tap": 11, "title": "Using POUFs for Interoperability"},
            ],
        )

    def test_section_split_detects_a_changed_body(self):
        before = split_spec_sections("intro {#alpha} one two {#beta} three")
        after = split_spec_sections("intro {#alpha} one CHANGED {#beta} three")
        self.assertEqual(set(before), {"alpha", "beta"})
        self.assertNotEqual(before["alpha"], after["alpha"])
        self.assertEqual(before["beta"], after["beta"])


class ValidateUpstreamTest(unittest.TestCase):
    """The core regression guard: an empty extraction must stop the run, not be
    quietly skipped by a downstream `if value and ...` comparison."""

    def test_accepts_a_fully_parsed_upstream(self):
        validate_upstream(minimal_upstream())

    def test_raises_on_each_missing_spec_field(self):
        for field in ("version", "lastModified", "editors", "attacks", "anchors", "incorporatedTaps"):
            empty = "" if field in ("version", "lastModified") else type(minimal_upstream()["spec"][field])()
            with self.assertRaises(ParseError, msg=field) as caught:
                validate_upstream(minimal_upstream(**{field: empty}))
            self.assertIn(field, str(caught.exception))

    def test_raises_when_no_taps_were_found(self):
        upstream = minimal_upstream()
        upstream["taps"] = []
        with self.assertRaises(ParseError):
            validate_upstream(upstream)

    def test_raises_on_a_tap_missing_title_or_status(self):
        for field in ("title", "status"):
            upstream = minimal_upstream()
            upstream["taps"][0][field] = ""
            with self.assertRaises(ParseError, msg=field):
                validate_upstream(upstream)


class ConformanceMatrixTest(unittest.TestCase):
    def test_parses_only_the_matrix_include_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            clients = parse_conformance_clients(write_workflow(Path(tmp), WORKFLOW))
        # The upload artifact's `name: tuf-conformance-results` and the
        # `name: github-pages` environment are not clients.
        self.assertEqual([c["name"] for c in clients], ["python-tuf", "tuf-js"])
        self.assertEqual(clients[0]["url"], "https://github.com/theupdateframework/python-tuf")

    def test_tolerates_reordered_keys_within_an_entry(self):
        reordered = WORKFLOW.replace(
            "          - name: python-tuf\n            repo: theupdateframework/python-tuf",
            "          - repo: theupdateframework/python-tuf\n            name: python-tuf",
        )
        with tempfile.TemporaryDirectory() as tmp:
            clients = parse_conformance_clients(write_workflow(Path(tmp), reordered))
        self.assertEqual({c["name"] for c in clients}, {"python-tuf", "tuf-js"})

    def test_raises_when_an_entry_loses_its_repo(self):
        partial = WORKFLOW.replace("            repo: theupdateframework/tuf-js", "            src: x/y")
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ParseError) as caught:
            parse_conformance_clients(write_workflow(Path(tmp), partial))
        self.assertIn("tuf-js", str(caught.exception))

    def test_raises_when_the_workflow_or_include_block_is_gone(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ParseError):
            parse_conformance_clients(Path(tmp))
        without_include = WORKFLOW.replace("        include:\n", "")
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ParseError):
            parse_conformance_clients(write_workflow(Path(tmp), without_include))


class SyncRepoSafetyTest(unittest.TestCase):
    """`git reset --hard` is unrecoverable, so every guard in front of it earns a
    test. Each of these represents work a real developer could lose."""

    URL = "https://github.com/theupdateframework/taps.git"

    def make_clone(self, root: Path, *, marker: bool, origin: str | None = None) -> Path:
        dest = root / "taps"
        dest.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "--initial-branch=master", "."], cwd=dest, check=True)
        subprocess.run(
            ["git", "remote", "add", "origin", origin or "git@github.com:theupdateframework/taps.git"],
            cwd=dest,
            check=True,
        )
        (dest / "tap3.md").write_text("* TAP: 3\n")
        subprocess.run(["git", "add", "-A"], cwd=dest, check=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
            cwd=dest,
            check=True,
        )
        if marker:
            (dest / OWNED_MARKER).write_text("disposable\n")
        return dest

    def test_refuses_a_checkout_without_our_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self.make_clone(Path(tmp), marker=False)
            with self.assertRaises(CacheSafetyError) as caught:
                sync_repo(self.URL, dest, offline=False)
            self.assertIn(OWNED_MARKER, str(caught.exception))
            self.assertTrue((dest / "tap3.md").exists())

    def test_refuses_a_marked_checkout_of_a_different_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self.make_clone(
                Path(tmp), marker=True, origin="git@github.com:someone/my-real-work.git"
            )
            with self.assertRaises(CacheSafetyError) as caught:
                sync_repo(self.URL, dest, offline=False)
            self.assertIn("my-real-work", str(caught.exception))

    def test_refuses_a_marked_checkout_with_uncommitted_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self.make_clone(Path(tmp), marker=True)
            (dest / "WIP.md").write_text("uncommitted\n")
            with self.assertRaises(CacheSafetyError) as caught:
                sync_repo(self.URL, dest, offline=False)
            self.assertIn("uncommitted changes", str(caught.exception))
            self.assertTrue((dest / "WIP.md").exists())

    def make_local_pair(self, root: Path) -> tuple[str, Path]:
        """A bare origin plus a real clone of it, so the fetch/reset path can be
        exercised without touching the network."""
        origin = root / "origin.git"
        seed = root / "seed"
        seed.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "--initial-branch=master", "."], cwd=seed, check=True)
        (seed / "tap3.md").write_text("* TAP: 3\n")
        subprocess.run(["git", "add", "-A"], cwd=seed, check=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"],
            cwd=seed,
            check=True,
        )
        subprocess.run(
            ["git", "clone", "-q", "--bare", str(seed), str(origin)], check=True, capture_output=True
        )
        dest = root / "clone"
        subprocess.run(
            ["git", "clone", "-q", "--depth", "1", str(origin), str(dest)],
            check=True,
            capture_output=True,
        )
        (dest / OWNED_MARKER).write_text("disposable\n")
        return str(origin), dest

    def test_marked_clean_clone_syncs_and_the_marker_is_not_treated_as_dirt(self):
        with tempfile.TemporaryDirectory() as tmp:
            url, dest = self.make_local_pair(Path(tmp))
            sha = sync_repo(url, dest, offline=False)
            self.assertRegex(sha, r"^[0-9a-f]{40}$")
            self.assertTrue((dest / OWNED_MARKER).exists())

    def test_refuses_a_marked_clone_holding_unpushed_commits(self):
        with tempfile.TemporaryDirectory() as tmp:
            url, dest = self.make_local_pair(Path(tmp))
            (dest / "EXTRA.md").write_text("local work\n")
            subprocess.run(["git", "add", "EXTRA.md"], cwd=dest, check=True)
            subprocess.run(
                ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "unpushed"],
                cwd=dest,
                check=True,
            )
            with self.assertRaises(CacheSafetyError) as caught:
                sync_repo(url, dest, offline=False)
            self.assertIn("not present on", str(caught.exception))
            self.assertTrue((dest / "EXTRA.md").exists())

    def test_offline_never_touches_the_checkout(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = self.make_clone(Path(tmp), marker=False)
            (dest / "WIP.md").write_text("uncommitted\n")
            sync_repo(self.URL, dest, offline=True)
            self.assertTrue((dest / "WIP.md").exists())

    def test_offline_with_no_clone_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(RuntimeError):
            sync_repo(self.URL, Path(tmp) / "missing", offline=True)


class DriftTest(unittest.TestCase):
    def data(self, **overrides) -> dict:
        base = {
            "spec": {
                "version": "1.0.35",
                "lastModified": "2026-07-15",
                "editors": ["Justin Cappos (NYU)"],
                "attacks": ["Rollback"],
                "constraints": {
                    "keyid": {"id": "C-KEYID", "description": "d", "specSection": "file-formats-keys"}
                },
            },
            "taps": [
                {
                    "tap": 3,
                    "title": "Multi-role delegations",
                    "status": "Accepted",
                    "url": "https://github.com/theupdateframework/taps/blob/master/tap3.md",
                }
            ],
            "incorporatedTaps": [
                {"tap": 6, "title": "Include specification version in metadata", "status": "Final"}
            ],
            "processTaps": [],
            "implementations": [],
            "tapInteractions": [],
        }
        base.update(overrides)
        return base

    def upstream(self) -> dict:
        up = minimal_upstream()
        up["taps"].append(
            {
                "tap": 6,
                "title": "Include specification version in metadata",
                "status": "Accepted",
                "headerStatus": "Final",
                "sha256": "def",
            }
        )
        return up

    def messages(self, report: Report) -> str:
        return "\n".join(m for group in report.groups.values() for m in group)

    def test_no_drift_on_matching_data(self):
        report = check_drift(self.data(), self.upstream(), {"taps": {"3": "abc", "6": "def"}})
        self.assertEqual(report.groups.get("spec"), None, self.messages(report))
        self.assertEqual(report.groups.get("taps"), None, self.messages(report))

    def test_reports_spec_version_and_date_drift(self):
        data = self.data()
        data["spec"]["version"] = "1.0.34"
        data["spec"]["lastModified"] = "2026-01-22"
        text = self.messages(check_drift(data, self.upstream(), None))
        self.assertIn("1.0.34", text)
        self.assertIn("2026-01-22", text)

    def test_reports_an_empty_data_title_rather_than_skipping_it(self):
        data = self.data()
        data["taps"][0]["title"] = ""
        self.assertIn("title", self.messages(check_drift(data, self.upstream(), None)))

    def test_reports_a_specsection_that_is_no_longer_an_anchor(self):
        data = self.data()
        data["spec"]["constraints"]["keyid"]["specSection"] = "renamed-away"
        self.assertIn("renamed-away", self.messages(check_drift(data, self.upstream(), None)))

    def test_reports_a_tap_present_upstream_but_unclassified(self):
        data = self.data()
        data["incorporatedTaps"] = []
        text = self.messages(check_drift(data, self.upstream(), None))
        self.assertIn("TAP 6", text)

    def test_reports_a_tap_classified_into_two_arrays(self):
        data = self.data()
        data["processTaps"] = [{"tap": 3, "title": "Multi-role delegations", "notes": "n"}]
        self.assertIn("more than one array", self.messages(check_drift(data, self.upstream(), None)))

    def test_reports_a_tap_listed_twice_in_one_array(self):
        data = self.data()
        data["taps"].append(dict(data["taps"][0]))
        self.assertIn("listed twice", self.messages(check_drift(data, self.upstream(), None)))

    def test_reports_a_non_canonical_tap_url(self):
        data = self.data()
        data["taps"][0]["url"] = "https://github.com/theupdateframework/taps/pull/195"
        self.assertIn("pull/195", self.messages(check_drift(data, self.upstream(), None)))

    def test_body_change_and_absent_baseline_are_both_reported(self):
        changed = check_drift(self.data(), self.upstream(), {"taps": {"3": "STALE", "6": "def"}})
        self.assertIn("body changed", self.messages(changed))
        self.assertIn("no provenance baseline", self.messages(check_drift(self.data(), self.upstream(), None)))


class ConformanceCheckTest(unittest.TestCase):
    CLIENTS = [
        {"name": "python-tuf", "repo": "a/b", "url": "https://github.com/a/b"},
        {"name": "tuf-js", "repo": "c/d", "url": "https://github.com/c/d"},
    ]

    def test_flags_a_tested_client_missing_from_the_data(self):
        data = {"implementations": [{"id": "python-tuf", "githubUrl": "https://github.com/a/b", "conformancePercent": 100}]}
        text = "\n".join(check_conformance(data, self.CLIENTS).groups["implementations"])
        self.assertIn("tuf-js", text)

    def test_flags_a_tested_client_with_no_recorded_percentage(self):
        data = {"implementations": [{"id": "x", "githubUrl": "https://github.com/a/b"}]}
        text = "\n".join(check_conformance(data, self.CLIENTS).groups["implementations"])
        self.assertIn("no conformancePercent", text)

    def test_unavailable_repo_is_reported_not_silently_skipped(self):
        report = check_conformance({"implementations": []}, [], available=False)
        self.assertIn("did NOT run", "\n".join(report.groups["implementations"]))


class SpecSectionCheckTest(unittest.TestCase):
    DATA = {
        "spec": {
            "constraints": {
                "k": {"id": "C-KEYID", "specSection": "file-formats-keys"},
                "d": {"id": "C-DELEG", "specSection": "file-formats-targets"},
            }
        }
    }

    def test_changed_cited_section_names_the_constraint(self):
        diff = {
            "available": True,
            "fromTag": "v1.0.34",
            "changedSections": ["file-formats-keys"],
            "addedSections": [],
            "removedSections": [],
        }
        text = "\n".join(check_spec_sections(self.DATA, diff).groups["spec"])
        self.assertIn("C-KEYID", text)
        self.assertNotIn("C-DELEG", text)

    def test_uncited_changes_are_summarised_separately(self):
        diff = {
            "available": True,
            "fromTag": "v1.0.34",
            "changedSections": ["metaformat"],
            "addedSections": [],
            "removedSections": [],
        }
        text = "\n".join(check_spec_sections(self.DATA, diff).groups["spec"])
        self.assertIn("metaformat", text)
        self.assertIn("no base constraint cites", text)

    def test_removed_cited_section_is_reported(self):
        diff = {
            "available": True,
            "fromTag": "v1.0.34",
            "changedSections": [],
            "addedSections": [],
            "removedSections": ["file-formats-targets"],
        }
        self.assertIn("C-DELEG", "\n".join(check_spec_sections(self.DATA, diff).groups["spec"]))

    def test_unavailable_diff_says_so(self):
        report = check_spec_sections(self.DATA, {"available": False, "reason": "no tag"})
        self.assertIn("unverified", "\n".join(report.groups["spec"]))


class ReadmeCountTest(unittest.TestCase):
    DATA = {
        "spec": {"version": "1.0.35", "constraints": {f"c{i}": {} for i in range(13)}},
        "taps": [{"tap": 3, "title": "t"}],
        "incorporatedTaps": [],
        "implementations": [{"id": "x", "githubUrl": "https://github.com/a/b"}],
        "tapInteractions": [{"type": "synergy"}],
    }

    def readme(self, **kw) -> str:
        return (
            f"Toggle any combination of {kw.get('taps', 1)} TAPs across "
            f"{kw.get('impls', 1)} TUF client libraries.\n"
            f"spec metadata (v{kw.get('version', '1.0.35')})\n"
            f"{kw.get('constraints', 13)} base spec constraints\n"
            f"{kw.get('synergies', 1)} synergies\n"
            "- [TAP 3](https://github.com/theupdateframework/taps/blob/master/tap3.md)\n"
            "- [x](https://github.com/a/b)\n"
        )

    def test_consistent_readme_reports_nothing(self):
        self.assertEqual(check_readme_counts(self.readme(), self.DATA).groups, {})

    def test_stale_implementation_count(self):
        text = "\n".join(check_readme_counts(self.readme(impls=17), self.DATA).groups["docs"])
        self.assertIn("[17] implementations", text)

    def test_stale_spec_version_mention(self):
        text = "\n".join(check_readme_counts(self.readme(version="1.0.34"), self.DATA).groups["docs"])
        self.assertIn("1.0.34", text)

    def test_missing_tap_link_and_missing_impl_url(self):
        without_tap = self.readme().replace(
            "- [TAP 3](https://github.com/theupdateframework/taps/blob/master/tap3.md)\n", ""
        )
        self.assertIn("TAP 3", "\n".join(check_readme_counts(without_tap, self.DATA).groups["docs"]))
        without_impl = self.readme().replace("- [x](https://github.com/a/b)\n", "")
        self.assertIn("does not mention x", "\n".join(check_readme_counts(without_impl, self.DATA).groups["docs"]))


class ReadmeTapTitleTest(unittest.TestCase):
    UPSTREAM = [
        {"tap": 12, "title": "Improving keyid flexibility"},
        {"tap": 17, "title": "Remove Signature Wrapper from the TUF Specification"},
        {"tap": 6, "title": "Include specification version in metadata"},
    ]

    def link(self, num: int, label: str) -> str:
        return f"  - [TAP {num}](https://github.com/theupdateframework/taps/blob/master/tap{num}.md) — {label}\n"

    def test_accurate_labels_report_nothing(self):
        readme = self.link(12, "Improving keyid flexibility") + self.link(
            17, "Remove Signature Wrapper from the TUF Specification"
        )
        self.assertEqual(check_readme_tap_titles(readme, self.UPSTREAM).groups, {})

    def test_a_wrong_subject_is_reported(self):
        # The real bug this caught: TAP 17 is about the signature wrapper, not
        # target paths, and TAP 12 is about keyids, not delegation.
        readme = self.link(17, "Remove Target Paths from Snapshot") + self.link(
            12, "Improving Delegation"
        )
        text = "\n".join(check_readme_tap_titles(readme, self.UPSTREAM).groups["docs"])
        self.assertIn("TAP 17", text)
        self.assertIn("TAP 12", text)

    def test_incorporated_suffix_and_trailing_period_are_tolerated(self):
        readme = self.link(6, "Include specification version in metadata (incorporated)")
        self.assertEqual(check_readme_tap_titles(readme, self.UPSTREAM).groups, {})

    def test_unknown_tap_numbers_are_skipped(self):
        self.assertEqual(check_readme_tap_titles(self.link(99, "Whatever"), self.UPSTREAM).groups, {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
