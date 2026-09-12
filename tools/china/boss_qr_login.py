#!/usr/bin/env python3
"""Boss Zhipin login via a real PNG QR image (scannable by phone).

Unlike the Playwright browser script (which BOSS直聘's anti-bot detects and blocks
with a blank page / ERR_NETWORK_CHANGED), this reuses boss-cli's own HTTP login
flow. There is NO browser at all, so there is nothing for the anti-bot to detect.

The only change vs `boss login` is that the QR code is rendered as a crisp PNG
image file and opened in your default image viewer, instead of unreadable
half-block art in the terminal.

Usage:
    python boss_qr_login.py

Requires:  pip install "kabi-boss-cli[yaml]"   (pulls in qrcode + httpx)
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path


def _render_qr_png(data: str) -> str:
    """Render *data* as a QR PNG image and return its path."""
    import qrcode

    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    path = Path(tempfile.gettempdir()) / "boss-login-qr.png"
    img.save(str(path))
    return str(path)


def _open_image(path: str) -> None:
    """Open the QR image in the default viewer (Windows / macOS / Linux)."""
    try:
        if sys.platform == "win32":
            os.startfile(path)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            os.system(f'open "{path}"')
        else:
            os.system(f'xdg-open "{path}" &')
    except Exception:
        print(f"    (couldn't auto-open the image — open it manually: {path})")


async def _flow() -> int:
    import httpx
    from boss_cli.auth import (
        _dispatch_login,
        _get_qr_session,
        _wait_for_confirm,
        _wait_for_scan,
        save_credential,
    )
    from boss_cli.constants import BASE_URL, CREDENTIAL_FILE, HEADERS

    async with httpx.AsyncClient(
        base_url=BASE_URL,
        headers=HEADERS,
        follow_redirects=True,
        timeout=httpx.Timeout(30, read=40),
    ) as client:
        # Step 1: obtain a QR session id from the server
        session = await _get_qr_session(client)
        qr_id = session["qrId"]

        # Step 2: render the QR as a PNG and open it
        png = _render_qr_png(qr_id)
        print(f"[*] QR code image: {png}")
        _open_image(png)
        print()
        print("    1) Open the QR image and scan it with the BOSS直聘 APP.")
        print("    2) Confirm the login on your phone.")
        print("       (the QR expires in a few minutes)\n")

        # Step 3: long-poll until scanned
        scanned = False
        for _ in range(6):
            scanned = await _wait_for_scan(client, qr_id)
            if scanned:
                print("  [*] Scanned — confirm on your phone ...")
                break
        if not scanned:
            print("[!] QR expired before it was scanned. Re-run this script.")
            return 1

        # Step 4: long-poll until confirmed
        confirmed = False
        for _ in range(6):
            confirmed = await _wait_for_confirm(client, qr_id)
            if confirmed:
                break
        if not confirmed:
            print("[!] Login confirmation timed out. Re-run this script.")
            return 1

        # Step 5: exchange the confirmed QR for real session cookies
        credential = await _dispatch_login(client, qr_id)
        save_credential(credential)

        print(f"\n[OK] Logged in. Credentials saved to {CREDENTIAL_FILE}")
        print("     Verify with:  boss status")
        return 0


def main() -> int:
    try:
        import boss_cli.auth  # noqa: F401  (import check)
    except ImportError:
        print("[!] boss-cli is not installed.")
        print('    Run: pip install "kabi-boss-cli[yaml]"')
        return 1

    print("[*] Boss Zhipin QR login (real PNG image, no browser) ...\n")
    try:
        return asyncio.run(_flow())
    except KeyboardInterrupt:
        print("\n[!] Cancelled.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
