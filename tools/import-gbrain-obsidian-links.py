#!/usr/bin/env python3
"""Reconcile resolved Obsidian wikilinks into GBrain's typed link table.

GBrain v0.42.58's Windows filesystem resolver joins paths with backslashes,
while imported slugs use forward slashes. This additive bridge records the
already-validated project-note wikilinks with explicit provenance.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Minimalist-chat-vault"
DEFAULT_GBRAIN = Path(shutil.which("gbrain") or (Path.home() / ".bun" / "bin" / "gbrain.exe"))
DEFAULT_STATE = Path.home() / ".gbrain" / "state" / "minimalist-chat-obsidian-links.json"
EXCLUDED_SOURCE_PARTS = {"skills", ".codex", ".obsidian", "graphify-out"}
EXCLUDED_TARGET_PARTS = {"skills", ".codex", ".obsidian", "graphify-out"}
INCLUDED_TOP_LEVEL = {
    "00 Home",
    "10 Product",
    "11 Product",
    "20 Research",
    "30 Audits",
    "40 Operations",
    "50 Skills",
    "90 Memory",
}
MEDIA_SUFFIXES = {
    ".avif",
    ".gif",
    ".jpeg",
    ".jpg",
    ".mov",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".svg",
    ".wav",
    ".webm",
    ".webp",
}
DEFAULT_COMMAND_TIMEOUT_SECONDS = 120


def bounded_timeout(value: str) -> int:
    try:
        timeout = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("timeout must be an integer") from error
    if not 5 <= timeout <= 600:
        raise argparse.ArgumentTypeError("timeout must be between 5 and 600 seconds")
    return timeout


def process_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip()
    return value.strip()


def run_gbrain_command(
    gbrain: Path,
    arguments: list[str],
    action: str,
    timeout_seconds: int,
) -> str | None:
    try:
        result = subprocess.run(
            [str(gbrain), *arguments],
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        detail = process_output(error.stderr) or process_output(error.stdout)
        suffix = f": {detail}" if detail else ""
        return f"{action}: timed out after {timeout_seconds} seconds{suffix}"
    if result.returncode != 0:
        detail = process_output(result.stderr) or process_output(result.stdout) or f"exit {result.returncode}"
        return f"{action}: {detail}"
    return None


def slug_part(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9._-]+", "-", value.lower())
    return re.sub(r"-{2,}", "-", normalized).strip("-.")


def gbrain_slug(path: Path) -> str:
    relative = path.relative_to(VAULT).with_suffix("")
    return "/".join(slug_part(part) for part in relative.parts)


def strip_code_fences(text: str) -> str:
    return re.sub(r"```.*?```", "", text, flags=re.DOTALL)


def project_markdown() -> list[Path]:
    return sorted(
        path
        for path in VAULT.rglob("*.md")
        if path.relative_to(VAULT).parts[0] in INCLUDED_TOP_LEVEL
        if not any(part in EXCLUDED_SOURCE_PARTS for part in path.relative_to(VAULT).parts)
    )


def target_markdown() -> list[Path]:
    return sorted(
        path
        for path in VAULT.rglob("*.md")
        if path.relative_to(VAULT).parts[0] in INCLUDED_TOP_LEVEL
        if not any(part in EXCLUDED_TARGET_PARTS for part in path.relative_to(VAULT).parts)
    )


def resolve_target(source: Path, raw_target: str, by_lower_path: dict[str, Path], by_name: dict[str, list[Path]]) -> Path | None:
    target = raw_target.split("|", 1)[0].split("#", 1)[0].strip().replace("\\", "/")
    if not target:
        return None
    target = target.removesuffix(".md")

    candidates = [
        (source.parent.relative_to(VAULT) / target).as_posix(),
        Path(target).as_posix(),
    ]
    for candidate in candidates:
        hit = by_lower_path.get(candidate.lower())
        if hit:
            return hit

    basename_hits = by_name.get(Path(target).name.lower(), [])
    return basename_hits[0] if len(basename_hits) == 1 else None


def collect_links() -> tuple[list[tuple[str, str]], list[str]]:
    files = project_markdown()
    targets = target_markdown()
    by_lower_path = {
        path.relative_to(VAULT).with_suffix("").as_posix().lower(): path for path in targets
    }
    by_name: dict[str, list[Path]] = {}
    for path in targets:
        by_name.setdefault(path.stem.lower(), []).append(path)

    links: set[tuple[str, str]] = set()
    unresolved: list[str] = []
    for source in files:
        text = strip_code_fences(source.read_text(encoding="utf-8"))
        for raw in re.findall(r"\[\[([^\]]+)\]\]", text):
            target_path = raw.split("|", 1)[0].split("#", 1)[0].strip()
            normalized_target = target_path.replace("\\", "/").lstrip("./")
            if normalized_target.split("/", 1)[0] in EXCLUDED_TARGET_PARTS:
                continue
            if Path(target_path).suffix.lower() in MEDIA_SUFFIXES:
                continue
            target = resolve_target(source, raw, by_lower_path, by_name)
            if target is None:
                unresolved.append(f"{source.relative_to(VAULT).as_posix()} -> {raw}")
                continue
            source_slug = gbrain_slug(source)
            target_slug = gbrain_slug(target)
            if source_slug != target_slug:
                links.add((source_slug, target_slug))
    return sorted(links), sorted(set(unresolved))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Create links; default is preview only")
    parser.add_argument("--strict", action="store_true", help="Fail when any included wikilink is unresolved")
    parser.add_argument("--quiet", action="store_true", help="Print summaries without every resolved pair")
    parser.add_argument("--force", action="store_true", help="Reapply every current link instead of only state changes")
    parser.add_argument("--gbrain", type=Path, default=DEFAULT_GBRAIN)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument(
        "--command-timeout-seconds",
        type=bounded_timeout,
        default=DEFAULT_COMMAND_TIMEOUT_SECONDS,
        help="Per-link GBrain command timeout (5-600 seconds; default: 120)",
    )
    args = parser.parse_args()

    links, unresolved = collect_links()
    current_links = {tuple(link) for link in links}
    previous_links: set[tuple[str, str]] = set()
    if args.state.exists():
        payload = json.loads(args.state.read_text(encoding="utf-8"))
        if payload.get("schema_version") != 1 or not isinstance(payload.get("links"), list):
            raise ValueError(f"Unsupported Obsidian-link state file: {args.state}")
        previous_links = {
            (str(item[0]), str(item[1]))
            for item in payload["links"]
            if isinstance(item, list) and len(item) == 2
        }
    stale_links = sorted(previous_links - current_links)
    new_links = links if args.force else sorted(current_links - previous_links)
    print(f"Resolved {len(links)} unique Obsidian links; unresolved {len(unresolved)}")
    print(f"New managed links to add: {len(new_links)}")
    print(f"Stale managed links to remove: {len(stale_links)}")
    if not args.quiet:
        for source, target in links:
            print(f"  {source} -> {target}")
    if unresolved:
        print("Unresolved:")
        for item in unresolved:
            print(f"  {item}")
    if args.strict and unresolved:
        print("Strict mode: refusing to continue with unresolved included wikilinks.")
        return 2

    if not args.apply:
        print("Preview only. Re-run with --apply to write GBrain links.")
        return 0

    failures = []
    for source, target in stale_links:
        failure = run_gbrain_command(
            args.gbrain,
            [
                "unlink",
                source,
                target,
                "--link-type",
                "mentions",
                "--link-source",
                "obsidian-import",
                "--source",
                "default",
            ],
            f"remove {source} -> {target}",
            args.command_timeout_seconds,
        )
        if failure:
            failures.append(failure)

    for source, target in new_links:
        failure = run_gbrain_command(
            args.gbrain,
            [
                "link",
                source,
                target,
                "--link-type",
                "mentions",
                "--link-source",
                "obsidian-import",
                "--source",
                "default",
            ],
            f"add {source} -> {target}",
            args.command_timeout_seconds,
        )
        if failure:
            failures.append(failure)

    print(
        f"Reconciled {len(links)} current links: added {len(new_links)}, "
        f"removed {len(stale_links)} stale; failures {len(failures)}"
    )
    for failure in failures:
        print(f"  {failure}")
    if failures:
        return 1

    args.state.parent.mkdir(parents=True, exist_ok=True)
    state_payload = {
        "schema_version": 1,
        "vault": str(VAULT),
        "links": [list(link) for link in links],
    }
    temporary_state = args.state.with_suffix(args.state.suffix + ".tmp")
    temporary_state.write_text(json.dumps(state_payload, indent=2) + "\n", encoding="utf-8")
    temporary_state.replace(args.state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
