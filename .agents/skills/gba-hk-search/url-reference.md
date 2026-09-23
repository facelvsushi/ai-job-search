# gba-hk-search — data-source reference

The file a future maintainer needs when a source changes its markup.
Recon verified 2026-09-18; re-verify anchors if parsers return nulls.

## Tier A — jobs.gov.hk GBA Youth Employment Scheme (gbayes)

### Compliance posture

- `https://www2.jobs.gov.hk/robots.txt`: allow-list + catch-all `Disallow: /`.
  Allowed: `/0/*/information/*` and a few initiative folders. **The
  quickview/search/jobCard paths below are NOT allowed**, and `/0/api/*` is
  explicitly disallowed — parse the HTML pages, never touch `/0/api/`.
  Same posture as linkedin-search: personal use, low volume, honest UA.
- No login anywhere. Server-rendered HTML; a fresh cookie-less session works.

### Listing page

`GET https://www2.jobs.gov.hk/0/{tc|cn|en}/jobseeker/jobsearch/quickview/gbayes/?page=N`

- ~20 cards/page, ~26 pages for the whole scheme. Default sort is
  post-date descending (`SortType` GET param exists: `post_dt_desc`,
  `post_dt_asc`, `salary_desc`, …) — we rely on the default.
- The portal's keyword search is a separate **POST** form
  (`/0/tc/jobseeker/jobsearch/search/gbayes/`, fields `criteria.searchField`,
  `criteria.jobType`, `criteria.industry`) — not used; `--query` filters
  client-side instead.

Per-card anchors (split chunks on `class="row item"`):

| Field | Anchor |
|---|---|
| id (ordno, stable) | `data-ordno="…"` on the clip link, or hidden input `value="11-26-0011957"` |
| detail URL | `data-jobcard="/0/tc/jobseeker/jobCard/?order=<token>&from=quickview&for=gbayes"` (relative; absolutize) |
| title | first short plain-text `<div>` inside the card (flex row's first cell); fallback `title="…"` attribute |
| salary | `div.icon_salary` text |
| location | `div.icon_address` text |
| company / date | **absent from the listing** — hydration fetch required |

### Detail page (jobCard)

The `order=` token is one-time-ish and cannot be derived from the ordno; token
expiry surfaces as an empty/`NOT_FOUND` jobCard. Recovery: re-run `search` for a
fresh URL, or `detail <ordno> --pages N` re-scans listing pages for a new token.

All fields id-anchored:

| Field | Anchor | Format |
|---|---|---|
| posted date | `#postedDt` | DD/MM/YYYY → normalized to ISO |
| title | `#jobTitle` | text |
| company | `#empName` | text (e.g. "JINGDONG E-COMMERCE ... LIMITED") |
| location | `#locDesc` | text |
| industry | `#indsDesc` | text |
| duties | `#jobRemark` | rich text |
| requirements | `#eduRemark` | rich text |
| employment terms | `#empTerm` | text |
| how to apply | `#openupRemark` | rich text |
| scheme eligibility note | `#propRemark` | rich text |
| **closing date** | **none exists** | always `null` |

## Tier B — WeChat 公众号 (wechat)

No crawling: two ingestion paths, both feeding the same extraction pipeline.

### Path 1 — URL feeding (`ingest --urls`, breakage-proof primary)

Batch-listing tools keep dying to WeChat API changes (wechat-article-exporter
broke 2026-09 when the 公众号 backend search API changed; wewe-rss archived
2026-01). Article pages themselves (`mp.weixin.qq.com/s/...`) remain publicly
readable without login (verified 2026-09-18) — so the durable path is: user
follows accounts in WeChat → copies article links into
`job_scraper/wechat_inbox/urls.txt` → `ingest --urls`.

- One URL per line, `#` comments OK; `--urls-file <path>` overrides the list.
- Each page: fetched anonymously → raw HTML archived to `processed/url_<hash>.html`
  (so `search`'s read-only merge keeps seeing it) → parsed with the same HTML
  anchors as raw saves → gated → extracted. Processed URLs move to
  `urls_done.txt` (date-stamped); failed fetches stay in the list for retry.
- If ALL fetches fail the command exits 1.

### Path 2 — bulk file export (optional)

Desktop tool [wechatDownload](https://github.com/qiye45/wechatDownload) or any
exporter's `.md`/`.html` output dropped into the inbox root — file mode
handles the rest. Exporters may break at any time; Path 1 always works.

### Raw mp.weixin.qq.com HTML anchors

| Field | Anchor |
|---|---|
| title | `#activity-name` or `var msg_title='…'` |
| account | `var nickname = htmlDecode("…")` (reliable) or `#js_name` / `.profile_nickname` |
| publish date | `create_timestamp` / `create_time` unix seconds — **`#publish_time` is server-rendered empty**, don't use it |
| body | `#js_content` |
| url | any `https://mp.weixin.qq.com/s…` link in the page |

### Exported Markdown

Tolerant parse: front-matter `title:`/`author:`/`date:` keys, else first `# `
heading; body = content minus front matter minus H1. Any `mp.weixin.qq.com/s…`
URL anywhere in the file becomes the posting's `url`.

### Extraction heuristics (v1)

- Eligibility gate (watchlist.md `keywords:` line, defaults
  港澳居民/香港青年/回乡证/大湾区青年就业计划/港澳青年…): an article mentioning
  none of them is skipped — mainland-only postings would otherwise flood results.
- Postings: numbered (`1.`/`一、`) or 【】-marked lines containing a job word
  (岗位/职位/专员/经理/…) each start a posting; blocks run to the next candidate.
  Articles with <2 candidates are treated as one posting (common for 专项推文).
- Deadlines: only dates on a line carrying 截止/截至/报名/DDL/deadline/apply-by
  count. Date forms: `2026年9月30日`, `2026-09-30`, `2026.9.30`, `30/9/2026`,
  `9月30日` (year resolved forward from the article's publish date). Long-term
  postings (长期有效/招满即止) yield `null`.
- Company: `招聘单位：`/`用人单位：` line, else the 公众号 account name.
- Location: first-match scan for 广州/深圳/珠海/佛山/惠州/东莞/中山/江门/肇庆/香港/澳门/前海/南沙/横琴.
- One article often holds many postings and per-posting URLs don't exist —
  `url` is the article URL (no `#fragment`; /scrape rejects fragments), `id`
  is `wechat:<account>:<hash>`.

## watch — gov recruitment pages (site-agnostic)

Targets: `- 名称 | URL` lines in watchlist.md (CLI tolerates any bullet line
carrying a URL). Extraction is generic — no per-site anchors:

- Every `<a href="…">text</a>` whose text matches
  招聘|招募|招引|公开招聘|就业|人才引进|招录|招用|岗位|诚聘 (RECRUIT_LINK_RE);
  `javascript:`/`mailto:` hrefs skipped.
- href absolutized against the page URL; dedup by absolute URL.
- Date scraped from link text or the 60 chars after the anchor
  (`YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY年M月D日`, `M月D日` → year resolved forward).
- Diff state: `job_scraper/watch_state.json` (url → first_seen date). First
  run seeds everything as new; later runs emit only additions. `--all`
  re-lists without touching state.

**Proxy gotcha:** gov sites reject proxy exits, and bun's fetch ignores
NO_PROXY. `watch` therefore auto-falls-back: fetch → curl `--noproxy "*"` →
plain curl. Verified reachable direct (2026-09-20): hrss.sz.gov.cn,
qh.sz.gov.cn (前海 alt domain; www.qianhai.gov.cn refuses direct), 
www.gzns.gov.cn, www.hengqin.gov.cn. hrss.gd.gov.cn direct fails (TLS).

**Known limitation:** several gov homepages load notice columns via JS, so
static extraction sees few/no links there (SZ/Qianhai homepages verified
JS-heavy 2026-09-20). Server-rendered column pages work; when a target yields
nothing, find its server-rendered listing page and swap the URL. Tier B
URL-feeding remains the primary channel — watch is a bonus net.

## Inbox layout

```
job_scraper/wechat_inbox/          ← user drops exports here
job_scraper/wechat_inbox/processed/  ← ingest archives parsed files here
```

`search` scans both folders read-only; `ingest` moves inbox-root files into
`processed/` (collision-suffixed, never overwritten).

## watchlist.md

- `keywords:` line — comma/、/| separated eligibility gate, editable at will.
- 公众号 account list is documentation for the export workflow (the CLI does
  not read it): 深圳人社、广东人社、前海控股/前海港澳e站通、香港工会联合会内地
  服务中心、大湾区青年就业计划相关号 — extend freely.
