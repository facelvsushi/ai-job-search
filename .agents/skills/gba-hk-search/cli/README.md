# gba-hk-search CLI

GBA jobs open to Hong Kong residents, two merged sources:

- **gbayes** — HK Labour Dept 「大湾区青年就业计划」vacancy database on
  www2.jobs.gov.hk (public HTML, no login; robots.txt disallows the search
  paths → personal use only, keep volume low)
- **wechat** — 公众号 recruitment articles you export with
  [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter)
  into `job_scraper/wechat_inbox/`; parsed locally, WeChat untouched

```bash
bun install          # dev types only — zero runtime dependencies
bun run src/cli.ts search --limit 10 --format table
bun run src/cli.ts detail "<jobCard-url>" --format plain
bun run src/cli.ts ingest --format table
bun run typecheck && bun run test
```

Full command reference in `../SKILL.md`; markup anchors and the WeChat
extraction heuristics in `../url-reference.md`; eligibility gate keywords in
`../watchlist.md` (user-editable, read at runtime).
