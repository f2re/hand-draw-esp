#!/usr/bin/env python3
"""Download an official FluidNC release bundle and optionally flash an ESP32."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

API_ROOT = "https://api.github.com/repos/bdring/FluidNC/releases"
LATEST_API_URL = f"{API_ROOT}/latest"
USER_AGENT = "handdraw-esp-fluidnc-installer/2"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / ".cache" / "fluidnc"
LOCK_FILE = ROOT / "firmware" / "fluidnc" / "fluidnc-lock.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_lock(path: Path = LOCK_FILE) -> dict[str, Any]:
    try:
        lock = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot read FluidNC lock file {path}: {exc}") from exc
    if lock.get("format") != "handdraw-fluidnc-lock-v1":
        raise RuntimeError("Unsupported FluidNC lock format")
    if not str(lock.get("tag", "")).startswith("v") or not str(lock.get("release_api", "")).startswith("https://"):
        raise RuntimeError("FluidNC lock lacks a valid tag or release API URL")
    return lock


def request_json(url: str) -> dict[str, Any]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": USER_AGENT, "X-GitHub-Api-Version": "2022-11-28"}
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"GitHub API returned HTTP {exc.code}: {body[:300]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach GitHub API: {exc.reason}") from exc


def platform_profile(system: str | None = None) -> tuple[list[str], str, str, str]:
    current = (system or platform.system()).lower()
    if current.startswith("win"):
        return ["win64", "windows"], "install-wifi.bat", "erase.bat", "install-fs.bat"
    if current == "darwin":
        return ["macos", "mac", "darwin", "posix"], "install-wifi.sh", "erase.sh", "install-fs.sh"
    return ["linux", "posix"], "install-wifi.sh", "erase.sh", "install-fs.sh"


def choose_asset(release: dict[str, Any], system: str | None = None) -> dict[str, Any]:
    tokens, _, _, _ = platform_profile(system)
    assets = [asset for asset in release.get("assets", []) if str(asset.get("name", "")).lower().endswith(".zip")]
    if not assets:
        raise RuntimeError("The FluidNC release does not contain ZIP assets")

    def score(asset: dict[str, Any]) -> tuple[int, int]:
        name = str(asset.get("name", "")).lower()
        token_score = max((20 - index * 2 for index, token in enumerate(tokens) if token in name), default=0)
        generic_score = 5 if "fluidnc" in name else 0
        s3_penalty = -50 if "s3" in name else 0
        return token_score + generic_score + s3_penalty, -len(name)

    ranked = sorted(assets, key=score, reverse=True)
    if score(ranked[0])[0] <= 0:
        names = ", ".join(str(asset.get("name")) for asset in assets)
        raise RuntimeError(f"No platform-specific FluidNC bundle found. Available: {names}")
    return ranked[0]


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def find_script(root: Path, name: str) -> Path:
    matches = sorted(path for path in root.rglob(name) if path.is_file())
    if not matches:
        raise RuntimeError(f"Official installer script {name!r} was not found in {root}")
    return matches[0]


def run_official_script(script: Path) -> None:
    command = ["cmd", "/c", script.name] if script.suffix.lower() == ".bat" else ["sh", script.name]
    print("+", " ".join(command), f"(cwd={script.parent})")
    subprocess.run(command, cwd=script.parent, check=True)


def confirm(message: str) -> bool:
    try:
        answer = input(f"{message} [y/N]: ").strip().lower()
    except EOFError:
        return False
    return answer in {"y", "yes", "д", "да"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Download the pinned official FluidNC release and optionally flash MKS DLC32 V2.1")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    release_group = parser.add_mutually_exclusive_group()
    release_group.add_argument("--metadata", help="override GitHub release metadata URL")
    release_group.add_argument("--tag", help="explicit FluidNC tag, for example v4.0.3")
    release_group.add_argument("--latest", action="store_true", help="explicitly use the current upstream latest release instead of the lock")
    parser.add_argument("--bundle", type=Path, help="use an already downloaded official release ZIP")
    parser.add_argument("--list-assets", action="store_true")
    parser.add_argument("--show-lock", action="store_true")
    parser.add_argument("--flash", action="store_true")
    parser.add_argument("--erase", action="store_true")
    parser.add_argument("--install-fs", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    lock = load_lock()
    if args.show_lock:
        print(json.dumps(lock, ensure_ascii=False, indent=2))
        return 0

    cache = args.cache.expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True)
    asset: dict[str, Any] | None = None
    expected_tag: str | None = None

    if args.bundle:
        archive = args.bundle.expanduser().resolve()
        if not archive.is_file():
            raise SystemExit(f"Bundle not found: {archive}")
        tag, asset_name, asset_url = "local", archive.name, str(archive)
    else:
        if args.metadata:
            metadata_url = args.metadata
        elif args.latest:
            metadata_url = LATEST_API_URL
        elif args.tag:
            expected_tag = args.tag
            metadata_url = f"{API_ROOT}/tags/{args.tag}"
        else:
            expected_tag = str(lock["tag"])
            metadata_url = str(lock["release_api"])
        release = request_json(metadata_url)
        tag = str(release.get("tag_name") or "unknown")
        if expected_tag and tag != expected_tag:
            raise SystemExit(f"FluidNC release mismatch: requested {expected_tag}, metadata returned {tag}")
        if args.list_assets:
            print(f"Release: {tag} ({metadata_url})")
            for item in release.get("assets", []):
                digest = item.get("digest") or ""
                print(item.get("name"), digest, item.get("browser_download_url"))
            return 0
        asset = choose_asset(release)
        asset_name = str(asset["name"])
        asset_url = str(asset["browser_download_url"])
        archive = cache / asset_name
        if not archive.exists():
            print(f"Downloading FluidNC {tag}: {asset_name}")
            download(asset_url, archive)
        else:
            print(f"Using cached bundle: {archive}")

    digest = sha256(archive)
    expected = str((asset or {}).get("digest") or "")
    if expected.startswith("sha256:") and digest.lower() != expected.split(":", 1)[1].lower():
        raise SystemExit("Downloaded FluidNC bundle SHA-256 does not match GitHub release metadata")

    extract_dir = cache / f"{tag}-{archive.stem}"
    marker = extract_dir / ".handdraw-extracted.json"
    if not marker.exists():
        if extract_dir.exists():
            shutil.rmtree(extract_dir)
        extract_dir.mkdir(parents=True)
        with zipfile.ZipFile(archive) as package:
            package.extractall(extract_dir)
        marker.write_text(json.dumps({"tag": tag, "asset": asset_name, "url": asset_url, "sha256": digest}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    _, install_name, erase_name, fs_name = platform_profile()
    install_script = find_script(extract_dir, install_name)
    release_mode = "local bundle" if args.bundle else "explicit latest" if args.latest else "explicit tag" if args.tag else "locked release"
    print(
        f"FluidNC release: {tag} ({release_mode})\n"
        f"Lock: {LOCK_FILE} -> {lock['tag']}\n"
        f"Bundle: {archive}\nSHA-256: {digest}\nExtracted to: {extract_dir}"
    )

    if not args.flash and not args.erase and not args.install_fs:
        print("Preparation complete. Add --flash to run the official installer.")
        return 0

    operations: list[Path] = []
    if args.erase:
        operations.append(find_script(extract_dir, erase_name))
    if args.flash:
        operations.append(install_script)
    if args.install_fs:
        operations.append(find_script(extract_dir, fs_name))

    warning = "External 12 V, motors and MG90S must be disconnected. Destructive operations can erase controller data."
    if not args.yes and not confirm(warning + " Continue?"):
        print("Cancelled.")
        return 2
    for operation in operations:
        run_official_script(operation)
    print("FluidNC operation completed. Inspect the serial boot log before connecting motion hardware.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
