#!/usr/bin/env python3
"""Run an offline Chromium smoke test against the bundled HandDraw WebUI."""

from __future__ import annotations

import argparse
import binascii
import os
import shutil
import struct
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist/index.html"
DEFAULT_SCREENSHOT = ROOT / "dist/browser-smoke.png"

LOCAL_STORAGE_POLYFILL = r"""<script>
(() => {
  const data = new Map();
  const storage = {
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); }, clear() { data.clear(); },
    key(index) { return [...data.keys()][index] ?? null; }, get length() { return data.size; }
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
})();
</script>"""


def embedded_page() -> str:
    html = DIST.read_text(encoding="utf-8")
    marker = "<script>window.HANDDRAW_EMBEDDED_FONT="
    if marker not in html:
        raise RuntimeError("built WebUI does not contain the embedded font marker")
    return html.replace(marker, LOCAL_STORAGE_POLYFILL + marker, 1)


def browser_path(explicit: str | None) -> str | None:
    return explicit or os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("google-chrome")


def make_test_png(path: Path, width: int = 40, height: int = 30) -> None:
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            value = 24 if 7 <= x <= 32 and 6 <= y <= 23 else 255
            row.extend((value, value, value, 255))
        rows.append(bytes(row))
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), level=9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def run(output: Path | None, executable: str | None) -> dict[str, object]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError("Playwright is not installed; run: python -m pip install playwright") from exc
    errors: list[str] = []
    with sync_playwright() as playwright:
        launch_options: dict[str, object] = {"headless": True, "args": ["--disable-gpu", "--no-sandbox"]}
        if executable: launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        page = browser.new_page(viewport={"width": 1440, "height": 1400}, device_scale_factor=1)
        page.on("console", lambda message: errors.append(f"console:{message.type}:{message.text}") if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(f"pageerror:{error}"))
        page.set_content(embedded_page(), wait_until="load")
        page.wait_for_function("document.querySelectorAll('#drawingLayer path').length > 0")
        page.fill("#textInput", "ПРОВЕРКА 2026\nабвгд"); page.fill("#fontSize", "9"); page.fill("#letterSpacing", "0.6"); page.fill("#lowercaseScale", "65"); page.click("#generateButton"); page.wait_for_timeout(200)
        text_paths = page.locator("#drawingLayer path").count()
        if text_paths <= 10: raise AssertionError(f"unexpectedly short text layout: {text_paths} paths")
        if "пределах" not in page.locator("#validationMessage").inner_text().lower(): raise AssertionError("text layout did not pass page-bound validation")
        start_x = page.locator("#previewCursor").get_attribute("cx"); page.click("#simulateButton"); page.wait_for_function("!document.querySelector('#previewCursor').hasAttribute('hidden')"); page.wait_for_timeout(500)
        if page.locator("#previewCursor").get_attribute("cx") == start_x: raise AssertionError("preview simulation cursor did not move")
        page.click("#resetSimulationButton")
        page.click('[data-source="svg"]'); page.set_input_files("#svgFile", str(ROOT / "examples/simple_drawing.svg")); page.wait_for_timeout(350); page.click("#generateButton"); page.wait_for_timeout(200)
        svg_paths = page.locator("#drawingLayer path").count()
        if svg_paths <= 0: raise AssertionError("SVG import produced no paths")
        with tempfile.TemporaryDirectory(prefix="handdraw-browser-") as directory:
            image_path = Path(directory) / "sample.png"; make_test_png(image_path); page.click('[data-source="image"]'); page.set_input_files("#imageFile", str(image_path)); page.wait_for_timeout(350); page.click("#generateButton"); page.wait_for_timeout(200); image_paths = page.locator("#drawingLayer path").count()
            if image_paths <= 0: raise AssertionError("raster import produced no paths")
        page.click('[data-panel="font"]'); page.fill("#fontName", "Проверочный почерк"); page.fill("#fontAuthor", "Тестовый автор"); page.fill("#fontLicense", "CC BY 4.0"); page.fill("#glyphCharacter", "Я")
        board = page.locator("#glyphBoard"); box = board.bounding_box()
        if not box: raise AssertionError("font drawing board is not visible")
        page.mouse.move(box["x"] + 42, box["y"] + 205); page.mouse.down()
        for x, y in ((70,160),(95,110),(130,65),(170,110),(205,205)): page.mouse.move(box["x"] + x, box["y"] + y, steps=3)
        page.mouse.up(); page.click("#glyphSave"); page.click("#fontUse"); page.wait_for_timeout(200)
        if "Проверочный почерк" not in page.locator("#fontSelect").inner_text(): raise AssertionError("custom font was not installed")
        if output: output.parent.mkdir(parents=True, exist_ok=True); page.screenshot(path=str(output), full_page=True)
        mobile = browser.new_page(viewport={"width":390,"height":844}, device_scale_factor=1); mobile.set_content(embedded_page(), wait_until="load"); mobile.wait_for_function("document.querySelectorAll('#drawingLayer path').length > 0")
        dimensions = mobile.evaluate("({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})")
        if dimensions["scroll"] > dimensions["client"] + 1: raise AssertionError(f"mobile layout has horizontal overflow: {dimensions}")
        browser.close()
    if errors: raise AssertionError("\n".join(errors))
    return {"text_paths": text_paths, "svg_paths": svg_paths, "image_paths": image_paths, "validation": "ok"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--browser"); parser.add_argument("--no-screenshot", action="store_true"); parser.add_argument("--screenshot", type=Path, default=DEFAULT_SCREENSHOT); args = parser.parse_args()
    try: result = run(None if args.no_screenshot else args.screenshot, browser_path(args.browser))
    except Exception as exc: print(f"browser_smoke: {exc}", file=sys.stderr); return 1
    print("Browser smoke passed:", result); return 0


if __name__ == "__main__":
    raise SystemExit(main())
