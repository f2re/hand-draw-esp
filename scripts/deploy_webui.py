#!/usr/bin/env python3
"""Build, back up and atomically deploy HandDraw ESP files to FluidNC."""

from __future__ import annotations

import argparse
import hashlib
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST_FILE = ROOT / "dist" / "index.html.gz"
CONFIG_FILES = {
    "commissioning": ROOT / "firmware" / "fluidnc" / "config.yaml",
    "production": ROOT / "firmware" / "fluidnc" / "config-production.yaml",
}


class FluidNCDeployer:
    def __init__(self, base_url: str, insecure: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
        self.context = ssl._create_unverified_context() if insecure else None
        self.headers = {"User-Agent": "handdraw-esp-deployer/2"}
        self.cookies = CookieJar()
        handlers: list[urllib.request.BaseHandler] = [urllib.request.HTTPCookieProcessor(self.cookies)]
        if self.context is not None:
            handlers.append(urllib.request.HTTPSHandler(context=self.context))
        self.opener = urllib.request.build_opener(*handlers)

    def request(
        self,
        path: str,
        method: str = "GET",
        data: bytes | None = None,
        content_type: str | None = None,
        headers: dict[str, str] | None = None,
        accepted_statuses: set[int] | None = None,
    ) -> tuple[int, bytes]:
        request_headers = dict(self.headers)
        request_headers.update(headers or {})
        if content_type:
            request_headers["Content-Type"] = content_type
        request = urllib.request.Request(self.base_url + path, data=data, headers=request_headers, method=method)
        try:
            with self.opener.open(request, timeout=45) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            body = exc.read()
            if accepted_statuses and exc.code in accepted_statuses:
                return exc.code, body
            message = body.decode("utf-8", "replace")
            raise RuntimeError(f"HTTP {exc.code} for {method} {path}: {message[:300]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Cannot reach {self.base_url}: {exc.reason}") from exc

    def login(self, user: str, password: str) -> None:
        query = urllib.parse.urlencode({"USER": user, "PASSWORD": password, "SUBMIT": "yes"})
        self.request(f"/login?{query}")
        if not list(self.cookies):
            raise RuntimeError("FluidNC did not return an authentication session cookie")
        print(f"Authenticated as {user}")

    def read_optional(self, remote_path: str) -> bytes | None:
        status, payload = self.request(
            f"{remote_path}?backup={datetime.now(timezone.utc).timestamp()}",
            accepted_statuses={404},
        )
        return None if status == 404 else payload

    def verify_remote(self, remote_path: str, expected: bytes) -> None:
        _, remote = self.request(f"{remote_path}?verify={datetime.now(timezone.utc).timestamp()}")
        if hashlib.sha256(remote).digest() != hashlib.sha256(expected).digest():
            raise RuntimeError(f"Verification failed for {remote_path}: remote content differs")

    def put_raw(self, remote_path: str, payload: bytes, content_type: str) -> None:
        self.request(remote_path, method="PUT", data=payload, content_type=content_type)

    def delete_optional(self, remote_path: str) -> None:
        self.request(remote_path, method="DELETE", accepted_statuses={404, 405})

    def move(self, source_path: str, target_path: str) -> bool:
        destination = urllib.parse.urljoin(self.base_url + "/", target_path.lstrip("/"))
        status, _ = self.request(
            source_path,
            method="MOVE",
            headers={"Destination": destination, "Overwrite": "T"},
            accepted_statuses={400, 404, 405, 409, 412, 501},
        )
        return status not in {400, 404, 405, 409, 412, 501}

    def backup_remote(self, remote_path: str, backup_dir: Path) -> bytes | None:
        payload = self.read_optional(remote_path)
        if payload is None:
            return None
        backup_dir.mkdir(parents=True, exist_ok=True)
        target = backup_dir / remote_path.strip("/").replace("/", "__")
        target.write_bytes(payload)
        print(f"Backup {remote_path} -> {target.relative_to(ROOT)} ({len(payload)} bytes)")
        return payload

    def atomic_put_and_verify(
        self,
        remote_path: str,
        local_path: Path,
        content_type: str,
        backup_dir: Path,
    ) -> None:
        payload = local_path.read_bytes()
        previous = self.backup_remote(remote_path, backup_dir)
        suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        temporary_path = f"{remote_path}.part-{suffix}"
        moved = False
        try:
            self.put_raw(temporary_path, payload, content_type)
            self.verify_remote(temporary_path, payload)
            moved = self.move(temporary_path, remote_path)
            if not moved:
                self.put_raw(remote_path, payload, content_type)
            self.verify_remote(remote_path, payload)
        except Exception:
            if previous is not None:
                try:
                    self.put_raw(remote_path, previous, content_type)
                    self.verify_remote(remote_path, previous)
                    print(f"Rollback restored {remote_path}", file=sys.stderr)
                except Exception as rollback_error:
                    print(f"Rollback failed for {remote_path}: {rollback_error}", file=sys.stderr)
            raise
        finally:
            if not moved:
                try:
                    self.delete_optional(temporary_path)
                except Exception:
                    pass
        mode = "MOVE" if moved else "verified fallback PUT"
        print(f"Uploaded {local_path.relative_to(ROOT)} -> {remote_path} ({len(payload)} bytes, {mode})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy HandDraw ESP WebUI to FluidNC with backup and rollback")
    parser.add_argument("host", help="controller address, e.g. 192.168.0.42 or http://fluidnc.local")
    parser.add_argument("--user", help="FluidNC HTTP user when authentication is enabled")
    parser.add_argument("--password", help="FluidNC HTTP password")
    parser.add_argument("--with-config", action="store_true", help="also upload the selected FluidNC configuration")
    parser.add_argument(
        "--config-profile",
        choices=sorted(CONFIG_FILES),
        default="commissioning",
        help="configuration uploaded by --with-config",
    )
    parser.add_argument("--insecure", action="store_true", help="disable TLS certificate validation")
    parser.add_argument("--no-build", action="store_true", help="use existing dist/index.html.gz")
    parser.add_argument("--backup-dir", type=Path, help="local directory for controller backups")
    args = parser.parse_args()

    base_url = args.host if "://" in args.host else f"http://{args.host}"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = (args.backup_dir or ROOT / "backups" / stamp).expanduser().resolve()
    config_file = CONFIG_FILES[args.config_profile]

    try:
        if not args.no_build:
            subprocess.run([sys.executable, str(ROOT / "scripts" / "build_webui.py")], check=True)
        deployer = FluidNCDeployer(base_url, args.insecure)
        if args.user is not None:
            deployer.login(args.user, args.password or "")
        deployer.atomic_put_and_verify("/flash/index.html.gz", DIST_FILE, "application/gzip", backup_dir)
        if args.with_config:
            deployer.atomic_put_and_verify("/flash/config.yaml", config_file, "text/yaml", backup_dir)
            print(f"Configuration profile: {args.config_profile}. Reboot and inspect the complete boot log before motion.")
        print(f"Open {base_url}/ and perform a hard refresh after an update.")
        print(f"Backups: {backup_dir}")
    except Exception as exc:
        print(f"deploy_webui: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
