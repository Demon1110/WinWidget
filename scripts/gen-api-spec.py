#!/usr/bin/env python3
"""Control-center bridge API: one source of truth, generated bindings, drift check.

The Rust registry in `src/ui/control.rs` is the only place a control-center method is
declared. This script reads its `m.insert("name", handler)` lines and generates:

  * `scripts/control-api.json`                  — machine-readable spec
  * `assets/ui/control-center/control-api.d.ts` — TS union of method names for editors

`--check` regenerates both in memory and compares them with the committed files, then
checks that every method the page calls exists in the spec. It never writes. CI runs
`--check`, so changing a method without refreshing the bindings — or calling one the
host does not implement — fails the build.

The page has one dynamic call, `api(`app.${key}`, …)`, whose keys come from
`control({ key: "…" }, …, "app")`. Those are expanded below rather than skipped, so a
typo in a settings key is caught too. `ready` (the handshake) and `package.drop` (a
file-drop channel handled in `ui/menus.rs`) are deliberately not RPC methods.

Usage:
    python3 scripts/gen-api-spec.py            # regenerate spec + d.ts
    python3 scripts/gen-api-spec.py --check    # verify generated files and page calls

Exit codes: 0 = OK, 1 = drift, 2 = usage error.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTROL_RS = ROOT / "src" / "ui" / "control.rs"
PAGE_JS = ROOT / "assets" / "ui" / "control-center" / "app.js"
SPEC = ROOT / "scripts" / "control-api.json"
DTS = ROOT / "assets" / "ui" / "control-center" / "control-api.d.ts"

# `m.insert("app.editMode", app_edit_mode);`
INSERT = re.compile(r'm\.insert\("([A-Za-z][\w.]*)",\s*([A-Za-z_]\w*)\)')

# Direct calls: api("x.y", …), call("x.y", …), postMessage(JSON.stringify({ m: "x.y" … }))
DIRECT = re.compile(r'(?:\bapi\(|\bcall\(|\bm:\s*)"([A-Za-z][\w.]*\.[A-Za-z]\w*)"')

# control({ key: "lowResource", type: "toggle", … }, S.lowResource, "app")
SCOPE_APP = re.compile(r'control\(\{\s*key:\s*"([^"]+)"[^}]*\}\s*,[^,]*,\s*"app"\s*\)')

# api(`app.${key}`) — the prefix before the interpolation.
DYNAMIC = re.compile(r'\bapi\(`([A-Za-z][\w.]*)\.\$\{key\}`')

# Not RPC methods: see the module docstring.
NON_RPC = {"ready", "package.drop"}


def registry_methods() -> list[tuple[str, str]]:
    """(method name, handler fn) pairs from the Rust registry, sorted by name."""
    text = CONTROL_RS.read_text(encoding="utf-8")
    pairs = [(m.group(1), m.group(2)) for m in INSERT.finditer(text)]
    if not pairs:
        raise SystemExit("no m.insert(...) lines found in src/ui/control.rs")
    names = [name for name, _ in pairs]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise SystemExit(f"duplicate method names in registry: {dupes}")
    return sorted(pairs)


def page_methods() -> set[str]:
    """Every method the page sends, including the dynamic `app.${key}` expansion."""
    text = PAGE_JS.read_text(encoding="utf-8")
    found = set(DIRECT.findall(text))

    app_keys = set(SCOPE_APP.findall(text))
    for prefix in DYNAMIC.findall(text):
        if prefix == "app":
            found.update(f"app.{key}" for key in app_keys)
        else:
            raise SystemExit(f"unhandled dynamic method prefix '{prefix}' in app.js")
    return found - NON_RPC


def spec_text(pairs: list[tuple[str, str]]) -> str:
    spec = {
        "bridge": "control-center",
        "source": "src/ui/control.rs::registry",
        "methods": [{"name": name, "handler": handler} for name, handler in pairs],
    }
    return json.dumps(spec, indent=2, ensure_ascii=False) + "\n"


def dts_text(pairs: list[tuple[str, str]]) -> str:
    lines = [
        "/**",
        " * Control-center bridge methods accepted by `api(method, params)`.",
        " *",
        " * Generated from src/ui/control.rs by scripts/gen-api-spec.py — do not edit.",
        " * Change the Rust registry and run `python3 scripts/gen-api-spec.py` instead.",
        " */",
        "type ControlMethod =",
    ]
    for i, (name, _) in enumerate(pairs):
        suffix = ";" if i == len(pairs) - 1 else ""
        lines.append(f'  | "{name}"{suffix}')
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="verify without writing")
    args = ap.parse_args()

    pairs = registry_methods()
    want_spec = spec_text(pairs)
    want_dts = dts_text(pairs)
    failures: list[str] = []

    if args.check:
        for path, want in ((SPEC, want_spec), (DTS, want_dts)):
            if not path.exists():
                failures.append(f"{path.relative_to(ROOT)} is missing — run gen-api-spec.py")
            elif path.read_text(encoding="utf-8") != want:
                failures.append(
                    f"{path.relative_to(ROOT)} is out of date — run gen-api-spec.py"
                )
        spec_names = {name for name, _ in pairs}
        for method in sorted(page_methods() - spec_names):
            failures.append(f"app.js calls '{method}' but the Rust registry has no such method")
        if failures:
            for line in failures:
                print(f"FAIL: {line}", file=sys.stderr)
            return 1
        print(f"OK: {len(pairs)} methods, bindings current, page calls all implemented")
        return 0

    SPEC.write_text(want_spec, encoding="utf-8")
    DTS.write_text(want_dts, encoding="utf-8")
    print(f"Wrote {SPEC.relative_to(ROOT)} and {DTS.relative_to(ROOT)} ({len(pairs)} methods)")

    # Report dead entries as information, not an error: some methods are for the tray,
    # dropped-file channel or external callers rather than the settings page.
    called = page_methods()
    unused = sorted({name for name, _ in pairs} - called)
    if unused:
        print("Not called by the control-center page (kept on purpose): " + ", ".join(unused))
    return 0


if __name__ == "__main__":
    sys.exit(main())
