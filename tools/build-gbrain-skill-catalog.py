#!/usr/bin/env python3
"""Build an Obsidian catalog for the locally scaffolded GBrain skills."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Minimalist-chat-vault"
SKILLS = VAULT / "skills"
OUTPUT = SKILLS / "GBrain Skill Catalog.md"


def frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    _, block, _ = text.split("---", 2)
    parsed = yaml.safe_load(block)
    return parsed if isinstance(parsed, dict) else {}


def cell(value: object) -> str:
    return " ".join(str(value or "").replace("|", "\\|").split())


def main() -> None:
    rows = []
    for skill_md in sorted(SKILLS.glob("*/SKILL.md")):
        data = frontmatter(skill_md)
        slug = skill_md.parent.name
        name = cell(data.get("name") or slug)
        description = cell(data.get("description"))
        triggers = data.get("triggers") or []
        if isinstance(triggers, str):
            triggers = [triggers]
        trigger_preview = "; ".join(cell(item) for item in triggers[:3])
        if len(triggers) > 3:
            trigger_preview += f"; +{len(triggers) - 3} more"
        mutating = "yes" if data.get("mutating") is True else "no/unspecified"
        rows.append(
            f"| [[skills/{slug}/SKILL|{name}]] | {description} | {trigger_preview or '—'} | {mutating} |"
        )

    content = f"""---
title: GBrain Skill Catalog
status: reference-only
generated_on: {date.today().isoformat()}
tags:
  - gbrain
  - skill
  - catalog
---

# GBrain Skill Catalog

> [!warning] Configuration gate
> These {len(rows)} scaffolded skills are passive instruction files. Read `[[90 Memory/GBrain Setup|GBrain Setup]]` before using them. Until the database is configured and verified, do not run brain writes, sync, autopilot, dream-cycle, or integrations.

Read [[skills/_AGENT_README|Agent onboarding]] for trigger-based routing. Always read a matched `SKILL.md` in full before acting.

| Skill | Description | Example triggers | Mutating |
|---|---|---|---|
{chr(10).join(rows)}

The pinned GBrain v0.42.58.0 manifest currently scaffolds {len(rows)} skills, even though older installation prose mentions 43. This catalog records the files actually installed.
"""
    OUTPUT.write_text(content, encoding="utf-8", newline="\n")
    print(f"Cataloged {len(rows)} GBrain skills at {OUTPUT}")


if __name__ == "__main__":
    main()
