---
name: gba-hk-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to find jobs in the Greater Bay Area
  (GBA) of mainland China that are open to Hong Kong/Macau residents — 大湾区岗位、
  港澳青年招聘、大湾区青年就业计划职位、前海/南沙/横琴港澳青年专项、香港人内地工作.
  Sources: the HK Labour Department's GBA Youth Employment Scheme vacancy
  database (jobs.gov.hk) plus WeChat 公众号 recruitment articles exported into
  job_scraper/wechat_inbox/. Trigger phrases: GBA jobs for Hong Kong residents,
  大湾区 招聘, 港澳青年 岗位, 大湾区青年就业计划 职位空缺, 前海 香港人 招聘, search GBA
  vacancies, GBA deadline.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/gba-hk-search/cli/src/cli.ts *)
---

# GBA HK Search Skill

Job listings open to **Hong Kong residents in Greater Bay Area mainland cities**
(广州、深圳、珠海、佛山、惠州、东莞、中山、江门、肇庆). Two merged sources:

| Tier | Source | What it covers | Deadline data |
|---|---|---|---|
| A | HK Labour Dept 「大湾区青年就业计划」vacancy database (jobs.gov.hk) | Every employer posting under the HK government scheme — employed by the HK entity, HK labour law | **None** — the official source has no closing-date field |
| B | WeChat 公众号 articles you export into `job_scraper/wechat_inbox/` | 前海/南沙/横琴专项、政务号专场、企业直招 — anything a 公众号 publishes (these programs have **no public listing pages**) | Extracted from article text (截止/报名止/date patterns), normalized to ISO |

## ⚠️ Personal use only

jobs.gov.hk's robots.txt disallows the search/jobCard paths. No login is involved,
but automated access sits in a grey zone: **keep volume low** (one run ≈ 1 listing
page + at most `--limit` detail fetches), never crawl, never use commercially.
Run it on your own responsibility.

## Commands

### Report — the browsable job board (start here)

```bash
bun run .agents/skills/gba-hk-search/cli/src/cli.ts report [--pages 3] [--open] [--out <file>]
```

Scans the official GBAE listing (`--pages`, default 3 = ~60 jobs), hydrates
company/date, merges the WeChat inbox, and writes a **self-contained HTML page
where every job title links to its official detail page** — plus a keyword
filter box. `--open` launches it in the default browser. Default output:
`documents/gba-jobs-<date>.html`. This is the human-facing entry point: the
user double-clicks the Desktop launcher (`大湾区岗位.bat`) instead of running
CLI commands.

### Search (official database + inbox merge)

```bash
bun run .agents/skills/gba-hk-search/cli/src/cli.ts search [flags]
```

- `--query, -q <text>` — client-side filter on title/company/location (the
  portal's own keyword search is a POST form; we filter fetched pages instead —
  combine with `--pages` for wider coverage)
- `--lang <tc|cn|en>` — listing language, default `tc`
- `--page <n>` / `--pages <n>` — start page / pages to scan (20 results/page)
- `--limit, -n <n>` — cap results; also caps detail-hydration requests
- `--no-hydrate` — skip per-job detail fetches (company/date stay null; faster,
  but /scrape's health check prefers hydrated results)
- `--no-wechat` — skip the inbox merge
- `--format json|table|plain` — default `json`

The listing page carries no company or date, so `search` fetches each jobCard
detail page (bounded by `--limit`) to fill `company` + `date` before returning.

### Detail

```bash
bun run .agents/skills/gba-hk-search/cli/src/cli.ts detail "<jobCard-url>" --format plain
```

Pass the **full jobCard URL** from search results — it carries a one-time order
token that cannot be rebuilt from the id. A bare ordno (`11-26-0011957`) triggers
a bounded listing re-scan (`--pages`, default 3) to find a fresh token. Returns
职责/要求/申请方式 (`#openupRemark`) and the scheme's eligibility note (`#propRemark`).

### Ingest WeChat exports

Two ways in — file mode and URL mode:

```bash
bun run .agents/skills/gba-hk-search/cli/src/cli.ts ingest [--dry-run] [--format table]   # file mode
bun run .agents/skills/gba-hk-search/cli/src/cli.ts ingest --urls [--format table]        # URL mode
```

**File mode**: parses every `.md`/`.html` article in `job_scraper/wechat_inbox/`,
applies the eligibility gate from [watchlist.md](watchlist.md), extracts postings
+ deadlines, and moves parsed inbox-root files into `processed/`.

**URL mode** (the breakage-proof default — export tools keep dying to WeChat API
changes, article pages stay publicly readable): paste article links into
`job_scraper/wechat_inbox/urls.txt` (one per line, `#` comments), run
`ingest --urls`. Each page is fetched anonymously, archived to `processed/`
(so `search` keeps merging it), extracted, and the URL moves to `urls_done.txt`.
Failed fetches stay in the list for retry.

### Watch gov recruitment pages

```bash
bun run .agents/skills/gba-hk-search/cli/src/cli.ts watch [--all] [--format table]
```

Polls the pages listed in [watchlist.md](watchlist.md) (`- 名称 | URL` lines),
extracts links carrying recruitment keywords (site-agnostic — no per-site
anchors), and diffs against `job_scraper/watch_state.json`. First run seeds the
state (everything reports as new); later runs report only additions. `--all`
re-lists every seen item without touching state.

> Gov sites reject proxy exits. If fetches fail on a proxied machine, set
> `NO_PROXY="*.gov.cn"` first (PowerShell: `$env:NO_PROXY="*.gov.cn"`).

## WeChat runbook (Tier B)

**Primary — URL feeding (unbreakable):**
1. Follow the watchlist accounts in WeChat (深圳人社、广东人社、前海控股、香港工联会…).
2. A recruitment push arrives → copy its link → paste into `job_scraper/wechat_inbox/urls.txt`.
3. Run `ingest --urls`.

**Optional — bulk history export:** [wechatDownload](https://github.com/qiye45/wechatDownload)
(desktop) or [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter)
(online, needs a free personal 公众号 login; **broke 2026-09** when WeChat changed
its backend search API) export `.md`/`.html` files — drop them in the inbox for
file mode. Any tool's output feeds the same pipeline; when a tool dies, switch
to URL feeding and nothing else changes.

## Output

`{ meta: { count, page, pages, sources: { gbayes, wechat }, wechat_articles, wechat_skipped_no_gate }, results: [...] }`
— each result: `id, title, company, location, date, deadline, url, source`
(`gbayes` | `wechat:<公众号>`), plus `salary` for gbayes hits. Missing values are
`null`, never omitted. Errors go to stderr as `{ error, code }`, exit 1.

## Notes

- The official source has **no deadline field** — every gbayes result returns
  `deadline: null`. Deadline coverage comes entirely from the WeChat tier.
- `--jobage` is not supported server-side; filter client-side on `date`.
- `--query` filters only the pages actually fetched (20 per page) — raise
  `--pages` to widen, mindful of the volume note above.
- jobCard `order=` tokens can expire; if `detail` 404s, re-run `search` for a
  fresh URL (see url-reference.md).
- WeChat posting extraction is heuristic (numbered/【】line detection). Always
  open the article URL to confirm details before applying.
