#!/usr/bin/env python3
"""Dependency guard: keep the layer boundary declared in src/lib.rs from rotting further.

The library claims core < platform < model < market < runtime < ui, "each may only
depend on the ones above it in this list". Rust permits module cycles, so the compiler
will not stop a `core::` file from reaching into `runtime::app` — this script does.

Design: a ratchet, not a big-bang gate. The violations that exist today are frozen in
scripts/arch-baseline.json. `--check` (the default, CI-friendly) fails only when a NEW
edge appears or an existing edge is used MORE often than the baseline. Remove
violations and run `--update` to tighten the baseline; it never loosens by itself.

Usage:
    python3 scripts/check-arch.py            # verify: no regression since baseline
    python3 scripts/check-arch.py --update   # re-freeze the baseline after reducing it
    python3 scripts/check-arch.py --show     # print the full current dependency picture

Exit codes: 0 = OK, 1 = regression / baseline drift, 2 = usage error.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
BASELINE = ROOT / "scripts" / "arch-baseline.json"

# Layer number = allowed to depend on strictly lower numbers only (same layer is fine).
# Mirrors the bottom-up list in src/lib.rs.
LAYERS = ["core", "platform", "model", "market", "runtime", "ui"]
LEVEL = {name: i for i, name in enumerate(LAYERS)}

# Matches `crate::x::` in both `use crate::x::y;` and inline `crate::x::y()`.
CRATE_REF = re.compile(r"\bcrate::([A-Za-z_][A-Za-z0-9_]*)\b")

# Skip build-time-only / generated code the same way CI skips nothing else; today src/
# holds the whole library, so this is deliberately empty and kept as an explicit knob.
EXCLUDED_DIRS: set[str] = set()


def layer_of(rel_path: str) -> str | None:
    """Layer a source file belongs to, or None for the crate root (main/lib)."""
    parts = Path(rel_path).parts
    # rel_path looks like 'src/core/api.rs'; parts = ('src', 'core', 'api.rs').
    if len(parts) < 3 or parts[0] != "src" or parts[1] not in LEVEL:
        return None
    return parts[1]


def strip_comments(line: str) -> str:
    """Remove `//...` so a mention of `crate::ui::` inside a comment is not a dependency."""
    idx = line.find("//")
    return line if idx < 0 else line[:idx]


def scan() -> tuple[Counter[tuple[str, str]], list[str]]:
    """Return (edge -> reference count, human-readable violation detail lines)."""
    edges: Counter[tuple[str, str]] = Counter()
    details: list[str] = []
    for path in sorted(SRC.rglob("*.rs")):
        rel = path.relative_to(ROOT).as_posix()
        src = layer_of(rel)
        if src is None or any(p in EXCLUDED_DIRS for p in Path(rel).parts):
            continue
        for lineno, raw in enumerate(
            path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
        ):
            for match in CRATE_REF.finditer(strip_comments(raw)):
                dst = match.group(1)
                if dst not in LEVEL:
                    continue  # e.g. `crate::APP_VERSION` at the root — not a layer
                edges[(src, dst)] += 1
                if LEVEL[dst] > LEVEL[src]:
                    details.append(f"{rel}:{lineno}: {src} -> {dst} (reverse)")
    return edges, details


def violations_of(edges: Counter[tuple[str, str]]) -> Counter[str]:
    return Counter({
        f"{src}->{dst}": n
        for (src, dst), n in edges.items()
        if LEVEL[dst] > LEVEL[src]
    })


def load_baseline() -> dict[str, int]:
    if not BASELINE.exists():
        print(f"error: baseline missing: {BASELINE}. Run with --update once.", file=sys.stderr)
        sys.exit(2)
    data = json.loads(BASELINE.read_text(encoding="utf-8"))
    return dict(data.get("violations", {}))


def save_baseline(current: Counter[str]) -> None:
    payload = {
        "_comment": "Frozen reverse-dependency counts. --check forbids new edges or growth; --update re-freezes after reduction.",
        "layers": LAYERS,
        "violations": dict(sorted(current.items())),
    }
    BASELINE.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def show(edges: Counter[tuple[str, str]], details: list[str], current: Counter[str]) -> None:
    print("=== layer dependency edges (src -> dst : refs) ===")
    for (src, dst), n in sorted(edges.items(), key=lambda kv: (-kv[1], kv[0])):
        flag = " REVERSE" if LEVEL[dst] > LEVEL[src] else ""
        print(f"  {src:9} -> {dst:9} : {n:4}{flag}")
    print(f"\n=== reverse-dependency sites ({len(details)}) ===")
    for line in details:
        print(f"  {line}")
    print(f"\ntotal reverse refs: {sum(current.values())} across {len(current)} edges")


def check(current: Counter[str], baseline: dict[str, int]) -> int:
    grown: list[tuple[str, int, int]] = []
    for edge, now in current.items():
        before = baseline.get(edge, 0)
        if now > before:
            grown.append((edge, before, now))
    shrunk: list[tuple[str, int, int]] = []
    for edge, before in baseline.items():
        now = current.get(edge, 0)
        if now < before:
            shrunk.append((edge, before, now))

    total = sum(current.values())
    print(f"dependency guard: {total} reverse refs across {len(current)} edges")
    if grown:
        print("\nREGRESSION — new or increased reverse dependencies (fix, or justify with --update):")
        for edge, before, now in sorted(grown):
            print(f"  {edge:28} {before} -> {now}")
    if shrunk:
        print("\nImprovement — baseline can be tightened with --update:")
        for edge, before, now in sorted(shrunk):
            print(f"  {edge:28} {before} -> {now}")
    if not grown and not shrunk:
        print("No drift from baseline.")
    return 1 if grown else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--update", action="store_true", help="re-freeze the baseline to current state")
    ap.add_argument("--show", action="store_true", help="print the full dependency picture")
    args = ap.parse_args()

    edges, details = scan()
    current = violations_of(edges)

    if args.show:
        show(edges, details, current)
        return 0
    if args.update:
        save_baseline(current)
        print(f"baseline updated: {sum(current.values())} reverse refs across {len(current)} edges")
        return 0
    return check(current, load_baseline())


if __name__ == "__main__":
    sys.exit(main())
