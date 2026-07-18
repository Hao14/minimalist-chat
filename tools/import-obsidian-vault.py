#!/usr/bin/env python3
"""Import canonical Minimalist Chat documents into the Obsidian vault.

The import is additive: source files are never edited. Generated performance
artifacts are summarized into one note instead of copied into the vault.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from markdownify import markdownify


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Minimalist-chat-vault"
IMPORTED_ON = date.today().isoformat()


@dataclass(frozen=True)
class Source:
    source: str
    destination: str
    title: str
    kind: str
    status: str
    tags: tuple[str, ...]
    selector: str | None = None


SOURCES = (
    Source(
        "docs/ollama-public-gateway.md",
        "40 Operations/Protected Ollama Public Gateway.md",
        "Protected Ollama Public Gateway",
        "markdown",
        "active",
        ("minimalist-chat", "operations", "security", "ollama"),
    ),
    Source(
        "docs/remote-analysis-agent.md",
        "40 Operations/Remote Analysis Access.md",
        "Remote Analysis Access",
        "markdown",
        "active",
        ("minimalist-chat", "operations", "security", "analysis", "remote-access"),
    ),
    Source(
        "reports/claude-opus-4-6-feature-research-implementation-prompt.md",
        "20 Research/Claude Feature Research and Implementation Plan.md",
        "Claude Feature Research and Implementation Plan",
        "markdown",
        "reference",
        ("minimalist-chat", "research", "product", "implementation"),
    ),
    Source(
        "reports/full-stack-audit-github-issue-draft.md",
        "30 Audits/Full Stack Audit Follow-up.md",
        "Full Stack Audit Follow-up",
        "markdown",
        "reference",
        ("minimalist-chat", "audit", "full-stack"),
    ),
    Source(
        "reports/claude-competitor-research-feature-implementation-prompt.md",
        "50 Skills/Prompt Library/Competitor Research and Feature Implementation.md",
        "Competitor Research and Feature Implementation Prompt",
        "markdown",
        "reusable",
        ("minimalist-chat", "skill", "prompt", "research"),
    ),
    Source(
        "reports/claude-mobile-first-ui-performance-audit-prompt.md",
        "50 Skills/Prompt Library/Mobile-first UI and Performance Audit.md",
        "Mobile-first UI and Performance Audit Prompt",
        "markdown",
        "reusable",
        ("minimalist-chat", "skill", "prompt", "audit", "mobile"),
    ),
    Source(
        "reports/claude-opus-4-6-feature-research-request.md",
        "50 Skills/Prompt Library/Feature Research to Implementation Prompt.md",
        "Feature Research to Implementation Prompt",
        "markdown",
        "reusable",
        ("minimalist-chat", "skill", "prompt", "research"),
    ),
    Source(
        "reports/opus-4-6-max-effort-audit-to-gpt-prompt.md",
        "50 Skills/Prompt Library/Performance Error and Bug Audit.md",
        "Performance, Error, and Bug Audit Prompt",
        "markdown",
        "reusable",
        ("minimalist-chat", "skill", "prompt", "audit"),
    ),
    Source(
        "index.html",
        "10 Product/Current/Current Product Overview.md",
        "Current Product Overview",
        "html",
        "current",
        ("minimalist-chat", "product", "current"),
        "main.static-home-shell",
    ),
    Source(
        "legacy/download.html",
        "11 Product/Legacy/Legacy - Download.md",
        "Legacy — Download",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "download"),
        ".container",
    ),
    Source(
        "legacy/faq.html",
        "11 Product/Legacy/Legacy - FAQ.md",
        "Legacy — FAQ",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "faq"),
        ".container",
    ),
    Source(
        "legacy/features.html",
        "11 Product/Legacy/Legacy - Features.md",
        "Legacy — Features",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "features"),
        ".container",
    ),
    Source(
        "legacy/index.html",
        "11 Product/Legacy/Legacy - Home.md",
        "Legacy — Home",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "home"),
        ".container",
    ),
    Source(
        "legacy/privacy.html",
        "11 Product/Legacy/Legacy - Privacy Policy.md",
        "Legacy — Privacy Policy",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "legal", "privacy"),
        ".container",
    ),
    Source(
        "legacy/story.html",
        "11 Product/Legacy/Legacy - Story.md",
        "Legacy — Story",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "story"),
        ".container",
    ),
    Source(
        "legacy/terms.html",
        "11 Product/Legacy/Legacy - Terms of Service.md",
        "Legacy — Terms of Service",
        "html",
        "archived",
        ("minimalist-chat", "product", "legacy", "legal", "terms"),
        ".container",
    ),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def frontmatter(item: Source, source_path: Path) -> str:
    tag_lines = "\n".join(f"  - {tag}" for tag in item.tags)
    relative = source_path.relative_to(ROOT).as_posix()
    return (
        "---\n"
        f"title: {yaml_string(item.title)}\n"
        f"source_kind: {item.kind}\n"
        f"source_path: {yaml_string(relative)}\n"
        f"source_sha256: {sha256(source_path)}\n"
        f"imported_on: {IMPORTED_ON}\n"
        f"status: {item.status}\n"
        "tags:\n"
        f"{tag_lines}\n"
        "---\n\n"
    )


def clean_markdown(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\r\n", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def convert_html(path: Path, selector: str | None) -> str:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    root = soup.select_one(selector) if selector else soup.body
    if root is None:
        raise ValueError(f"Could not find selector {selector!r} in {path}")
    for node in root.select(
        "script, style, noscript, svg, i, img, .shape, .toast-hidden, [aria-hidden='true']"
    ):
        node.decompose()
    converted = markdownify(
        str(root),
        heading_style="ATX",
        bullets="-",
        strip=["div", "span"],
    )
    return clean_markdown(converted)


def import_sources() -> list[dict[str, str]]:
    manifest: list[dict[str, str]] = []
    for item in SOURCES:
        source_path = ROOT / item.source
        destination = VAULT / item.destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        if item.kind == "markdown":
            body = clean_markdown(source_path.read_text(encoding="utf-8"))
        else:
            body = convert_html(source_path, item.selector)

        warning = ""
        if item.status == "archived":
            warning = (
                "> [!warning] Archived source\n"
                "> This copy reflects legacy product or legal text and is not current truth.\n\n"
            )
        provenance = (
            "> [!info] Additive import\n"
            f"> Source: `{item.source}` · SHA-256: `{sha256(source_path)[:12]}…`\n\n"
        )
        destination.write_text(
            frontmatter(item, source_path) + warning + provenance + body,
            encoding="utf-8",
            newline="\n",
        )
        manifest.append(
            {
                "title": item.title,
                "source": item.source,
                "destination": item.destination,
                "kind": item.kind,
                "status": item.status,
                "sha256": sha256(source_path),
            }
        )
    return manifest


def score(category: dict[str, Any] | None) -> str:
    value = (category or {}).get("score")
    return "—" if value is None else str(round(float(value) * 100))


def metric(audits: dict[str, Any], key: str, divisor: float = 1.0) -> str:
    value = (audits.get(key) or {}).get("numericValue")
    if value is None:
        return "—"
    scaled = float(value) / divisor
    if key == "cumulative-layout-shift":
        return f"{scaled:.3f}"
    return str(round(scaled))


def lighthouse_rows() -> list[dict[str, str]]:
    paths = sorted(
        set((ROOT / "reports").glob("lighthouse-*.json"))
        | set((ROOT / "reports").glob("lh-*.json"))
    )
    rows: list[dict[str, str]] = []
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        categories = data.get("categories") or {}
        audits = data.get("audits") or {}
        rows.append(
            {
                "fetch_time": data.get("fetchTime") or "",
                "file": path.name,
                "url": data.get("finalDisplayedUrl") or data.get("finalUrl") or "",
                "performance": score(categories.get("performance")),
                "accessibility": score(categories.get("accessibility")),
                "best_practices": score(categories.get("best-practices")),
                "seo": score(categories.get("seo")),
                "fcp_ms": metric(audits, "first-contentful-paint"),
                "lcp_ms": metric(audits, "largest-contentful-paint"),
                "tbt_ms": metric(audits, "total-blocking-time"),
                "cls": metric(audits, "cumulative-layout-shift"),
            }
        )
    rows.sort(key=lambda row: (row["fetch_time"], row["file"]))
    return rows


def write_lighthouse_history() -> None:
    rows = lighthouse_rows()
    destination = VAULT / "30 Audits/Lighthouse History.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    checkpoints = {
        "Desktop baseline": "lighthouse-desktop-before.report.json",
        "Mobile baseline": "lighthouse-mobile-before.report.json",
        "Desktop final live": "lighthouse-desktop-after-final-live.report.json",
        "Mobile final live": "lighthouse-mobile-after-final-live.report.json",
    }
    by_name = {row["file"]: row for row in rows}
    checkpoint_lines = []
    for label, filename in checkpoints.items():
        row = by_name.get(filename)
        if not row:
            continue
        checkpoint_lines.append(
            f"- **{label}:** {row['performance']}/{row['accessibility']}/"
            f"{row['best_practices']}/{row['seo']} (Performance / Accessibility / Best Practices / SEO)"
        )

    table = [
        "| Time | Report | URL | Perf | A11y | Best | SEO | FCP ms | LCP ms | TBT ms | CLS |",
        "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        table.append(
            "| {fetch_time} | `{file}` | {url} | {performance} | {accessibility} | "
            "{best_practices} | {seo} | {fcp_ms} | {lcp_ms} | {tbt_ms} | {cls} |".format(
                **row
            )
        )

    body = f"""---
title: Lighthouse History
source_kind: generated-summary
imported_on: {IMPORTED_ON}
status: reference
tags:
  - minimalist-chat
  - audit
  - performance
  - lighthouse
---

# Lighthouse History

> [!info] Generated summary
> This note condenses {len(rows)} Lighthouse JSON reports. The original JSON and HTML files remain in `reports/` and are intentionally not duplicated into the vault.

## Key checkpoints

{chr(10).join(checkpoint_lines)}

## All runs

{chr(10).join(table)}

## Excluded generated artifacts

- Lighthouse HTML reports are visual renderings of the JSON data above.
- `reports/bundle-stats.html` is a generated Rollup visualizer snapshot.
- Root `System.Collections.Hashtable.*` files are accidental login-redirect Lighthouse artifacts.
- Runtime logs, build outputs, vendor documentation, and duplicate worktrees are not knowledge sources.
"""
    destination.write_text(clean_markdown(body), encoding="utf-8", newline="\n")


def write_source_catalog(manifest: list[dict[str, str]]) -> None:
    destination = VAULT / "90 Memory/Source Catalog.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    table = [
        "| Note | Source | Kind | Status | SHA-256 |",
        "|---|---|---|---|---|",
    ]
    for entry in manifest:
        note = Path(entry["destination"]).with_suffix("").as_posix()
        table.append(
            f"| [[{note}|{entry['title']}]] | `{entry['source']}` | {entry['kind']} | "
            f"{entry['status']} | `{entry['sha256'][:12]}…` |"
        )
    body = f"""---
title: Source Catalog
imported_on: {IMPORTED_ON}
status: active
tags:
  - minimalist-chat
  - memory
  - provenance
---

# Source Catalog

This catalog records the canonical project documents copied or converted into the vault. Source files remain authoritative; imported notes are additive reading copies.

{chr(10).join(table)}

## Import boundary

Included: human-authored Markdown, current product copy, selected legacy product/legal pages, and a synthesized Lighthouse history.

Excluded: generated report renderings, duplicate worktrees, dependencies, build outputs, logs, source/config files, and transient attachments.
"""
    destination.write_text(clean_markdown(body), encoding="utf-8", newline="\n")


def main() -> None:
    manifest = import_sources()
    write_lighthouse_history()
    write_source_catalog(manifest)
    print(f"Imported {len(manifest)} canonical sources into {VAULT}")
    print(f"Summarized {len(lighthouse_rows())} Lighthouse runs")


if __name__ == "__main__":
    main()
