#!/usr/bin/env python3
"""Repository-level checks that do not require ESP32 hardware."""

from __future__ import annotations

import csv
import gzip
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise AssertionError(message)


def validate_config() -> None:
    path = ROOT / "firmware" / "fluidnc" / "config.yaml"
    text = path.read_text(encoding="utf-8")
    if "\t" in text:
        fail("FluidNC config contains a tab")
    config = yaml.safe_load(text)
    if config.get("board") != "MKS-DLC32 V2.1":
        fail("unexpected FluidNC board")
    axes = config["axes"]
    if axes["x"]["steps_per_mm"] != 80 or axes["y"]["steps_per_mm"] != 80:
        fail("GT2/20T scale must be 80 steps/mm at 1/16 microstepping")
    if axes["x"]["motor0"]["limit_neg_pin"] != "gpio.36" or axes["y"]["motor0"]["limit_neg_pin"] != "gpio.35":
        fail("limit pin mismatch")
    servo = axes["z"]["motor0"]["rc_servo"]
    if servo["output_pin"] != "gpio.32" or servo["pwm_hz"] != 50:
        fail("pen servo configuration mismatch")
    if config["sdcard"]["cs_pin"] != "gpio.15":
        fail("MKS DLC32 SD pin mismatch")


def validate_bom() -> None:
    with (ROOT / "hardware" / "bom.csv").open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream, delimiter=";"))
    if len(rows) < 25:
        fail(f"BOM is unexpectedly short: {len(rows)} rows")
    for row in rows:
        if not row.get("Позиция") or not row.get("Спецификация") or not row.get("Критерий приёмки"):
            fail(f"incomplete BOM row {row.get('№')}")
        links = [row.get(f"Ссылка {index}", "").strip() for index in range(1, 5)]
        variants = [row.get(f"Вариант {index}", "").strip() for index in range(1, 5)]
        if sum(bool(link) for link in links) < 3 or sum(bool(name) for name in variants) < 3:
            fail(f"BOM row {row.get('№')} has fewer than three purchase options")
        if any(link and not link.startswith("https://") for link in links):
            fail(f"BOM row {row.get('№')} contains a non-HTTPS link")


def validate_font() -> None:
    font = json.loads((ROOT / "web/src/fonts/technical-cyrillic.json").read_text(encoding="utf-8"))
    if font.get("format") != "hand-draw-font-v1":
        fail("font format mismatch")
    required = set("АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789")
    missing = sorted(required.difference(font.get("glyphs", {})))
    if missing:
        fail("font lacks characters: " + "".join(missing))


def validate_web_build() -> None:
    html_path = ROOT / "dist/index.html"
    gzip_path = ROOT / "dist/index.html.gz"
    manifest = json.loads((ROOT / "dist/manifest.json").read_text(encoding="utf-8"))
    html = html_path.read_text(encoding="utf-8")
    if manifest.get("offline") is not True:
        fail("WebUI manifest is not marked offline")
    if re.search(r"<script[^>]+src=|<link[^>]+rel=[\"'](?:stylesheet|preload|modulepreload)", html, re.I):
        fail("built WebUI still references local runtime assets")
    if "window.HANDDRAW_EMBEDDED_FONT=" not in html:
        fail("built font is not embedded")
    if gzip.decompress(gzip_path.read_bytes()) != html_path.read_bytes():
        fail("gzip artifact does not match index.html")
    if gzip_path.stat().st_size > 250_000:
        fail("WebUI gzip is too large")


def validate_scad() -> None:
    text = (ROOT / "hardware/cad/plotter_parts.scad").read_text(encoding="utf-8")
    modules = set(re.findall(r"^module\s+([A-Za-z0-9_]+)\s*\(", text, re.M))
    required = {"y_dual_carriage_plate","x_carriage","pen_body","pen_slider","pen_cap","servo_bracket","motor_mount","idler_mount","belt_clamp","support_roller","endstop_bracket","electronics_base","electronics_lid","cable_clip","fit_coupon"}
    missing = sorted(required.difference(modules))
    if missing:
        fail("SCAD modules missing: " + ", ".join(missing))
    if text.count("{") != text.count("}"):
        fail("SCAD braces are unbalanced")


def validate_docs() -> None:
    required = ["README.md","docs/ARCHITECTURE.md","docs/WEB_INTERFACE.md","docs/CALIBRATION.md","docs/SOURCES.md","docs/START_HERE.md","docs/images/web-ui.svg","docs/images/printed-parts.svg","CONTRIBUTING.md","NOTICE.md","hardware/BOM.md","hardware/PRINTING.md","hardware/ASSEMBLY.md","hardware/WIRING.md","firmware/fluidnc/INSTALL.md","scripts/setup_project.py","scripts/prepare_controller_bundle.py","scripts/install_fluidnc.py",".github/workflows/release.yml"]
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        fail("documentation files missing: " + ", ".join(missing))


def main() -> int:
    checks = [validate_config, validate_bom, validate_font, validate_web_build, validate_scad, validate_docs]
    try:
        for check in checks:
            check()
            print(f"OK {check.__name__}")
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"Repository validation passed ({len(checks)} groups).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
