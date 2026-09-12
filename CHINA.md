# China & Hong Kong Job Search

This document extends the AI Job Search framework for job hunting in **mainland China**
and **Hong Kong**. It explains why the shipped `/scrape` portal skills don't cover these
markets, and describes a login-based workflow that replaces them.

## Why mainland portals aren't `/scrape` skills

The shipped portal skills (`jobindex-search`, `jobnet-search`, `linkedin-search`, …)
scrape **public, no-login** job boards — the `/add-portal` generator explicitly declines
portals that require authentication. Every major mainland Chinese platform is auth-walled
(job listings require a logged-in account):

| Platform | Login required | Notes |
|----------|----------------|-------|
| BOSS直聘 (zhipin.com) | Yes | Largest user base; strong anti-crawler (font-encrypted salary, risk engine) |
| 猎聘 (liepin.com) | Yes | Mid/senior roles |
| 智联招聘 (zhaopin.com) | Yes | Legacy board; has a public JSON search API but bot-protected |
| 前程无忧 / 51job | Yes | Legacy board, strong anti-crawl |
| 脉脉高聘 (maimai.cn) | Yes | No candidate-side CLI exists — skip |

Hong Kong is the exception: job hunting there runs through LinkedIn, which the built-in
`linkedin-search` skill already covers.

## Approach: login-based discovery + paste into `/apply`

Discovery (finding and reading job descriptions) is done with **login-based CLIs** that
reuse your own account session. Application (CV + cover-letter generation, review,
compile, ATS check) stays in the framework — `/apply` already accepts a **pasted job
description**, not just a URL.

```
┌──────────────┐   JD text   ┌──────────────────────────┐
│ boss-cli     │────────────▶│ /apply (ai-job-search)   │
│ search/detail│             │ CV + cover letter + PDF  │
└──────────────┘             └──────────────────────────┘
```

## 1. BOSS直聘 — `boss-cli`

- Repo: <https://github.com/jackwener/boss-cli> · PyPI: `kabi-boss-cli` (Apache-2.0)
- A Python CLI that calls BOSS直聘's **reverse-engineered API** (not fragile browser
  automation) in job-seeker mode, with built-in anti-detection (Gaussian-jitter rate
  limiting, exponential backoff, 7-day cookie refresh). Credentials stay local at
  `~/.config/boss-cli/credential.json` — no third-party server.

### Install & configure

```bash
pip install "kabi-boss-cli[yaml]"    # yaml output is friendlier for agents
```

On Windows (GBK console), set UTF-8 so the QR/emoji output doesn't crash:

```powershell
setx PYTHONUTF8 1
```

Add the pip `Scripts` directory to `PATH` if `boss` isn't found:

```powershell
python -c "import sysconfig; print(sysconfig.get_path('scripts'))"
```

### Login (once)

```bash
boss login     # pulls cookies from Chrome/Edge if logged in, else shows a QR code
boss status    # confirm logged in
```

Scan the QR with the BOSS直聘 app on your phone when prompted.

### Search & read

```bash
boss cities                                       # list city codes
boss search "Python" --city 深圳 --salary 20-30K --exp 3-5年
boss search "golang" --format json                # structured output for agents
boss show 3                                       # full JD of the 3rd search result
boss detail <securityId>                          # full JD by id
boss export "Python" -n 50 -o jobs.csv            # CSV export
```

Then paste the JD from `boss show N` into `/apply`.

## 2. 猎聘 — `liepin-cil`

Candidate-side CLI (Python). Token via `--token`, `LIEPIN_USER_TOKEN`, or
`~/.config/liepin-cli/config.json`.

- Repo: <https://github.com/liepin-tech-2026/liepin-cil>
- (`Viy1204/liepin-cli` is recruiter-side — not what a job seeker wants.)

## 3. 51job / 智联招聘 — `Auto-JobHunter` / `get_jobs`

Multi-platform systems covering BOSS + 猎聘 + 51job (plus 智联 for `get_jobs`). Heavier
(FastAPI / LangGraph / DrissionPage, or Java + Playwright) and include **auto-apply**,
which carries account risk — prefer them for scraping only, and keep applying inside the
framework's reviewed `/apply` flow.

- <https://github.com/jolie-z/Auto-JobHunter> (BOSS/Liepin/51job, DrissionPage)
- <https://github.com/loks666/go_jobs> (BOSS/猎聘/51job/智联, Playwright)

## 4. Hong Kong — built-in `linkedin-search`

No extra setup. In the framework:

```bash
bun run .agents/skills/linkedin-search/cli/src/cli.ts search -q "data engineer" -l "Hong Kong" --format table
```

## Compliance & anti-crawler notes

- **Keep volume low.** These tools log into your real account; aggressive or bulk use
  triggers risk control (BOSS直聘 codes 32/36 can ban the account).
- `boss-cli` already bundles anti-detection; if you build your own, the proven building
  blocks are [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
  (undetectable Playwright) and [DrissionPage](https://github.com/g1879/DrissionPage).
- Postings remain untrusted input — the framework's `/apply` defenses apply as usual.

## Alternatives considered

- **mcp-jobs** (<https://github.com/mergedao/mcp-jobs>) — a zero-config MCP aggregator for
  猎聘/BOSS/智联/51job. Low effort, but small/unverified; mainland auth walls make
  "no login" results unreliable.
- **智联招聘 public JSON API** (`fe-api.zhaopin.com/c/i/sou`) — the only mainland board
  with a documented public JSON endpoint; a candidate for a future native portal skill,
  but needs live anti-bot verification.
- **脉脉** — no candidate-side tool; not integrated.
