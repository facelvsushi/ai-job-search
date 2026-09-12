#!/usr/bin/env python3
"""Open the BOSS Zhipin login page in your installed browser, wait for you to
log in, then save the session cookies to boss-cli's credential.json.

This sidesteps two Windows pain points with the stock `boss login`:
  1. The terminal QR is half-block art that phones often can't scan.
  2. browser-cookie3 frequently can't decrypt modern Chrome's app-bound cookies.

Usage:
    python boss_browser_login.py [chrome|edge]

Requires:  pip install playwright   (drives your installed browser; no separate
browser download needed when using the chrome/edge channel).
"""

import json
import sys
import tempfile
import time
from pathlib import Path

REQUIRED_COOKIES = {"__zp_stoken__", "wt2", "wbg", "zp_at"}
LOGIN_URL = "https://www.zhipin.com/web/user/?ka=header-login"
CREDENTIAL_FILE = Path.home() / ".config" / "boss-cli" / "credential.json"
TIMEOUT_S = 300


def main() -> int:
    channel = sys.argv[1] if len(sys.argv) > 1 else "chrome"
    if channel not in ("chrome", "msedge", "edge"):
        print("[!] Unknown browser. Use: chrome | edge")
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[!] playwright is not installed. Run: pip install playwright")
        return 1

    print(f"[*] Opening the BOSS Zhipin login page in {channel} ...")
    print("    A browser window will open. Log in there:")
    print("      1) Scan the QR shown on the web page with the BOSS app, OR")
    print("         switch to password / SMS login.")
    print("      2) This script auto-detects the login and saves your cookies.")
    print(f"         (waits up to {TIMEOUT_S // 60} minutes)\n")

    with sync_playwright() as p:
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=tempfile.mkdtemp(prefix="boss-login-"),
                channel="msedge" if channel in ("msedge", "edge") else "chrome",
                headless=False,
            )
        except Exception as exc:
            print(f"[!] Could not launch {channel}: {exc}")
            print("    Try the other browser: python boss_browser_login.py edge")
            return 1

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(LOGIN_URL, wait_until="domcontentloaded")

        deadline = time.time() + TIMEOUT_S
        while time.time() < deadline:
            cookies = {
                c["name"]: c["value"]
                for c in context.cookies()
                if "zhipin.com" in (c.get("domain") or "")
            }
            missing = REQUIRED_COOKIES - set(cookies)
            if not missing:
                context.close()
                _save(cookies)
                print(f"[OK] Logged in. Saved {len(cookies)} cookies to:")
                print(f"     {CREDENTIAL_FILE}")
                print("     Next: run  boss status  to verify.")
                return 0
            time.sleep(2)

        context.close()
        print("[!] Timed out without detecting a login.")
        print("    Make sure you completed the login, then re-run this script.")
        return 1


def _save(cookies: dict) -> None:
    CREDENTIAL_FILE.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIAL_FILE.write_text(
        json.dumps({"cookies": cookies, "saved_at": time.time()},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    raise SystemExit(main())
