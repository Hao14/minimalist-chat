#!/usr/bin/env python3
"""Merge deterministic and agent-generated Graphify extraction fragments."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "Minimalist-chat-vault" / "graphify-out"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def edge_preference(item: dict) -> tuple[float, bool, bool]:
    return (
        float(item.get("confidence_score", 0)),
        item.get("confidence") == "EXTRACTED",
        item.get("relation") == "references",
    )


def main() -> None:
    paths = [OUT / ".graphify_semantic_baseline.json"]
    paths.extend(sorted(OUT.glob(".graphify_chunk_*.json")))
    parts = [load(path) for path in paths if path.exists()]
    if not parts:
        raise SystemExit("No Graphify extraction fragments found")

    nodes_by_id: dict[str, dict] = {}
    for part in parts:
        for item in part.get("nodes", []):
            nodes_by_id[item["id"]] = item

    # Incremental fragments may link changed documents to unchanged nodes that
    # already exist in graph.json. Keep those endpoints for build_merge(); a
    # full build still requires every endpoint to be present in the fragments.
    existing_node_ids: set[str] = set()
    graph_path = OUT / "graph.json"
    if (OUT / ".graphify_incremental.json").exists() and graph_path.exists():
        existing = load(graph_path)
        existing_node_ids = {
            item["id"] for item in existing.get("nodes", []) if item.get("id")
        }
    allowed_node_ids = set(nodes_by_id) | existing_node_ids

    best_edges: dict[tuple[str, str], dict] = {}
    dropped_dangling = 0
    for part in parts:
        for item in part.get("edges", []):
            source = item.get("source")
            target = item.get("target")
            if source not in allowed_node_ids or target not in allowed_node_ids:
                dropped_dangling += 1
                continue
            if source == target:
                continue
            key = tuple(sorted((source, target)))
            current = best_edges.get(key)
            if current is None or edge_preference(item) > edge_preference(current):
                best_edges[key] = item

    hyperedges_by_id: dict[str, dict] = {}
    for part in parts:
        for item in part.get("hyperedges", []):
            valid_nodes = [node_id for node_id in item.get("nodes", []) if node_id in allowed_node_ids]
            if len(valid_nodes) >= 3:
                normalized = dict(item)
                normalized["nodes"] = valid_nodes
                hyperedges_by_id[item["id"]] = normalized

    semantic = {
        "nodes": list(nodes_by_id.values()),
        "edges": list(best_edges.values()),
        "hyperedges": list(hyperedges_by_id.values()),
        "input_tokens": sum(int(part.get("input_tokens", 0)) for part in parts),
        "output_tokens": sum(int(part.get("output_tokens", 0)) for part in parts),
    }
    (OUT / ".graphify_semantic.json").write_text(
        json.dumps(semantic, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n"
    )

    ast_path = OUT / ".graphify_ast.json"
    ast = load(ast_path) if ast_path.exists() else {"nodes": [], "edges": []}
    semantic_ids = {item["id"] for item in semantic["nodes"]}
    merged_nodes = list(ast.get("nodes", []))
    merged_nodes.extend(item for item in semantic["nodes"] if item["id"] not in {n["id"] for n in merged_nodes})
    extraction = {
        "nodes": merged_nodes,
        "edges": list(ast.get("edges", [])) + semantic["edges"],
        "hyperedges": semantic["hyperedges"],
        "input_tokens": semantic["input_tokens"],
        "output_tokens": semantic["output_tokens"],
    }
    (OUT / ".graphify_extract.json").write_text(
        json.dumps(extraction, indent=2, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    print(
        f"Merged {len(parts)} fragments: {len(extraction['nodes'])} nodes, "
        f"{len(extraction['edges'])} edges, {len(extraction['hyperedges'])} hyperedges; "
        f"dropped {dropped_dangling} dangling edges"
    )


if __name__ == "__main__":
    main()
