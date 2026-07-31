#!/usr/bin/env python3
"""Build and upload HandDraw ESP WebUI to the FluidNC flash filesystem."""

from __future__ import annotations

import argparse
import hashlib
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST_FILE = ROOT / "dist" / "index.html.gz"
CONFIG_FILE = ROOT / "firmware" / "fluidnc" / "config.yaml"


class FluidNCDeployer:
    def __init__(self, base_url: str, insecure: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
        self.context = ssl._create_unverified_context() if insecure else None
        self.headers = {"User-Agent": "handdraw-esp-deployer/1"}
        self.cookies = CookieJar()
        handlers: list[urllib.request.BaseHandler] = [urllib.request.HTTPCookieProcessor(self.cookies)]
        if self.context is not None:
            handlers.append(urllib.request.HTTPSHandler(context=self.context))
        self.opener = urllib.request.build_opener(*handlers)

    def request(self, path: str, method: str = "GET", data: bytes | None = None, content_type: str | None = None) -> bytes:
        headers = dict(self.headers)
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"HTTP {exc.code} for {method} {path}: {body[:300]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Cannot reach {self.base_url}: {exc.reason}") from exc

    def login(self, user: str, password: str) -> None:
        query = urllib.parse.urlencode({"USER": user, "PASSWORD": password, "SUBMIT": "yes"})
        self.request(f"/login?{query}")
        if not list(self.cookies):
            raise RuntimeError("FluidNC did not return an authentication session cookie")
        print(f"Authenticated as {user}")

    def put_and_verify(self, remote_path: str, local_path: Path, content_type: str) -> None:
        payload = local_path.read_bytes()
        self.request(remote_path, method="PUT", data=payload, content_type=content_type)
        remote = self.request(remote_path)
        if hashlib.sha256(remote).digest() != hashlib.sha256(payload).digest():
            raise RuntimeError(f"Verification failed for {remote_path}")
        print(f"Uploaded {local_path.relative_to(ROOT)} -> {remote_path} ({len(payload)} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy HandDraw ESP WebUI to FluidNC")
    parser.add_argument("host", help="controller address, e.g. 192.168.0.42 or http://fluidnc.local")
    parser.add_argument("--user", help="FluidNC HTTP user when authentication is enabled")
    parser.add_argument("--password", help="FluidNC HTTP password")
    parser.add_argument("--with-config", action="store_true", help="also upload firmware/fluidnc/config.yaml")
    parser.add_argument("--insecure", action="store_true", help="disable TLS certificate validation")
    parser.add_argument("--no-build", action="store_true", help="use existing dist/index.html.gz")
    args = parser.parse_args()

    base_url = args.host if "://" in args.host else f"http://{args.host}"
    try:
        if not args.no_build:
            subprocess.run([sys.executable, str(ROOT / "scripts" / "build_webui.py")], check=True)
        deployer = FluidNCDeployer(base_url, args.insecure)
        if args.user is not None:
            deployer.login(args.user, args.password or "")
        deployer.put_and_verify("/flash/index.html.gz", DIST_FILE, "text/html")
        if args.with_config:
            deployer.put_and_verify("/flash/config.yaml", CONFIG_FILE, "text/yaml")
            print("config.yaml uploaded. Reboot the controller and inspect the complete boot log before enabling motion.")
        print(f"Open {base_url}/ and perform a hard refresh after an update.")
    except Exception as exc:
        print(f"deploy_webui: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
