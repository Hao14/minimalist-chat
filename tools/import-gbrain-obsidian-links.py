#!/usr/bin/env python3
"""Import resolved Obsidian wikilinks into GBrain's typed link table.

GBrain v0.42.58's Windows filesystem resolver joins paths with backslashes,
while imported slugs use forward slashes. This additive bridge records the
already-validated project-note wikilinks with explicit provenance.
"""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Minimalist-chat-vault"
DEFAULT_GBRAIN = Path.home() / ".bun" / "bin" / "gbrain.exe"
EXCLUDED_SOURCE_PARTS = {"skills", ".codex", ".obsidian", "graphify-out"}
EXCLUDED_TARGET_PARTS = {".codex", ".obsidian", "graphify-out"}


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
        if not any(part in EXCLUDED_SOURCE_PARTS for part in path.relative_to(VAULT).parts)
    )


def target_markdown() -> list[Path]:
    return sorted(
        path
        for path in VAULT.rglob("*.md")
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
    parser.add_argument("--gbrain", type=Path, default=DEFAULT_GBRAIN)
    args = parser.parse_args()

    links, unresolved = collect_links()
    print(f"Resolved {len(links)} unique Obsidian links; unresolved {len(unresolved)}")
    for source, target in links:
        print(f"  {source} -> {target}")
    if unresolved:
        print("Unresolved:")
        for item in unresolved:
            print(f"  {item}")

    if not args.apply:
        print("Preview only. Re-run with --apply to write GBrain links.")
        return 0

    failures = []
    for source, target in links:
        result = subprocess.run(
            [
                str(args.gbrain),
                "link",
                source,
                target,
                "--link-type",
                "mentions",
                "--link-source",
                "obsidian-import",
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            failures.append(f"{source} -> {target}: {result.stderr.strip() or result.stdout.strip()}")

    print(f"Applied {len(links) - len(failures)} links; failures {len(failures)}")
    for failure in failures:
        print(f"  {failure}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
