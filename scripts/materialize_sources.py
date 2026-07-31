#!/usr/bin/env python3
"""Verify that source files tracked directly in Git are present.

Older revisions reconstructed WebUI and BOM files from a binary tar archive.
That archive was truncated in the initial publication and made clean checkouts
non-reproducible. Sources are now ordinary, reviewable repository files. The
function is kept as a compatibility hook for existing build commands.
"""
from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_SOURCES = (
    "web/src/index.html",
    "web/src/styles.css",
    "web/src/core.js",
    "web/src/svg-import.js",
    "web/src/fluidnc.js",
    "web/src/app.js",
    "web/src/fonts/technical-cyrillic.json",
    "hardware/bom.csv",
)


def materialize(force: bool = False) -> list[Path]:
    del force
    missing = [name for name in REQUIRED_SOURCES if not (ROOT / name).is_file()]
    if missing:
        raise RuntimeError(
            "tracked project sources are missing: " + ", ".join(missing)
        )
    return []


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify directly tracked HandDraw ESP sources"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="retained for compatibility; direct sources are never regenerated",
    )
    args = parser.parse_args()
    materialize(args.force)
    print(f"Tracked sources verified: {len(REQUIRED_SOURCES)} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
