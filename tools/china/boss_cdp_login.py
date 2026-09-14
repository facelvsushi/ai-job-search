#!/usr/bin/env python3
"""Boss Zhipin login: log in manually in a dedicated Chrome, then read cookies.

Why this shape (after several dead-ends):

  - Launching Chrome with your REAL profile + --remote-debugging-port fails on
    Windows because Chrome's singleton mechanism hands the command off to any
    lingering background chrome.exe, which opens an about:blank window but
    IGNORES the debug port (=> "Could not attach"). So we use a FRESH temp
    profile instead — no singleton conflict, your normal Chrome stays untouched.

  - BOSS直聘's risk engine redirects the page to about:blank when a DevTools/CDP
    client is ATTACHED while the page is open. So we do NOT attach during login:
    you log in manually in the window, and only AFTER you press Enter does the
    script connect once to read the cookies (which are already in the cookie jar).

  - Reading cookies over CDP also sidesteps browser_cookie3 (blocked by Chrome's
    app-bound encryption) and `boss login` QR (which can't get __zp_stoken__).

Usage:
    python boss_cdp_login.py [chrome|edge]
"""

import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REQUIRED_COOKIES = {"__zp_stoken__", "wt2", "wbg", "zp_at"}
HOME_URL = "https://www.zhipin.com/"
CREDENTIAL_FILE = Path.home() / ".config" / "boss-cli" / "credential.json"

BROWSERS = {
    "chrome": {
        "exe": [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            str(Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe"),
        ],
    },
    "edge": {
        "exe": [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ],
    },
}


def find_browser(channel: str) -> str | None:
    for p in BROWSERS[channel]["exe"]:
        if Path(p).exists():
            return str(p)
    return shutil.which("chrome") or shutil.which("msedge")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_cdp(port: int, timeout_s: int = 30) -> bool:
    import urllib.request

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> int:
    channel = sys.argv[1] if len(sys.argv) > 1 else "chrome"
    if channel not in ("chrome", "edge"):
        print("[!] Unknown browser. Use: chrome | edge")
        return 1

    browser = find_browser(channel)
    if not browser:
        print(f"[!] Could not locate {channel} on this machine.")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[!] playwright is not installed. Run: pip install playwright")
        return 1

    port = _free_port()
    profile_dir = tempfile.mkdtemp(prefix="boss-login-")

    args = [
        browser,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-features=CalculateNativeWinOcclusion",
        "--remote-allow-origins=*",
        HOME_URL,
    ]

    print(f"[*] Opening a dedicated {channel} window (separate from your normal one).")
    print("    In that window:")
    print("      1) Click 登录 (top-right), then scan the QR with the BOSS直聘 APP.")
    print("      2) Confirm on your phone until you see your account in the page.\n")

    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not wait_for_cdp(port):
        print(f"[!] {channel} did not open its debugging port in time.")
        proc.terminate()
        return 1

    try:
        # IMPORTANT: do not attach a CDP client yet — that is what the anti-bot
        # detects. Wait for the user to finish logging in first.
        input("    When you are logged in and can see your account, press Enter here ... ")

        with sync_playwright() as p:
            browser_cdp = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            context = browser_cdp.contexts[0] if browser_cdp.contexts else browser_cdp.new_context()
            cookies = {
                c["name"]: c["value"]
                for c in context.cookies()
                if "zhipin.com" in (c.get("domain") or "")
            }
            browser_cdp.close()

        if not cookies:
            print("[!] No zhipin.com cookies found — you may not have finished logging in.")
            print("    Re-run this script and complete the login first.")
            return 1

        missing = REQUIRED_COOKIES - set(cookies)
        if missing:
            print(f"[!] Login incomplete — missing cookies: {', '.join(sorted(missing))}")
            print("    Finish the login (scan QR + confirm on phone), then re-run.")
            return 1

        _save(cookies)
        print(f"\n[OK] Logged in. Saved {len(cookies)} cookies:")
        print(f"     {', '.join(sorted(cookies))}")
        print(f"     -> {CREDENTIAL_FILE}")
        print("     Verify with:  boss status")
        return 0
    except KeyboardInterrupt:
        print("\n[!] Cancelled.")
        return 130
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


def _save(cookies: dict) -> None:
    CREDENTIAL_FILE.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIAL_FILE.write_text(
        json.dumps({"cookies": cookies, "saved_at": time.time()},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
