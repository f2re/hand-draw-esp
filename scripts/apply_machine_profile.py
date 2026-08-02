#!/usr/bin/env python3
"""Generate per-machine FluidNC configurations from a HandDraw machine profile."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
FORMAT = "handdraw-machine-profile-v1"
CONFIG_SOURCES = {
    "commissioning": ROOT / "firmware" / "fluidnc" / "config.yaml",
    "production": ROOT / "firmware" / "fluidnc" / "config-production.yaml",
}


def slugify(value: str) -> str:
    normalized = re.sub(r"[^0-9A-Za-zА-Яа-яЁё._-]+", "-", value.strip()).strip("-.")
    return normalized or "machine"


def positive_number(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a number") from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{field} must be a positive finite number")
    return number


def load_profile(path: Path) -> dict[str, Any]:
    try:
        profile = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read machine profile {path}: {exc}") from exc
    if profile.get("format") != FORMAT:
        raise ValueError(f"Unsupported machine profile format: {profile.get('format')!r}")
    geometry = profile.get("geometry") or {}
    profile["_steps_x"] = positive_number(geometry.get("stepsPerMmX"), "geometry.stepsPerMmX")
    profile["_steps_y"] = positive_number(geometry.get("stepsPerMmY"), "geometry.stepsPerMmY")
    return profile


def patch_steps(text: str, steps_x: float, steps_y: float) -> str:
    values = {"x": steps_x, "y": steps_y}
    current_axis: str | None = None
    replaced: set[str] = set()
    output: list[str] = []
    for line in text.splitlines():
        axis_match = re.match(r"^  ([xyzabc]):\s*$", line)
        if axis_match:
            current_axis = axis_match.group(1)
        elif re.match(r"^  [A-Za-z_][A-Za-z0-9_]*:", line):
            current_axis = None
        if current_axis in values and re.match(r"^    steps_per_mm:\s*", line):
            line = f"    steps_per_mm: {values[current_axis]:.4f}"
            replaced.add(current_axis)
        output.append(line)
    missing = sorted(set(values) - replaced)
    if missing:
        raise ValueError("Could not find steps_per_mm for axes: " + ", ".join(missing))
    return "\n".join(output) + "\n"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", type=Path, help="exported .handdraw-machine.json file")
    parser.add_argument("--output-dir", type=Path, help="output directory")
    args = parser.parse_args()

    profile_path = args.profile.expanduser().resolve()
    profile = load_profile(profile_path)
    name = str(profile.get("name") or "Machine")
    output_dir = (args.output_dir or ROOT / "build" / "machine-config" / slugify(name)).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    generated: dict[str, dict[str, Any]] = {}
    for mode, source in CONFIG_SOURCES.items():
        target = output_dir / f"config-{mode}.yaml"
        target.write_text(
            patch_steps(source.read_text(encoding="utf-8"), profile["_steps_x"], profile["_steps_y"]),
            encoding="utf-8",
        )
        generated[target.name] = {"bytes": target.stat().st_size, "sha256": sha256(target), "mode": mode}

    profile_copy = output_dir / "machine-profile.handdraw-machine.json"
    clean_profile = {key: value for key, value in profile.items() if not key.startswith("_")}
    profile_copy.write_text(json.dumps(clean_profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    generated[profile_copy.name] = {"bytes": profile_copy.stat().st_size, "sha256": sha256(profile_copy), "mode": "webui"}

    geometry = clean_profile.get("geometry") or {}
    pen = clean_profile.get("pen") or {}
    readme = output_dir / "INSTALL.txt"
    readme.write_text(
        "\n".join(
            [
                f"HandDraw ESP — configuration for {name}",
                "",
                f"X steps/mm: {profile['_steps_x']:.4f}",
                f"Y steps/mm: {profile['_steps_y']:.4f}",
                f"Paper offset: X {geometry.get('paperOffsetX', '?')} mm, Y {geometry.get('paperOffsetY', '?')} mm",
                f"Pen range: down {pen.get('penDown', '?')}, up {pen.get('penUp', '?')}",
                "",
                "1. Import machine-profile.handdraw-machine.json in HandDraw WebUI.",
                "2. Deploy config-commissioning.yaml for initial direction and limit checks.",
                "3. Deploy config-production.yaml only after the commissioning checklist is complete.",
                "4. Reboot FluidNC and inspect the complete startup log after every YAML update.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    generated[readme.name] = {"bytes": readme.stat().st_size, "sha256": sha256(readme), "mode": "instructions"}

    manifest = {
        "format": "handdraw-machine-config-bundle-v1",
        "machine": name,
        "source_profile": str(profile_path),
        "files": generated,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Machine configuration bundle: {output_dir}")
    for filename in generated:
        print(" -", filename)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
