import {
  DEFAULT_INBOX,
  URLS_FILE_PATH,
  scanInbox,
  loadGateKeywords,
  matchesGate,
  extractPostings,
  djb2Hash,
  fetchArticleFromUrl,
  htmlFetch,
  parseWechatHtml,
  writeError,
} from "../helpers.js"
import { join } from "path"
import { renameSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

export interface IngestOpts {
  inbox: string
  dryRun: boolean
  urls: boolean
  urlsFile: string
  format: "json" | "table"
}

async function ingestUrlList(opts: IngestOpts): Promise<number> {
  const inbox = opts.inbox || DEFAULT_INBOX
  const urlsFile = opts.urlsFile || join(inbox, "urls.txt")
  const keywords = await loadGateKeywords()
  const processedDir = join(inbox, "processed")

  let lines: string[] = []
  try {
    lines = readFileSync(urlsFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  } catch {
    process.stderr.write(
      JSON.stringify({ error: `no URL list at ${urlsFile} — paste mp.weixin.qq.com article links, one per line`, code: "NO_URLS_FILE" }) + "\n",
    )
    return 1
  }

  const results: Record<string, unknown>[] = []
  let skipped = 0
  let failed = 0
  const done: string[] = []

  for (const url of lines) {
    try {
      const { article } = await fetchArticleFromUrl(url, processedDir)
      done.push(url)
      if (!matchesGate(`${article.title}\n${article.body}`, keywords)) {
        skipped++
        continue
      }
      for (const posting of extractPostings(article)) {
        results.push({
          id: `wechat:${article.account}:${djb2Hash(`${article.account}|${article.title}|${posting.title}`)}`,
          title: posting.title,
          company: posting.company ?? article.account,
          location: posting.location,
          date: article.publishDate,
          deadline: posting.deadline,
          url: article.url ?? url,
          source: `wechat:${article.account}`,
          _article: article.title,
          _file: url,
        })
      }
    } catch {
      failed++ // keep the line in urls.txt for a retry
    }
  }

  // rewrite urls.txt keeping unprocessed lines; archive done ones with dates
  if (!opts.dryRun && done.length) {
    const remaining = lines.filter((l) => !done.includes(l))
    writeFileSync(urlsFile, remaining.length ? remaining.join("\n") + "\n" : "")
    const donePath = join(inbox, "urls_done.txt")
    const stamp = new Date().toISOString().slice(0, 10)
    writeFileSync(donePath, done.map((u) => `${stamp} ${u}`).join("\n") + "\n", { flag: "a" })
  }

  const meta = { urls: lines.length, ok: done.length, failed, skipped_no_gate: skipped, urlsFile }
  if (opts.format === "table") {
    if (results.length === 0) process.stdout.write("No postings extracted from URL list.\n")
    else
      process.stdout.write(
        results.map((r) => [r.title, r.company, r.deadline ?? "—"].map(String).join("  ")).join("\n") + "\n",
      )
    process.stdout.write(`\nurls: ${meta.urls}, ok: ${meta.ok}, failed: ${meta.failed}, skipped(no gate): ${meta.skipped_no_gate}\n`)
  } else {
    process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
  }
  return failed === lines.length && lines.length > 0 ? 1 : 0
}

/**
 * Parse every article in the inbox, emit postings, and (unless --dry-run)
 * move each parsed file into inbox/processed\ so the next ingest starts
 * clean. `search` re-reads processed\ read-only, so archived articles keep
 * appearing in search results until seen_jobs dedup takes over.
 */
export async function runIngest(opts: IngestOpts): Promise<number> {
  if (opts.urls) return ingestUrlList(opts)
  try {
    const inbox = opts.inbox || DEFAULT_INBOX
    const files = await scanInbox(inbox)
    const keywords = await loadGateKeywords()
    const processedDir = join(inbox, "processed")

    const results: Record<string, unknown>[] = []
    let skipped = 0
    let moved = 0

    for (const entry of files) {
      // Only files still in the inbox root are archived; processed\ files are
      // re-parsed for output but never moved again.
      const inRoot = !entry.path.includes(join("processed", ""))
      const article = entry.article
      const gated = !matchesGate(`${article.title}\n${article.body}`, keywords)
      if (gated) {
        skipped++
      } else {
        for (const posting of extractPostings(article)) {
          results.push({
            id: `wechat:${article.account}:${djb2Hash(`${article.account}|${article.title}|${posting.title}`)}`,
            title: posting.title,
            company: posting.company ?? article.account,
            location: posting.location,
            date: article.publishDate,
            deadline: posting.deadline,
            url: article.url,
            source: `wechat:${article.account}`,
            _article: article.title,
            _file: entry.file,
          })
        }
      }
      // Archive every parsed file — gated-out ones too, or re-ingests would
      // rescan them forever. Gating only controls what reaches results.
      if (inRoot && !opts.dryRun) {
        try {
          if (!existsSync(processedDir)) {
            const { mkdirSync } = await import("fs")
            mkdirSync(processedDir, { recursive: true })
          }
          let target = join(processedDir, entry.file)
          if (existsSync(target)) {
            target = join(processedDir, entry.file.replace(/(\.\w+)$/, `.${Date.now()}$1`))
          }
          renameSync(entry.path, target)
          moved++
        } catch {
          // archive failure must not lose the parsed output
        }
      }
    }

    const meta = { articles: files.length, skipped_no_gate: skipped, moved, inbox }

    if (opts.format === "table") {
      if (results.length === 0) {
        process.stdout.write("No postings ingested.\n")
      } else {
        const rows = results.map((r) =>
          [r.id, r.title, r.company, r.deadline ?? "—"].map(String).join("  "),
        )
        process.stdout.write(["ID  TITLE  COMPANY  DEADLINE", ...rows].join("\n") + "\n")
      }
      process.stdout.write(
        `\narticles: ${meta.articles}, skipped(no gate): ${meta.skipped_no_gate}, moved: ${meta.moved}\n`,
      )
    } else {
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "INGEST_FAILED")
    return 1
  }
}
