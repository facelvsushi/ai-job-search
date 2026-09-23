# -*- coding: utf-8 -*-
"""JD campus portal browser driver.

Pattern (same as the boss CDP scripts): we launch a headed Chromium with a
fresh profile and a CDP debug port; the USER logs in manually in that window;
then separate invocations attach over CDP to read pages / run JS (fill forms).

Usage:
  python tools/china/jd_browser.py open          # launch browser, keep alive 45 min (run in background)
  python tools/china/jd_browser.py read          # dump url/title/text of every open page as JSON
  python tools/china/jd_browser.py eval "<js>"   # run JS on the most recently active page, print result
  python tools/china/jd_browser.py pages         # list open pages (index, url, title)
"""
import json
import os
import sys
import tempfile
import time

CDP_PORT = 9333
PROFILE = os.path.join(tempfile.gettempdir(), "jd_campus_profile")
START_URL = "https://campus.jd.com/"


def cmd_open():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        ctx = None
        last_err = None
        # Prefer the user's installed browsers - no Playwright download needed.
        for channel in ("chrome", "msedge"):
            try:
                ctx = p.chromium.launch_persistent_context(
                    PROFILE,
                    headless=False,
                    args=[f"--remote-debugging-port={CDP_PORT}"],
                    viewport={"width": 1280, "height": 900},
                    channel=channel,
                )
                print(f"LAUNCHED channel={channel}", flush=True)
                break
            except Exception as e:
                last_err = e
        if ctx is None:
            raise last_err or RuntimeError("no system browser found")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(START_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print("goto warning:", e, flush=True)
        print("BROWSER_OPEN - please log in, then tell Claude", flush=True)
        deadline = time.time() + 45 * 60
        while time.time() < deadline:
            try:
                if not ctx.pages:
                    break
                time.sleep(2)
            except Exception:
                break
        print("BROWSER_CLOSED", flush=True)


def _connect():
    from playwright.sync_api import sync_playwright
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp(f"http://localhost:{CDP_PORT}")
    return pw, browser


def cmd_read():
    pw, browser = _connect()
    try:
        out = []
        for ci, ctx in enumerate(browser.contexts):
            for pi, page in enumerate(ctx.pages):
                try:
                    rec = {
                        "index": pi,
                        "url": page.url,
                        "title": page.title(),
                        "text": page.evaluate(
                            "() => document.body ? document.body.innerText : ''"
                        )[:30000],
                    }
                except Exception as e:
                    rec = {"index": pi, "error": str(e)}
                out.append(rec)
        print(json.dumps(out, ensure_ascii=False, indent=1))
    finally:
        browser.close()
        pw.stop()


def cmd_pages():
    pw, browser = _connect()
    try:
        for ci, ctx in enumerate(browser.contexts):
            for pi, page in enumerate(ctx.pages):
                try:
                    print(f"[{pi}] {page.title()} :: {page.url}")
                except Exception as e:
                    print(f"[{pi}] <error: {e}>")
    finally:
        browser.close()
        pw.stop()


def cmd_eval(js: str):
    pw, browser = _connect()
    try:
        page = browser.contexts[-1].pages[-1]
        result = page.evaluate(js)
        print(json.dumps(result, ensure_ascii=False, default=str))
    finally:
        browser.close()
        pw.stop()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if cmd == "open":
            cmd_open()
        elif cmd == "read":
            cmd_read()
        elif cmd == "pages":
            cmd_pages()
        elif cmd == "eval" and len(sys.argv) > 2:
            cmd_eval(sys.argv[2])
        else:
            print(__doc__)
    except Exception as e:
        print("ERROR:", type(e).__name__, str(e), file=sys.stderr)
        sys.exit(1)
