#!/usr/bin/env python3
"""Build the dependency-free HandDraw ESP interface into one HTML file.

FluidNC serves files from the ESP32 flash filesystem. To reduce file count and
make updates atomic, CSS, JavaScript modules and the bundled Cyrillic stroke font
are embedded into `dist/index.html`, then compressed as `dist/index.html.gz`.
No Node packages, CDN or internet connection are required.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

from materialize_sources import materialize

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web" / "src"
DIST = ROOT / "dist"
HTML_SOURCE = SRC / "index.html"
CSS_SOURCE = SRC / "styles.css"
FONT_SOURCE = SRC / "fonts" / "technical-cyrillic.json"
MODULE_SOURCES = [
    SRC / "core.js",
    SRC / "svg-import.js",
    SRC / "fluidnc.js",
    SRC / "app.js",
]


def compact_css(text: str) -> str:
    """Perform conservative, deterministic CSS whitespace compaction."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\s*([{}:;,>])\s*", r"\1", text)
    return text.strip()


def strip_module_syntax(path: Path, text: str) -> str:
    """Flatten the project's small, known ES module graph into one module.

    This is intentionally not a general JavaScript bundler. It accepts only the
    import forms used by this repository and fails if any remain afterwards.
    """
    if path.name == "app.js":
        text = re.sub(
            r"\A\s*import\s*\{.*?\}\s*from\s*['\"]\./core\.js['\"]\s*;\s*",
            "",
            text,
            count=1,
            flags=re.S,
        )
        text = re.sub(
            r"\A\s*import\s*\{.*?\}\s*from\s*['\"]\./svg-import\.js['\"]\s*;\s*",
            "",
            text,
            count=1,
            flags=re.S,
        )
        text = re.sub(
            r"\A\s*import\s*\{.*?\}\s*from\s*['\"]\./fluidnc\.js['\"]\s*;\s*",
            "",
            text,
            count=1,
            flags=re.S,
        )
    else:
        text = re.sub(r"^\s*import\s*\{.*?\}\s*from\s*['\"][^'\"]+['\"]\s*;\s*", "", text, flags=re.M | re.S)
    text = re.sub(r"^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)", "", text, flags=re.M)
    if re.search(r"(?:^|\n)\s*(?:import|export)\b", text):
        raise ValueError(f"Unsupported ES module statement remains in {path.relative_to(ROOT)}")
    return text.strip()


def compact_js(text: str) -> str:
    """Remove standalone comments and excessive blank lines without rewriting code."""
    lines: list[str] = []
    in_block = False
    for raw in text.splitlines():
        stripped = raw.strip()
        if in_block:
            if "*/" in stripped:
                in_block = False
            continue
        if stripped.startswith("/*") and not stripped.endswith("*/"):
            in_block = True
            continue
        if stripped.startswith("//") or (stripped.startswith("/*") and stripped.endswith("*/")):
            continue
        lines.append(raw.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def build(minify: bool = True) -> dict[str, object]:
    materialize()
    required = [HTML_SOURCE, CSS_SOURCE, FONT_SOURCE, *MODULE_SOURCES]
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing web sources: " + ", ".join(missing))

    html = HTML_SOURCE.read_text(encoding="utf-8")
    css = CSS_SOURCE.read_text(encoding="utf-8")
    font = json.loads(FONT_SOURCE.read_text(encoding="utf-8"))
    modules = []
    for path in MODULE_SOURCES:
        modules.append(f"// ---- {path.name} ----\n" + strip_module_syntax(path, path.read_text(encoding="utf-8")))
    js = "\n\n".join(modules)
    js = js.replace(
        "const embedded = window.HANDDRAW_EMBEDDED_FONT;\n    const font = embedded ? validateFont(embedded) : validateFont(await (await fetch('./fonts/technical-cyrillic.json')).json());",
        "const font = validateFont(window.HANDDRAW_EMBEDDED_FONT);",
    )

    if minify:
        css = compact_css(css)
        js = compact_js(js)

    stylesheet_pattern = r"\s*<link\s+rel=['\"]stylesheet['\"]\s+href=['\"]\./styles\.css['\"]\s*/?>"
    html, count = re.subn(stylesheet_pattern, lambda _: f"\n  <style>{css}</style>", html, count=1, flags=re.I)
    if count != 1:
        raise ValueError("Cannot locate the source stylesheet tag")

    scripts_pattern = (
        r"\s*<script\s+type=['\"]module['\"]\s+src=['\"]\./app\.js['\"]\s*></script>"
    )
    embedded_font = json.dumps(font, ensure_ascii=False, separators=(",", ":"))
    script = (
        "\n  <script>window.HANDDRAW_EMBEDDED_FONT=" + embedded_font + ";</script>"
        "\n  <script type=\"module\">\n" + js + "\n  </script>"
    )
    html, count = re.subn(scripts_pattern, lambda _: script, html, count=1, flags=re.I)
    if count != 1:
        raise ValueError("Cannot locate the source module entry tag")

    runtime_dependency_patterns = [
        r"<script[^>]+src=",
        r"<link[^>]+rel=['\"](?:stylesheet|preload|modulepreload)['\"]",
        r"fetch\(['\"]\./fonts/",
    ]
    for pattern in runtime_dependency_patterns:
        if re.search(pattern, html, flags=re.I):
            raise ValueError(f"Built page still contains a runtime dependency: {pattern}")

    DIST.mkdir(parents=True, exist_ok=True)
    html_path = DIST / "index.html"
    gzip_path = DIST / "index.html.gz"
    manifest_path = DIST / "manifest.json"

    payload = html.encode("utf-8")
    html_path.write_bytes(payload)
    with gzip_path.open("wb") as fileobj:
        with gzip.GzipFile(filename="index.html", mode="wb", fileobj=fileobj, mtime=0, compresslevel=9) as archive:
            archive.write(payload)

    manifest: dict[str, object] = {
        "name": "HandDraw ESP WebUI",
        "format": 1,
        "entry": "index.html.gz",
        "sourceBytes": len(payload),
        "gzipBytes": gzip_path.stat().st_size,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "gzipSha256": hashlib.sha256(gzip_path.read_bytes()).hexdigest(),
        "modules": [str(path.relative_to(ROOT)) for path in MODULE_SOURCES],
        "font": str(FONT_SOURCE.relative_to(ROOT)),
        "offline": True,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def check() -> dict[str, object]:
    before_html = (DIST / "index.html").read_bytes() if (DIST / "index.html").exists() else None
    before_gzip = (DIST / "index.html.gz").read_bytes() if (DIST / "index.html.gz").exists() else None
    manifest = build(minify=True)
    if before_html is not None and before_html != (DIST / "index.html").read_bytes():
        raise RuntimeError("dist/index.html is stale; run scripts/build_webui.py")
    if before_gzip is not None and before_gzip != (DIST / "index.html.gz").read_bytes():
        raise RuntimeError("dist/index.html.gz is stale; run scripts/build_webui.py")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the HandDraw ESP WebUI")
    parser.add_argument("--no-minify", action="store_true", help="preserve source whitespace")
    parser.add_argument("--check", action="store_true", help="verify committed build output")
    args = parser.parse_args()
    try:
        manifest = check() if args.check else build(minify=not args.no_minify)
    except Exception as exc:
        print(f"build_webui: {exc}", file=sys.stderr)
        return 1
    source_size = int(manifest["sourceBytes"])
    gzip_size = int(manifest["gzipBytes"])
    print(
        f"WebUI built: {source_size} -> {gzip_size} bytes "
        f"({gzip_size / max(source_size, 1) * 100:.1f}%), "
        f"sha256={str(manifest['gzipSha256'])[:16]}…"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
