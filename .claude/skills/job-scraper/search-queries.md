# Search Queries for Job Scraper

<!-- Populated by /setup, 2026-09-15. Function-based categories, per market. -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. For this setup:

- **`linkedin-search`** (enabled) — primary source for **Hong Kong** postings
- **`gba-hk-search`** (enabled) — **GBA 大湾区** postings open to HK residents: HK Labour Dept 「大湾区青年就业计划」official vacancy database + WeChat 公众号 exports in `job_scraper/wechat_inbox/` (run `ingest` after dropping new exports; official-source results carry `deadline: null`, WeChat results carry extracted deadlines)
- **`freehire-search`** (enabled) — country-agnostic, keep as secondary
- Danish demos (`jobindex`, `jobbank`, `jobdanmark`, `jobnet`) — **disabled**, not this market
- **Mainland China: BOSS直聘 runs through the `boss` terminal CLI** (`boss search ...`, see `投递指南.md` 路线 A), not through `/scrape`. Run the `boss search` lines below in a terminal, then paste the JD into `/apply`
- **猎聘 (Liepin)** has no CLI — covered by the `site:liepin.com` WebSearch fallback below

The `site:` query templates are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** queries are written in English (Hong Kong / overseas) and Simplified Chinese 简体中文 (mainland), the two markets in scope. HK postings written in Traditional Chinese are fine to read — Cantonese native with native literacy in both scripts.

## Search Sites

Primary:
- **linkedin.com/jobs** — Hong Kong (also covered by `linkedin-search` CLI)
- **zhipin.com (BOSS直聘)** — mainland GBA, via `boss` CLI in terminal
- **liepin.com (猎聘)** — mainland GBA, WebSearch fallback

Company career pages (user request: check big companies' official sites directly — more accurate):
- `careers.tencent.com` (腾讯), `hr.163.com` (网易), `zhaopin.meituan.com` / `careers.meituan.com` (美团)
- `hsbc.com.hk`, `hangseng.com`, `bochk.com` (HK banks)
- `deloitte.com`, `pwc.com`, `kpmg.com`, `ey.com` (Big Four, HK + mainland GBA)

## Exclusions (never search; also screened at /rank)

- 律师 / 实习律师 / 公司法务 / 合规 (legal-practice and compliance roles)
- 房地产销售 (real-estate sales)
- Pure quantitative-analysis roles (数据分析师 / BI Analyst as the core daily work)
- 券商 (securities brokers) front office and 量化 (quant) roles — deprioritized: may surface but rank at bottom
- Mainland 央企/国企 (central & state-owned enterprises) **except** Shenzhen Qianhai (前海) employers with HK-resident employment support — those get a positive "Qianhai HK-friendly" flag

## Query Categories

Queries are grouped by priority. Combine each query with the market's location terms where the site supports it.

### Priority 1: Hong Kong — Management Trainee & client-facing graduate programmes

Strongest and most desired direction: banks, corporates, and insurers' graduate schemes.

```
site:linkedin.com/jobs "Management Trainee" Hong Kong
site:linkedin.com/jobs "Graduate Trainee" OR "Graduate Programme" Hong Kong
site:linkedin.com/jobs "Management Associate" bank Hong Kong
site:linkedin.com/jobs graduate trainee insurance Hong Kong AIA OR Prudential OR Manulife OR AXA
site:linkedin.com/jobs 管理培訓生 香港
```

### Priority 2: Hong Kong — Consulting & Big Four (tax / consulting)

Recommended by the candidate's university teacher; emphasised application direction.

```
site:linkedin.com/jobs "Consultant" graduate Hong Kong
site:linkedin.com/jobs "Tax Associate" OR "Tax Consultant" OR "Tax Graduate" Hong Kong
site:linkedin.com/jobs "Business Consulting" graduate Hong Kong
site:deloitte.com OR site:pwc.com OR site:kpmg.com OR site:ey.com graduate tax Hong Kong
```

### Priority 3: Mainland GBA — 管培生, 大厂 marketing, 四大税务

Run the `boss` lines in a terminal (Shenzhen first, then Guangzhou); Liepin via WebSearch.

```
boss search "管培生" --city 深圳
boss search "管培生" --city 广州
boss search "管理培训生" --city 深圳 --salary 10-25K
boss search "市场营销" --city 深圳
boss search "品牌营销" --city 广州
site:liepin.com 管培生 深圳
site:liepin.com 市场营销 OR 品牌营销 深圳 OR 广州
site:deloitte.com.cn OR site:pwccn.com OR site:kpmg.com.cn OR site:ey.51job.com 税务 深圳 OR 广州 校园招聘
```

### Priority 3.5: GBA 港澳青年专项 — 大湾区青年就业计划 & 前海/南沙/横琴 (gba-hk-search CLI)

Primary via the `gba-hk-search` CLI (auto-discovered). WebSearch fallback for the scheme and the mainland-side programs that have no listing pages:

```
bun run .agents/skills/gba-hk-search/cli/src/cli.ts search --limit 15 --format json
bun run .agents/skills/gba-hk-search/cli/src/cli.ts ingest --format table
site:jobs.gov.hk 大灣區青年就業計劃
前海 港澳青年 招聘 2026
南沙 OR 横琴 港澳青年 專項招聘
```

公众号专项文章（前海/南沙/横琴大多只在此发布）：用 wechat-article-exporter 导出 `watchlist.md` 里公众号的最新文章 → 投入 `job_scraper/wechat_inbox/` → 跑 `ingest`。

### Priority 4: Gaming — 游戏策划 / 游戏推广 (personal interest: Tencent, NetEase, other game 大厂)

```
site:careers.tencent.com 游戏策划 深圳
site:careers.tencent.com 游戏推广 OR 市场营销 深圳
boss search "游戏策划" --city 深圳
boss search "游戏推广" --city 深圳 OR 广州
site:hr.163.com 游戏策划 OR 游戏运营 广州
site:linkedin.com/jobs game marketing OR publishing Hong Kong OR Shenzhen
```

### Priority 5: Broader client-facing graduate roles (wider net)

All sales-like roles are acceptable **except real-estate sales**.

```
site:linkedin.com/jobs "Business Development" graduate Hong Kong
site:linkedin.com/jobs "Client Relationship" OR "Customer Success" graduate Hong Kong
boss search "储备干部" --city 深圳 OR 广州
site:liepin.com 客户经理 校招 深圳
```

## Location Filter

When evaluating results, verify the job location is within the GBA:
- **Hong Kong** — ideal (1st priority)
- **Shenzhen** — acceptable (2nd); flag 前海 Qianhai employers with HK-resident employment support for special consideration
- **Guangzhou** — borderline (3rd)
- **Foshan 佛山 / other GBA cities under 大湾区青年就业计划** — in scope when the posting is a scheme vacancy (employed by the HK entity under HK law); otherwise apply the distance rule
- Anywhere outside the Greater Bay Area — too far, exclude

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in (e.g. "native English") is not excluded, flag it clearly instead. Postings simply *written* in Traditional Chinese or English that don't require an undeclared language on the job are fine.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
