#!/usr/bin/env python3
"""Build a deterministic Graphify extraction baseline from Markdown structure.

This guarantees document, heading, wikilink, and tag relationships even when
LLM semantic extraction is unavailable. LLM fragments can be merged on top.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "Minimalist-chat-vault"
OUT = VAULT / "graphify-out"


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_") or "untitled"


def stem_for(path: Path) -> str:
    relative = path.relative_to(VAULT).with_suffix("").as_posix()
    return slug(relative)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text
    try:
        _, block, body = text.split("---", 2)
        parsed = yaml.safe_load(block)
        return (parsed if isinstance(parsed, dict) else {}), body.lstrip("\r\n")
    except (ValueError, yaml.YAMLError):
        return {}, text


def node(
    node_id: str,
    label: str,
    file_type: str,
    source_file: str,
    source_location: str | None,
    metadata: dict,
) -> dict:
    return {
        "id": node_id,
        "label": label,
        "file_type": file_type,
        "source_file": source_file,
        "source_location": source_location,
        "source_url": metadata.get("source_url"),
        "captured_at": metadata.get("captured_at"),
        "author": metadata.get("author"),
        "contributor": metadata.get("contributor"),
    }


def edge(
    source: str,
    target: str,
    relation: str,
    confidence: str,
    score: float,
    source_file: str,
    source_location: str | None,
) -> dict:
    return {
        "source": source,
        "target": target,
        "relation": relation,
        "confidence": confidence,
        "confidence_score": score,
        "source_file": source_file,
        "source_location": source_location,
        "weight": 1.0,
    }


def main() -> None:
    detection = json.loads((OUT / ".graphify_detect.json").read_text(encoding="utf-8"))
    files = [Path(path) for path in detection.get("files", {}).get("document", [])]
    lookup_files = [
        Path(path)
        for path in detection.get("all_files", detection.get("files", {})).get("document", [])
    ] or files
    nodes: list[dict] = []
    edges: list[dict] = []
    node_ids: set[str] = set()
    documents: dict[str, str] = {}
    for path in lookup_files:
        doc_id = f"{stem_for(path)}_document"
        rel_no_ext = path.relative_to(VAULT).with_suffix("").as_posix().lower()
        documents[rel_no_ext] = doc_id
        documents[path.stem.lower()] = doc_id
    tags_to_docs: dict[str, list[tuple[str, str]]] = defaultdict(list)
    pending_links: list[tuple[str, str, str, str]] = []

    for path in files:
        text = path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(text)
        stem = stem_for(path)
        doc_id = f"{stem}_document"
        first_h1 = re.search(r"^#\s+(.+?)\s*$", body, flags=re.MULTILINE)
        label = str(metadata.get("title") or (first_h1.group(1) if first_h1 else path.stem))
        source_file = str(path.resolve())
        nodes.append(node(doc_id, label, "document", source_file, f"{source_file}:1", metadata))
        node_ids.add(doc_id)

        tags = metadata.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        for tag in tags:
            tags_to_docs[str(tag).lower()].append((doc_id, source_file))

        heading_count = 0
        for line_number, line in enumerate(body.splitlines(), start=1):
            match = re.match(r"^(#{2,4})\s+(.+?)\s*$", line)
            if not match:
                continue
            heading = re.sub(r"[*_`]", "", match.group(2)).strip()
            if not heading or heading.lower() in {"table of contents", "contents"}:
                continue
            concept_id = f"{stem}_{slug(heading)}"
            if concept_id in node_ids:
                continue
            rationale_words = ("why", "rationale", "decision", "rule", "invariant", "guardrail")
            file_type = "rationale" if any(word in heading.lower() for word in rationale_words) else "concept"
            location = f"{source_file}:{line_number}"
            nodes.append(node(concept_id, heading, file_type, source_file, location, metadata))
            edges.append(edge(doc_id, concept_id, "references", "EXTRACTED", 1.0, source_file, location))
            node_ids.add(concept_id)
            heading_count += 1
            if heading_count >= 6:
                break

        for match in re.finditer(r"\[\[([^\]]+)\]\]", body):
            raw_target = match.group(1).split("|", 1)[0].split("#", 1)[0].strip()
            if raw_target:
                line_number = body.count("\n", 0, match.start()) + 1
                pending_links.append((doc_id, raw_target.lower(), source_file, f"{source_file}:{line_number}"))

    for source_id, raw_target, source_file, location in pending_links:
        target_key = raw_target.removesuffix(".md").replace("\\", "/")
        target_id = documents.get(target_key) or documents.get(Path(target_key).name.lower())
        if target_id and source_id != target_id:
            edges.append(edge(source_id, target_id, "references", "EXTRACTED", 1.0, source_file, location))

    ignored_tags = {"minimalist-chat", "map-of-content"}
    hyperedges = []
    ranked_tags = sorted(
        ((tag, entries) for tag, entries in tags_to_docs.items() if tag not in ignored_tags and len(entries) >= 2),
        key=lambda item: (-len(item[1]), item[0]),
    )
    for tag, entries in ranked_tags:
        unique_entries = list(dict.fromkeys(entries))
        for left, right in zip(unique_entries, unique_entries[1:]):
            edges.append(
                edge(left[0], right[0], "conceptually_related_to", "INFERRED", 0.85, left[1], None)
            )
        if len(unique_entries) >= 3 and len(hyperedges) < 3:
            hyperedges.append(
                {
                    "id": f"tag_{slug(tag)}",
                    "label": f"Tag: {tag}",
                    "nodes": [entry[0] for entry in unique_entries],
                    "relation": "participate_in",
                    "confidence": "EXTRACTED",
                    "confidence_score": 1.0,
                    "source_file": unique_entries[0][1],
                }
            )

    # The default Graphify build is undirected and keeps one edge per endpoint
    # pair. Keep the strongest evidence up front so diagnostics stay lossless.
    best_by_pair: dict[tuple[str, str], dict] = {}
    for item in edges:
        if item["source"] == item["target"]:
            continue
        key = tuple(sorted((item["source"], item["target"])))
        current = best_by_pair.get(key)
        preference = (
            float(item["confidence_score"]),
            item["confidence"] == "EXTRACTED",
            item["relation"] == "references",
        )
        current_preference = (
            float(current["confidence_score"]),
            current["confidence"] == "EXTRACTED",
            current["relation"] == "references",
        ) if current else (-1.0, False, False)
        if preference > current_preference:
            best_by_pair[key] = item
    deduped_edges = list(best_by_pair.values())

    payload = {
        "nodes": nodes,
        "edges": deduped_edges,
        "hyperedges": hyperedges,
        "input_tokens": 0,
        "output_tokens": 0,
    }
    target = OUT / ".graphify_semantic_baseline.json"
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n")
    print(f"Baseline: {len(nodes)} nodes, {len(deduped_edges)} edges, {len(hyperedges)} hyperedges")


if __name__ == "__main__":
    main()
