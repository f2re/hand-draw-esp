#!/usr/bin/env python3
"""Prepare a reproducible local development environment and validate the project."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
from materialize_sources import materialize
VENV = ROOT / ".venv"


def run(args: list[str], *, env: dict[str, str] | None = None) -> None:
    print("+", " ".join(str(x) for x in args))
    subprocess.run(args, cwd=ROOT, env=env, check=True)


def parse_major(text: str) -> int:
    for token in text.replace("v", " ").split():
        head = token.split(".", 1)[0]
        if head.isdigit():
            return int(head)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare HandDraw ESP development environment")
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--recreate", action="store_true")
    args = parser.parse_args()

    materialize()
    if sys.version_info < (3, 10):
        raise SystemExit("Python 3.10 or newer is required")

    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        raise SystemExit("Node.js 20+ and npm are required")
    node_version = subprocess.check_output([node, "--version"], text=True).strip()
    if parse_major(node_version) < 20:
        raise SystemExit(f"Node.js 20+ is required, found {node_version}")

    if args.recreate and VENV.exists():
        shutil.rmtree(VENV)
    if not VENV.exists():
        run([sys.executable, "-m", "venv", str(VENV)])
    python = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    requirements = "requirements-browser.txt" if args.browser else "requirements-dev.txt"
    run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", requirements])

    if not args.skip_tests:
        env = dict(os.environ)
        env["PATH"] = str(python.parent) + os.pathsep + env.get("PATH", "")
        run([npm, "test"], env=env)
    print("Environment ready:", VENV)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
