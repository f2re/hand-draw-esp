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
    if axes["x"]["max_rate_mm_per_min"] > 4800 or axes["y"]["max_rate_mm_per_min"] > 4200:
        fail("commissioning motion limits became less conservative")
    if axes["x"]["acceleration_mm_per_sec2"] > 180 or axes["y"]["acceleration_mm_per_sec2"] > 140:
        fail("commissioning acceleration limits became less conservative")
    if (
        axes["x"]["motor0"]["limit_neg_pin"] != "gpio.36"
        or axes["y"]["motor0"]["limit_neg_pin"] != "gpio.35"
    ):
        fail("limit pin mismatch")
    servo = axes["z"]["motor0"]["rc_servo"]
    if servo["output_pin"] != "gpio.32" or servo["pwm_hz"] != 50:
        fail("pen servo configuration mismatch")
    if config["sdcard"]["cs_pin"] != "gpio.15":
        fail("MKS DLC32 SD pin mismatch")
    if config.get("start", {}).get("must_home") is not False:
        fail("commissioning config must allow direction checks before homing")
    production = yaml.safe_load((ROOT / "firmware" / "fluidnc" / "config-production.yaml").read_text(encoding="utf-8"))
    if production.get("start", {}).get("must_home") is not True:
        fail("production config must require homing")
    for axis_name in ("x", "y"):
        if production["axes"][axis_name]["motor0"].get("hard_limits") is not True:
            fail(f"production config must enable {axis_name.upper()} hard limits")
    lock = json.loads((ROOT / "firmware" / "fluidnc" / "fluidnc-lock.json").read_text(encoding="utf-8"))
    if lock.get("format") != "handdraw-fluidnc-lock-v1" or lock.get("tag") != "v4.0.3":
        fail("FluidNC lock is missing or unexpected")
    installer = (ROOT / "scripts" / "install_fluidnc.py").read_text(encoding="utf-8")
    if "fluidnc-lock.json" not in installer or "args.latest" not in installer:
        fail("FluidNC installer does not default to the pinned release")


def validate_bom() -> None:
    with (ROOT / "hardware" / "bom.csv").open(
        encoding="utf-8-sig", newline=""
    ) as stream:
        rows = list(csv.DictReader(stream, delimiter=";"))
    if len(rows) < 25:
        fail(f"BOM is unexpectedly short: {len(rows)} rows")
    for row in rows:
        if (
            not row.get("Позиция")
            or not row.get("Спецификация")
            or not row.get("Критерий приёмки")
        ):
            fail(f"incomplete BOM row {row.get('№')}")
        links = [
            row.get(f"Ссылка {index}", "").strip() for index in range(1, 5)
        ]
        variants = [
            row.get(f"Вариант {index}", "").strip() for index in range(1, 5)
        ]
        if sum(bool(link) for link in links) < 3 or sum(
            bool(name) for name in variants
        ) < 3:
            fail(f"BOM row {row.get('№')} has fewer than three purchase options")
        if any(link and not link.startswith("https://") for link in links):
            fail(f"BOM row {row.get('№')} contains a non-HTTPS link")


def validate_measurement_template() -> None:
    path = ROOT / "hardware" / "measurements.example.csv"
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream, delimiter=";"))
    required_columns = {
        "Группа",
        "Компонент",
        "Артикул/ревизия",
        "Параметр",
        "Номинал",
        "Принято в CAD",
        "Ед.",
        "Допуск/критерий",
        "Статус",
    }
    if not rows:
        fail("measurement template is empty")
    columns = set(rows[0])
    missing_columns = sorted(required_columns - columns)
    if missing_columns:
        fail("measurement template lacks columns: " + ", ".join(missing_columns))
    required_groups = {
        "Направляющая",
        "Профиль",
        "Двигатель",
        "Драйвер",
        "Серво",
        "Ремень",
        "Перо",
        "Концевик",
        "Контроллер",
    }
    groups = {row.get("Группа", "").strip() for row in rows}
    missing_groups = sorted(required_groups - groups)
    if missing_groups:
        fail("measurement template lacks groups: " + ", ".join(missing_groups))


def validate_font() -> None:
    font = json.loads(
        (ROOT / "web/src/fonts/technical-cyrillic.json").read_text(
            encoding="utf-8"
        )
    )
    if font.get("format") != "hand-draw-font-v1":
        fail("font format mismatch")
    required = set("АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789")
    missing = sorted(required.difference(font.get("glyphs", {})))
    if missing:
        fail("font lacks characters: " + "".join(missing))


def validate_web_build() -> None:
    html_path = ROOT / "dist/index.html"
    gzip_path = ROOT / "dist/index.html.gz"
    manifest = json.loads(
        (ROOT / "dist/manifest.json").read_text(encoding="utf-8")
    )
    html = html_path.read_text(encoding="utf-8")
    if manifest.get("offline") is not True:
        fail("WebUI manifest is not marked offline")
    if re.search(
        r"<script[^>]+src=|<link[^>]+rel=[\"'](?:stylesheet|preload|modulepreload)",
        html,
        re.I,
    ):
        fail("built WebUI still references local runtime assets")
    if "window.HANDDRAW_EMBEDDED_FONT=" not in html:
        fail("built font is not embedded")
    if gzip.decompress(gzip_path.read_bytes()) != html_path.read_bytes():
        fail("gzip artifact does not match index.html")
    if gzip_path.stat().st_size > 250_000:
        fail("WebUI gzip is too large")


def validate_scad() -> None:
    model_path = ROOT / "hardware/cad/plotter_parts.scad"
    dimensions_path = ROOT / "hardware/cad/component_dimensions.scad"
    text = model_path.read_text(encoding="utf-8")
    dimensions = dimensions_path.read_text(encoding="utf-8")
    if "include <component_dimensions.scad>" not in text:
        fail("plotter_parts.scad does not include component dimensions")
    modules = set(
        re.findall(r"^module\s+([A-Za-z0-9_]+)\s*\(", text, re.M)
    )
    required = {
        "y_carriage_plate",
        "beam_saddle",
        "x_carriage_plate",
        "pen_body",
        "pen_slider",
        "pen_cap",
        "servo_bracket",
        "y_motor_mount",
        "y_idler_mount",
        "x_motor_mount",
        "x_idler_mount",
        "belt_clamp",
        "support_roller",
        "endstop_bracket",
        "electronics_base",
        "electronics_lid",
        "cable_clip",
        "fit_coupon",
        "full_machine",
        "motion_envelope_preview",
    }
    missing = sorted(required.difference(modules))
    if missing:
        fail("SCAD modules missing: " + ", ".join(missing))
    if "module assembly_preview" in text:
        fail("legacy catalogue-style assembly preview remains in CAD")
    for source_name, source_text in (
        (model_path.name, text),
        (dimensions_path.name, dimensions),
    ):
        if source_text.count("{") != source_text.count("}"):
            fail(f"SCAD braces are unbalanced in {source_name}")
        if "\t" in source_text:
            fail(f"SCAD source contains a tab in {source_name}")
    for token in (
        "work_travel_x = 225",
        "work_travel_y = 315",
        "gt2_pulley_teeth = 20",
        "y_block_spacing = 52",
    ):
        if token not in dimensions:
            fail(f"CAD dimensions lost required invariant: {token}")


def validate_operator_ui() -> None:
    core = (ROOT / "web/src/core.js").read_text(encoding="utf-8")
    app = (ROOT / "web/src/app.js").read_text(encoding="utf-8")
    fluidnc = (ROOT / "web/src/fluidnc.js").read_text(encoding="utf-8")
    html = (ROOT / "web/src/index.html").read_text(encoding="utf-8")
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    required_profiles = {"fineliner", "gel", "ballpoint", "pencil", "ink", "marker"}
    missing_profiles = sorted(profile for profile in required_profiles if f"{profile}: freezeProfile" not in core)
    if missing_profiles:
        fail("tool profiles missing: " + ", ".join(missing_profiles))
    for token in (
        "rasterToComicPaths", "directional-repeat", "G94", "generateBoundaryGcode",
        "MACHINE_DEFAULTS", "paperOffsetX", "pen-range-limit", "invalid-coordinate",
    ):
        if token not in core:
            fail(f"motion/media logic lost required token: {token}")
    if "G0 X" in core or "G0 Y" in core:
        fail("XY travel must use feed-controlled G1 rather than rapid G0")
    for token in (
        "readyHomed", "confirmPenTest", "confirmBoundary", "confirmSupervision",
        "machineProfileSelect", "controllerDiagnosticsButton", "commissionHomingRepeated", "stepsPerMmX",
    ):
        if token not in html:
            fail(f"operator preflight lost required control: {token}")
    if html.count('role="tab"') < 8 or html.count('role="tabpanel"') < 8:
        fail("operator navigation lacks tab/tabpanel semantics")
    if "bindRovingTabs" not in app or "Object.values(ready).every(Boolean)" not in app:
        fail("keyboard navigation or launch gate is missing")
    for token in ("validateMachineProfile", "runControllerDiagnostics", "calculateMachineCalibration", "MACHINE_PROFILE_STORAGE_KEY"):
        if token not in app:
            fail(f"commissioning workflow is missing: {token}")
    for token in (
        "safeJobFileName", "byte-for-byte", "moveFile", "commandQueue", "finishActiveCommand",
        "queryDiagnostics", "monitorLimits", "parseControllerBuildInfo",
    ):
        if token not in fluidnc:
            fail(f"FluidNC reliability feature is missing: {token}")
    svg_import = (ROOT / "web/src/svg-import.js").read_text(encoding="utf-8")
    for token in ("ALLOWED_ELEMENTS", "unsafeAttributeValue", "MAX_SVG_ELEMENTS"):
        if token not in svg_import:
            fail(f"SVG sanitizer is missing: {token}")
    if "tests/browser_smoke.py --no-screenshot" not in ci or "playwright install" not in ci:
        fail("CI does not execute the real browser operator flow")


def validate_docs() -> None:
    required = [
        "README.md",
        "CONTRIBUTING.md",
        "NOTICE.md",
        "docs/ARCHITECTURE.md",
        "docs/WEB_INTERFACE.md",
        "docs/FIRMWARE_AND_GCODE.md",
        "docs/ART_DIRECTION.md",
        "docs/CALIBRATION.md",
        "docs/COMMISSIONING.md",
        "docs/SOURCES.md",
        "docs/START_HERE.md",
        "docs/CAD_REWORK_PLAN.md",
        "docs/images/web-ui.svg",
        "docs/images/printed-parts.svg",
        "hardware/BOM.md",
        "hardware/PRINTING.md",
        "hardware/ASSEMBLY.md",
        "hardware/WIRING.md",
        "hardware/MEASUREMENTS.md",
        "hardware/measurements.example.csv",
        "hardware/cad/README.md",
        "hardware/cad/component_dimensions.scad",
        "hardware/cad/plotter_parts.scad",
        "firmware/fluidnc/INSTALL.md",
        "firmware/fluidnc/config-production.yaml",
        "firmware/fluidnc/fluidnc-lock.json",
        "scripts/setup_project.py",
        "scripts/prepare_controller_bundle.py",
        "scripts/install_fluidnc.py",
        "scripts/apply_machine_profile.py",
        "scripts/validate_cad.py",
        ".github/workflows/release.yml",
    ]
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        fail("documentation files missing: " + ", ".join(missing))


def main() -> int:
    checks = [
        validate_config,
        validate_bom,
        validate_measurement_template,
        validate_font,
        validate_web_build,
        validate_scad,
        validate_operator_ui,
        validate_docs,
    ]
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
