#!/usr/bin/env python3
"""Validate HandDraw ESP CAD sources and engineering invariants.

The static checks run without OpenSCAD. When an OpenSCAD executable is
available, the script can also compile every printable part to CSG.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAD_DIR = ROOT / "hardware" / "cad"
DIMENSIONS = CAD_DIR / "component_dimensions.scad"
MODEL = CAD_DIR / "plotter_parts.scad"

REQUIRED_MODULES = {
    "y_carriage_plate",
    "beam_saddle",
    "x_carriage_plate",
    "pen_body",
    "pen_slider",
    "pen_cap",
    "servo_bracket",
    "belt_clamp",
    "y_motor_mount",
    "y_idler_mount",
    "x_motor_mount",
    "x_idler_mount",
    "support_roller",
    "endstop_bracket",
    "electronics_base",
    "electronics_lid",
    "cable_clip",
    "fit_coupon",
    "full_machine",
    "motion_envelope_preview",
}

PRINTABLE_PARTS = [
    "y_carriage_plate",
    "beam_saddle",
    "x_carriage_plate",
    "pen_body",
    "pen_slider",
    "pen_cap",
    "servo_bracket",
    "belt_clamp",
    "y_motor_mount",
    "y_idler_mount",
    "x_motor_mount",
    "x_idler_mount",
    "support_roller",
    "endstop",
    "electronics_base",
    "electronics_lid",
    "cable_clip",
    "fit_coupon",
]

REQUIRED_DISPATCH = set(PRINTABLE_PARTS) | {"assembly", "motion_envelope", "exploded"}


class ValidationError(RuntimeError):
    pass


def strip_comments_and_strings(text: str) -> str:
    """Replace comments and string contents with spaces, preserving newlines."""
    out: list[str] = []
    i = 0
    state = "code"
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if ch == "/" and nxt == "/":
                out.extend("  ")
                i += 2
                state = "line_comment"
            elif ch == "/" and nxt == "*":
                out.extend("  ")
                i += 2
                state = "block_comment"
            elif ch == '"':
                out.append(" ")
                i += 1
                state = "string"
            else:
                out.append(ch)
                i += 1
        elif state == "line_comment":
            if ch == "\n":
                out.append("\n")
                state = "code"
            else:
                out.append(" ")
            i += 1
        elif state == "block_comment":
            if ch == "*" and nxt == "/":
                out.extend("  ")
                i += 2
                state = "code"
            else:
                out.append("\n" if ch == "\n" else " ")
                i += 1
        elif state == "string":
            if ch == "\\" and nxt:
                out.extend("  ")
                i += 2
            elif ch == '"':
                out.append(" ")
                i += 1
                state = "code"
            else:
                out.append("\n" if ch == "\n" else " ")
                i += 1
    if state in {"block_comment", "string"}:
        raise ValidationError(f"Unterminated {state.replace('_', ' ')}")
    return "".join(out)


def check_delimiters(path: Path, text: str) -> None:
    clean = strip_comments_and_strings(text)
    opening = {"(": ")", "[": "]", "{": "}"}
    closing = {value: key for key, value in opening.items()}
    stack: list[tuple[str, int]] = []
    for index, ch in enumerate(clean):
        if ch in opening:
            stack.append((ch, index))
        elif ch in closing:
            if not stack or stack[-1][0] != closing[ch]:
                line = clean.count("\n", 0, index) + 1
                raise ValidationError(f"{path}: unmatched {ch!r} at line {line}")
            stack.pop()
    if stack:
        ch, index = stack[-1]
        line = clean.count("\n", 0, index) + 1
        raise ValidationError(f"{path}: unclosed {ch!r} from line {line}")


def parse_numeric_scalars(text: str) -> dict[str, float]:
    values: dict[str, float] = {}
    pattern = re.compile(
        r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*;",
        re.MULTILINE,
    )
    for name, raw in pattern.findall(strip_comments_and_strings(text)):
        values[name] = float(raw)
    return values


def require(values: dict[str, float], *names: str) -> list[float]:
    missing = [name for name in names if name not in values]
    if missing:
        raise ValidationError("Missing numeric CAD parameters: " + ", ".join(missing))
    return [values[name] for name in names]


def engineering_report(values: dict[str, float]) -> dict[str, float | bool]:
    (
        y_rail,
        x_rail,
        block_l,
        block_spacing,
        y_clear,
        x_clear,
        work_x,
        work_y,
        profile_l,
        inertia,
        elastic_modulus,
        pulley_teeth,
        gt2_pitch,
        servo_torque_kgcm,
        horn_radius,
        motor_torque_ncm,
    ) = require(
        values,
        "y_rail_length",
        "x_rail_length",
        "mgn12h_block_l",
        "y_block_spacing",
        "y_end_clearance",
        "x_end_clearance",
        "work_travel_x",
        "work_travel_y",
        "profile_length",
        "profile_inertia_mm4",
        "aluminium_e_n_per_mm2",
        "gt2_pulley_teeth",
        "gt2_pitch",
        "mg90s_torque_kgcm_48v",
        "mg90s_horn_radius",
        "nema17_holding_torque_ncm",
    )

    y_physical = y_rail - (block_l + block_spacing) - 2 * y_clear
    x_physical = x_rail - block_l - 2 * x_clear
    steps_per_mm = 200 * 16 / (pulley_teeth * gt2_pitch)

    # Conservative cantilever sanity check. The real beam has a rolling support,
    # so measured deflection should be lower when the roller is adjusted correctly.
    assumed_pen_load_n = 3.0
    profile_deflection_mm = (
        assumed_pen_load_n * profile_l**3 / (3 * elastic_modulus * inertia)
    )

    servo_torque_nm = servo_torque_kgcm * 9.80665 / 100.0
    servo_ideal_force_n = servo_torque_nm / (horn_radius / 1000.0)
    pulley_radius_mm = pulley_teeth * gt2_pitch / (2 * math.pi)
    motor_holding_force_n = (motor_torque_ncm / 100.0) / (pulley_radius_mm / 1000.0)

    return {
        "x_physical_travel_mm": round(x_physical, 3),
        "y_physical_travel_mm": round(y_physical, 3),
        "x_controlled_travel_mm": work_x,
        "y_controlled_travel_mm": work_y,
        "x_reserve_mm": round(x_physical - work_x, 3),
        "y_reserve_mm": round(y_physical - work_y, 3),
        "steps_per_mm_at_1_16": round(steps_per_mm, 6),
        "profile_deflection_cantilever_3n_mm": round(profile_deflection_mm, 4),
        "servo_ideal_force_at_horn_n": round(servo_ideal_force_n, 2),
        "motor_holding_belt_force_n": round(motor_holding_force_n, 2),
        "x_travel_ok": x_physical >= work_x,
        "y_travel_ok": y_physical >= work_y,
    }


def check_model_contract(text: str) -> dict[str, object]:
    clean = strip_comments_and_strings(text)
    modules = set(re.findall(r"\bmodule\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", clean))
    missing_modules = sorted(REQUIRED_MODULES - modules)
    if missing_modules:
        raise ValidationError("Missing SCAD modules: " + ", ".join(missing_modules))

    dispatch = set(re.findall(r'part\s*==\s*"([^"]+)"', text))
    missing_dispatch = sorted(REQUIRED_DISPATCH - dispatch)
    if missing_dispatch:
        raise ValidationError("Missing part dispatcher entries: " + ", ".join(missing_dispatch))

    # These shared variables must be used by both mating parts. A low occurrence
    # count usually means somebody hard-coded one side of an interface.
    shared_interfaces = {
        "belt_clamp_pitch": 5,
        "pen_mount_x": 4,
        "pen_mount_z": 2,
        "beam_saddle_mount_dx": 4,
        "beam_saddle_mount_dy": 4,
        "servo_mount_z": 3,
    }
    for token, minimum in shared_interfaces.items():
        count = text.count(token)
        if count < minimum:
            raise ValidationError(
                f"Interface variable {token!r} occurs {count} times; expected at least {minimum}"
            )

    if "assembly_preview" in modules:
        raise ValidationError("Legacy catalogue-style assembly_preview() must not remain")

    return {
        "module_count": len(modules),
        "dispatch_count": len(dispatch),
        "modules": sorted(modules),
    }


def compile_with_openscad(executable: str, parts: list[str]) -> list[str]:
    compiled: list[str] = []
    with tempfile.TemporaryDirectory(prefix="handdraw-cad-") as tmp:
        tmpdir = Path(tmp)
        for part in parts:
            output = tmpdir / f"{part}.csg"
            command = [
                executable,
                "-o",
                str(output),
                "-D",
                f'part="{part}"',
                str(MODEL),
            ]
            process = subprocess.run(
                command,
                cwd=CAD_DIR,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=120,
            )
            if process.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
                raise ValidationError(
                    f"OpenSCAD failed for {part}:\n{process.stdout[-4000:]}"
                )
            compiled.append(part)
    return compiled


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--openscad", help="path to OpenSCAD executable")
    parser.add_argument("--render-all", action="store_true", help="compile every printable part")
    parser.add_argument("--strict", action="store_true", help="fail when OpenSCAD is unavailable")
    parser.add_argument("--report", type=Path, help="write JSON validation report")
    args = parser.parse_args()

    try:
        for path in (DIMENSIONS, MODEL):
            if not path.is_file():
                raise ValidationError(f"Missing CAD source: {path.relative_to(ROOT)}")
            check_delimiters(path, path.read_text(encoding="utf-8"))

        dimensions_text = DIMENSIONS.read_text(encoding="utf-8")
        model_text = MODEL.read_text(encoding="utf-8")
        values = parse_numeric_scalars(dimensions_text)
        engineering = engineering_report(values)
        contract = check_model_contract(model_text)

        if not engineering["x_travel_ok"] or not engineering["y_travel_ok"]:
            raise ValidationError("Configured work field exceeds calculated physical travel")
        if abs(float(engineering["steps_per_mm_at_1_16"]) - 80.0) > 1e-9:
            raise ValidationError("GT2/20T/1:16 scale is not 80 steps/mm")

        executable = args.openscad or shutil.which("openscad")
        compiled: list[str] = []
        if executable:
            parts = PRINTABLE_PARTS if args.render_all else ["assembly", "motion_envelope", "fit_coupon"]
            compiled = compile_with_openscad(executable, parts)
        elif args.strict:
            raise ValidationError("OpenSCAD executable is required in --strict mode")

        report: dict[str, object] = {
            "status": "ok",
            "static_validation": True,
            "openscad_available": bool(executable),
            "compiled_parts": compiled,
            "engineering": engineering,
            "contract": contract,
        }
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

        print("CAD static validation: OK")
        for key, value in engineering.items():
            print(f"  {key}: {value}")
        if executable:
            print(f"OpenSCAD compile: OK ({len(compiled)} target(s))")
        else:
            print("OpenSCAD compile: SKIPPED (executable not found)")
        return 0
    except (ValidationError, OSError, subprocess.SubprocessError) as exc:
        print(f"validate_cad: FAILED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
