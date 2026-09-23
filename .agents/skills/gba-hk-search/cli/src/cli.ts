#!/usr/bin/env bun
// gba-hk-search CLI — GBA jobs open to Hong Kong residents.
// Tier A: HK Labour Dept GBA Youth Employment Scheme vacancies (www2.jobs.gov.hk,
//         public HTML, no login; robots.txt restricts the search paths → personal
//         use only, keep volume low).
// Tier B: WeChat 公众号 recruitment articles exported by the user into
//         job_scraper/wechat_inbox/ — parsed locally, WeChat itself untouched.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { runIngest, type IngestOpts } from "./commands/ingest.js"
import { runWatch, type WatchOpts } from "./commands/watch.js"
import { runReport, type ReportOpts } from "./commands/report.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || (a.startsWith("-") && a.length > 1)) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `gba-hk-search — GBA jobs open to Hong Kong residents (大湾区港澳青年岗位)

USAGE
  bun run src/cli.ts report [--pages 3] [--open] [--out <file>]
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <jobCard-url|ordno> [--format json|plain]
  bun run src/cli.ts ingest [--urls] [--inbox <dir>] [--dry-run] [--format json|table]
  bun run src/cli.ts watch [--all] [--format json|table]

REPORT  ← start here: generates a browsable HTML job board
  Scans the official GBAE listing (--pages, default 3 = 60 jobs), hydrates
  company/date, merges the WeChat inbox, and writes a self-contained HTML page
  where every job title links to its official detail page. Opens it with --open.
  Output defaults to documents/gba-jobs-<date>.html.

SEARCH FLAGS
  --query, -q <text>    Client-side keyword filter (title/company/location).
                        The portal's keyword search is a POST form; we filter
                        the fetched page(s) instead — combine with --pages.
  --lang <tc|cn|en>     Listing language. Default tc (traditional).
  --page <n>            1-indexed start page. Default 1 (20 results/page).
  --pages <n>           How many listing pages to scan. Default 1.
  --limit, -n <n>       Cap results (also caps detail hydration requests).
  --no-hydrate          Skip per-job detail fetches (company/date stay null).
  --no-wechat           Skip the wechat_inbox merge.
  --format <fmt>        json (default) | table | plain.

DETAIL
  Prefer the full jobCard URL from search results: the URL carries a one-time
  order token that cannot be rebuilt from the ordno. A bare ordno (11-26-0011957)
  triggers a bounded listing re-scan (--pages, default 3) to find a fresh token.

INGEST
  File mode (default): parses every .md/.html article in job_scraper/wechat_inbox/
  (and processed/), applies the eligibility gate from watchlist.md, extracts
  postings + deadlines, and moves inbox-root files to processed/.
  URL mode (--urls): fetches each mp.weixin.qq.com link listed in
  job_scraper/wechat_inbox/urls.txt (one per line, # comments ok), archives the
  raw page to processed/, and runs the same extraction. Processed URLs move to
  urls_done.txt; failed ones stay for retry. --urls-file overrides the path.

WATCH
  Polls the gov recruitment pages listed in watchlist.md ("- 名称 | URL" lines),
  extracts article links carrying recruitment keywords, and diffs against
  job_scraper/watch_state.json — first run seeds the state (everything "new").
  Gov sites often reject proxy exits: set NO_PROXY="*.gov.cn" if fetches fail.

EXAMPLES
  bun run src/cli.ts search -q "运营" --limit 5 --format table
  bun run src/cli.ts search --pages 3 --no-hydrate --format json
  bun run src/cli.ts detail "https://www2.jobs.gov.hk/0/tc/jobseeker/jobCard/?order=...&from=quickview&for=gbayes" --format plain
  bun run src/cli.ts ingest --format table
  bun run src/cli.ts ingest --urls --format table
  bun run src/cli.ts watch --format table

Personal use only — jobs.gov.hk robots.txt restricts the search paths; keep
volume low (one run ≈ 1 listing page + at most --limit detail fetches).
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  report: new Set(["pages", "limit", "lang", "no-wechat", "out", "open", "help", "h"]),
  search: new Set([
    "query", "q", "lang", "page", "pages", "limit", "n", "format",
    "no-hydrate", "no-wechat", "help", "h",
  ]),
  detail: new Set(["lang", "pages", "format", "help", "h"]),
  ingest: new Set(["inbox", "dry-run", "urls", "urls-file", "format", "help", "h"]),
  watch: new Set(["all", "format", "help", "h"]),
}

const intFlag = (name: string, raw: string | boolean | string[]): number | null => {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    process.stderr.write(
      JSON.stringify({ error: `--${name} must be a whole number of at least 1, got "${raw}"`, code: "BAD_ARG" }) + "\n",
    )
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      process.stderr.write(
        JSON.stringify({
          error: `unknown flag --${key} for '${cmd}' — flags are never silently ignored; see --help`,
          code: "UNKNOWN_FLAG",
        }) + "\n",
      )
      return 1
    }
  }

  const fmt = (f: string): "json" | "table" | "plain" => {
    const v = (flags[f] as string) || "json"
    return (["json", "table", "plain"].includes(v) ? v : "json") as "json" | "table" | "plain"
  }
  const langRaw = typeof flags.lang === "string" ? flags.lang : "tc"
  const lang = ["tc", "cn", "en"].includes(langRaw) ? langRaw : "tc"

  if (cmd === "report") {
    const opts: ReportOpts = {
      pages: 3,
      limit: 0,
      lang,
      wechat: flags["no-wechat"] !== true,
      out: typeof flags.out === "string" ? (flags.out as string) : "",
      open: flags.open === true,
    }
    if (flags.pages !== undefined) {
      const v = intFlag("pages", flags.pages)
      if (v === null) return 1
      opts.pages = v
    }
    if (flags.limit !== undefined) {
      const v = intFlag("limit", flags.limit)
      if (v === null) return 1
      opts.limit = v
    }
    return runReport(opts)
  }

  if (cmd === "search") {
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      lang,
      page: 1,
      pages: 1,
      limit: undefined,
      format: fmt("format"),
      hydrate: flags["no-hydrate"] !== true,
      wechat: flags["no-wechat"] !== true,
    }
    if (flags.page !== undefined) {
      const v = intFlag("page", flags.page)
      if (v === null) return 1
      opts.page = v
    }
    if (flags.pages !== undefined) {
      const v = intFlag("pages", flags.pages)
      if (v === null) return 1
      opts.pages = v
    }
    if (flags.limit !== undefined) {
      const v = intFlag("limit", flags.limit)
      if (v === null) return 1
      opts.limit = v
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const idOrUrl = (flags._ as string[])[1]
    if (!idOrUrl) {
      process.stderr.write(JSON.stringify({ error: "detail requires a <jobCard-url|ordno>", code: "NO_ID" }) + "\n")
      return 1
    }
    const opts: DetailOpts = {
      idOrUrl,
      lang,
      pages: 3,
      format: fmt("format") === "plain" ? "plain" : "json",
    }
    if (flags.pages !== undefined) {
      const v = intFlag("pages", flags.pages)
      if (v === null) return 1
      opts.pages = v
    }
    return runDetail(opts)
  }

  if (cmd === "ingest") {
    const opts: IngestOpts = {
      inbox: typeof flags.inbox === "string" ? flags.inbox : "",
      dryRun: flags["dry-run"] === true,
      urls: flags.urls === true,
      urlsFile: typeof flags["urls-file"] === "string" ? (flags["urls-file"] as string) : "",
      format: fmt("format") === "table" ? "table" : "json",
    }
    return runIngest(opts)
  }

  if (cmd === "watch") {
    const opts: WatchOpts = {
      all: flags.all === true,
      format: fmt("format") === "table" ? "table" : fmt("format") === "plain" ? "plain" : "json",
    }
    return runWatch(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
