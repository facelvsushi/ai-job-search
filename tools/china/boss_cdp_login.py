#!/usr/bin/env python3
"""Boss Zhipin login via a real Chrome/Edge opened with a remote-debugging port.

Why this works where the other two approaches failed:

  1. Plain Playwright (boss_browser_login.py) is DETECTED by BOSS直聘's anti-bot:
     Playwright launches the browser with automation flags (navigator.webdriver,
     --enable-automation), so the login page goes blank / ERR_NETWORK_CHANGED.

  2. `boss login` QR (pure HTTP) CANNOT get __zp_stoken__: that cookie is written
     by the page's own JavaScript after login, not sent by the server, so the
     pure-HTTP flow always ends "缺少关键 Cookie: __zp_stoken__".

  3. This script launches a NORMAL browser (only a debug port is opened — no
     automation flags), you log in there (scan the web QR), and we then read the
     cookies straight from the running browser over the Chrome DevTools Protocol.
     This captures __zp_stoken__ and also sidesteps browser_cookie3's inability to
     decrypt modern Chrome's app-bound cookies.

Usage:
    python boss_cdp_login.py [chrome|edge]
"""

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

REQUIRED_COOKIES = {"__zp_stoken__", "wt2", "wbg", "zp_at"}
LOGIN_URL = "https://www.zhipin.com/web/user/?ka=header-login"
CREDENTIAL_FILE = Path.home() / ".config" / "boss-cli" / "credential.json"
PROFILE_DIR = Path.home() / ".config" / "boss-cli" / "browser-profile"
PORT = 9222
TIMEOUT_S = 300

BROWSER_PATHS = {
    "chrome": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe",
    ],
    "edge": [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
}


def find_browser(channel: str) -> str | None:
    for p in BROWSER_PATHS.get(channel, []):
        if Path(p).exists():
            return str(p)
    return shutil.which("chrome") or shutil.which("msedge")


def wait_for_cdp(timeout_s: int = 30) -> bool:
    import urllib.request

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=1)
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

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    args = [
        browser,
        f"--remote-debugging-port={PORT}",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-allow-origins=*",
        LOGIN_URL,
    ]

    print(f"[*] Launching {channel} (a NORMAL browser window will open) ...")
    print("    1) In that window, scan the QR with the BOSS直聘 APP, or")
    print("       switch to password / SMS login.")
    print("    2) Keep the window OPEN. This script reads your cookies from it.\n")

    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    if not wait_for_cdp():
        print("[!] Browser did not open its debugging port in time.")
        proc.terminate()
        return 1

    try:
        with sync_playwright() as p:
            browser_cdp = p.chromium.connect_over_cdp(f"http://127.0.0.1:{PORT}")
            context = browser_cdp.contexts[0] if browser_cdp.contexts else browser_cdp.new_context()
            # The browser may have opened the login URL already, or an about:blank tab.
            page = None
            for candidate in context.pages:
                if "zhipin.com" in (candidate.url or ""):
                    page = candidate
                    break
            if page is None:
                page = context.pages[0] if context.pages else context.new_page()
                try:
                    page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
                except Exception:
                    pass  # the page may already be navigating; we poll below anyway

            deadline = time.time() + TIMEOUT_S
            while time.time() < deadline:
                try:
                    cookies = {
                        c["name"]: c["value"]
                        for c in context.cookies()
                        if "zhipin.com" in (c.get("domain") or "")
                    }
                except Exception:
                    cookies = {}
                missing = REQUIRED_COOKIES - set(cookies)
                if not missing:
                    _save(cookies)
                    print(f"[OK] Logged in. Saved {len(cookies)} cookies to:")
                    print(f"     {CREDENTIAL_FILE}")
                    print("     Verify with:  boss status")
                    return 0
                time.sleep(2)

            print("[!] Timed out without detecting a login.")
            print("    Make sure you completed the login in the browser window,")
            print("    then re-run this script.")
            return 1
    finally:
        # Detach but leave the browser window open for the user to close.
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
