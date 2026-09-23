import {
  listUrl,
  htmlFetch,
  parseListingCards,
  parseGbaDetail,
  scanInbox,
  loadGateKeywords,
  matchesGate,
  extractPostings,
  djb2Hash,
  writeError,
  type HydratableCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  lang: string // tc | cn | en
  page: number
  pages: number
  limit?: number
  format: "json" | "table" | "plain"
  hydrate: boolean
  wechat: boolean
}

export async function fetchGbayes(opts: SearchOpts): Promise<HydratableCard[]> {
  const cards: HydratableCard[] = []
  for (let p = opts.page; p < opts.page + opts.pages; p++) {
    const html = await htmlFetch(listUrl(opts.lang, p))
    if (!html) break
    cards.push(...parseListingCards(html))
  }
  return cards
}

/** Fetch each listing card's jobCard page to fill company + posted date. */
export async function hydrateCards(cards: HydratableCard[]) {
  for (const card of cards) {
    if (!card.url) continue
    try {
      const html = await htmlFetch(card.url)
      if (!html) continue
      const detail = parseGbaDetail(html)
      card.company = detail.company
      card.date = detail.date
    } catch {
      // hydration is best-effort; the listing fields still stand
    }
  }
}

export async function wechatResults(): Promise<{ results: Record<string, unknown>[]; articles: number; skipped: number }> {
  const files = await scanInboxDefault()
  const keywords = await loadGateKeywords()
  const results: Record<string, unknown>[] = []
  let skipped = 0
  for (const entry of files) {
    const { article } = entry
    const gateText = `${article.title}\n${article.body}`
    if (!matchesGate(gateText, keywords)) {
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
        url: article.url,
        source: `wechat:${article.account}`,
        _article: article.title,
      })
    }
  }
  return { results, articles: files.length, skipped }
}

import { DEFAULT_INBOX } from "../helpers.js"
async function scanInboxDefault() {
  return scanInbox(DEFAULT_INBOX)
}

export function dedupById(results: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  return results.filter((r) => {
    const id = String(r.id ?? "")
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function renderTable(results: Record<string, unknown>[]): string {
  if (results.length === 0) return "No results."
  const rows = results.map((r) => {
    const id = String(r.id ?? "").slice(0, 22).padEnd(22)
    const src = String(r.source ?? "").slice(0, 16).padEnd(16)
    const title = String(r.title ?? "").slice(0, 34).padEnd(34)
    const company = String(r.company ?? "—").slice(0, 20).padEnd(20)
    const loc = String(r.location ?? "—").slice(0, 16).padEnd(16)
    const dl = String(r.deadline ?? "—")
    return `${id} ${src} ${title} ${company} ${loc} ${dl}`
  })
  const header =
    "ID".padEnd(22) +
    " " +
    "SOURCE".padEnd(16) +
    " " +
    "TITLE".padEnd(34) +
    " " +
    "COMPANY".padEnd(20) +
    " " +
    "LOCATION".padEnd(16) +
    " DEADLINE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    let gba: Record<string, unknown>[] = []
    if (opts.pages > 0) {
      const cards = await fetchGbayes(opts)
      const sliced = opts.limit ? cards.slice(0, opts.limit) : cards
      if (opts.hydrate) await hydrateCards(sliced)
      gba = sliced.map((c) => ({
        id: `gbayes:${c.id}`,
        title: c.title,
        company: c.company ?? null,
        location: c.location,
        date: c.date ?? null,
        deadline: null, // the official source has no closing-date field
        url: c.url || null,
        salary: c.salary,
        source: "gbayes",
      }))
    }

    let wechat: Record<string, unknown>[] = []
    let wechatMeta = { articles: 0, skipped: 0 }
    if (opts.wechat) {
      const w = await wechatResults()
      wechat = w.results as Record<string, unknown>[]
      wechatMeta = { articles: w.articles, skipped: w.skipped }
    }

    let results = dedupById([...gba, ...wechat])

    if (opts.query) {
      const q = opts.query.toLowerCase()
      results = results.filter((r) =>
        [r.title, r.company, r.location, (r as Record<string, unknown>)._article]
          .some((v) => typeof v === "string" && v.toLowerCase().includes(q)),
      )
    }
    if (opts.limit) results = results.slice(0, opts.limit)

    const meta = {
      count: results.length,
      page: opts.page,
      pages: opts.pages,
      sources: { gbayes: gba.length, wechat: wechat.length },
      wechat_articles: wechatMeta.articles,
      wechat_skipped_no_gate: wechatMeta.skipped,
    }

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map(
            (r) =>
              `${r.title}\n  ${r.company || "—"} · ${r.location || "—"} · ${r.date || "—"} · 截止 ${r.deadline || "—"}\n  ${r.source}\n  ${r.url ?? "(no url)"}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
