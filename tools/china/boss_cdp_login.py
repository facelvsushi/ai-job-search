#!/usr/bin/env python3
"""Read BOSS直聘 login cookies from your own browser profile via CDP.

The key trick: BOSS直聘's anti-bot detects any DevTools/CDP connection *while the
page is open* and redirects it to about:blank. So we do NOT open zhipin.com here.

Instead:
  1. You log in to https://www.zhipin.com in your normal Chrome/Edge (fully manual,
     no automation — nothing to detect).
  2. You CLOSE that browser.
  3. This script re-opens your real browser profile with only a debug port, stays
     on about:blank (so zhipin's risk JS never runs), and reads the cookies straight
     from the live cookie jar over CDP.

Reading cookies over CDP also sidesteps two other dead-ends:
  - browser_cookie3 can't decrypt modern Chrome's app-bound cookies (Chrome 127+).
  - `boss login` QR can't get __zp_stoken__ (it's written by the page's own JS).

Usage:
    1) Log in to zhipin.com in Chrome (or Edge), then CLOSE it.
    2) python boss_cdp_login.py [chrome|edge]
    3) boss status    # verify
"""

import json
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

REQUIRED_COOKIES = {"__zp_stoken__", "wt2", "wbg", "zp_at"}
CREDENTIAL_FILE = Path.home() / ".config" / "boss-cli" / "credential.json"

BROWSERS = {
    "chrome": {
        "exe": [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            str(Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe"),
        ],
        "user_data": Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data",
    },
    "edge": {
        "exe": [
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ],
        "user_data": Path.home() / "AppData" / "Local" / "Microsoft" / "Edge" / "User Data",
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

    user_data = BROWSERS[channel]["user_data"]
    if not user_data.exists():
        print(f"[!] No {channel} profile found at: {user_data}")
        print(f"    Have you opened {channel} at least once on this machine?")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[!] playwright is not installed. Run: pip install playwright")
        return 1

    print(f"[*] Reading zhipin.com cookies from your {channel} profile.")
    print("    If you have NOT logged in yet:")
    print(f"      1) Open {channel}, go to https://www.zhipin.com and log in (scan QR).")
    print(f"      2) CLOSE {channel} completely.")
    print("         (it must be closed, so this script can re-open the profile)\n")

    port = _free_port()
    args = [
        browser,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data}",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-allow-origins=*",
        "about:blank",
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not wait_for_cdp(port, timeout_s=20):
        exe = "chrome.exe" if channel == "chrome" else "msedge.exe"
        print(f"[!] Could not attach — {channel} is still running (background process).")
        print("    A closed window is not enough on Windows; quit it fully, e.g.:")
        print(f"        taskkill /F /IM {exe}")
        print("    then re-run this script.")
        proc.terminate()
        return 1

    try:
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
                print(f"[!] No zhipin.com cookies found in {channel}.")
                print("    Log in to https://www.zhipin.com in the browser first,")
                print("    close it, then re-run this script.")
                return 1

            missing = REQUIRED_COOKIES - set(cookies)
            if missing:
                print(f"[!] Login incomplete — missing cookies: {', '.join(sorted(missing))}")
                print("    Make sure you completed the login (scan QR + confirm),")
                print("    then close the browser and re-run this script.")
                return 1

            _save(cookies)
            print(f"[OK] Logged in. Saved {len(cookies)} cookies to:")
            print(f"     {CREDENTIAL_FILE}")
            print("     Verify with:  boss status")
            return 0
    except Exception as exc:
        print(f"[!] Failed: {exc}")
        return 1
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
