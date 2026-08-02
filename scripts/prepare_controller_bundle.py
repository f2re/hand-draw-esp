#!/usr/bin/env python3
"""Build a self-contained set of files required to commission the ESP32 controller."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RELEASE_ROOT = ROOT / "release"
BUNDLE = RELEASE_ROOT / "handdraw-controller"
ZIP_PATH = RELEASE_ROOT / "handdraw-controller.zip"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_webui.py")], cwd=ROOT, check=True)
    if BUNDLE.exists():
        shutil.rmtree(BUNDLE)
    BUNDLE.mkdir(parents=True)
    (BUNDLE / "gcode").mkdir()

    files = {
        ROOT / "firmware" / "fluidnc" / "config.yaml": BUNDLE / "config.yaml",
        ROOT / "firmware" / "fluidnc" / "config-production.yaml": BUNDLE / "config-production.yaml",
        ROOT / "firmware" / "fluidnc" / "fluidnc-lock.json": BUNDLE / "fluidnc-lock.json",
        ROOT / "dist" / "index.html.gz": BUNDLE / "index.html.gz",
    }
    for source, target in files.items():
        shutil.copy2(source, target)
    for source in sorted((ROOT / "gcode").glob("*.gcode")):
        shutil.copy2(source, BUNDLE / "gcode" / source.name)

    install_text = """HandDraw ESP — комплект контроллера

1. Установите официальный Wi-Fi release FluidNC.
2. Для наладки загрузите config.yaml в /flash/config.yaml.
3. После проверки направлений, NC-концевиков и нескольких циклов homing используйте config-production.yaml.
4. Загрузите index.html.gz в /flash/index.html.gz.
5. Перезагрузите плату и проверьте полный журнал запуска.
6. Создайте /jobs на SD-карте и при необходимости скопируйте тестовые файлы из gcode/.
7. Первый запуск выполняйте без ручки и на малой скорости.

Подробная инструкция: firmware/fluidnc/INSTALL.md в исходном репозитории.
"""
    (BUNDLE / "INSTALL.txt").write_text(install_text, encoding="utf-8")

    manifest_files = {}
    for path in sorted(BUNDLE.rglob("*")):
        if path.is_file():
            rel = path.relative_to(BUNDLE).as_posix()
            manifest_files[rel] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
    manifest = {"format": "handdraw-controller-bundle-v1", "board": "MKS-DLC32 V2.1", "files": manifest_files}
    (BUNDLE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(BUNDLE.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(RELEASE_ROOT))
    print(f"Controller bundle: {BUNDLE}\nArchive: {ZIP_PATH} ({ZIP_PATH.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
