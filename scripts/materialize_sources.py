#!/usr/bin/env python3
"""Restore large reproducible sources from the checked-in project archive."""
from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "packed/manifest.json"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def materialize(force: bool = False) -> list[Path]:
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    archive = ROOT / spec["archive"]
    if digest(archive.read_bytes()) != spec["archive_sha256"]:
        raise RuntimeError("packed archive checksum mismatch")

    restored: list[Path] = []
    with tarfile.open(archive, "r:gz") as tf:
        for rel, meta in spec["files"].items():
            target = ROOT / rel
            if target.exists() and digest(target.read_bytes()) == meta["sha256"] and not force:
                continue

            member = tf.getmember(meta["member"])
            if not member.isfile():
                raise RuntimeError(f"not a file: {meta['member']}")
            stream = tf.extractfile(member)
            if stream is None:
                raise RuntimeError(f"cannot read {meta['member']}")
            data = stream.read()
            if digest(data) != meta["sha256"]:
                raise RuntimeError(f"checksum mismatch: {rel}")

            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            restored.append(target)
    return restored


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    print(f"Materialized {len(materialize(args.force))} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
