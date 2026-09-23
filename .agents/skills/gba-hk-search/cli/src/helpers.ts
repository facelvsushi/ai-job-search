// Data sources:
// Tier A: Hong Kong Labour Department "Greater Bay Area Youth Employment Scheme"
//         (大湾区青年就业计划) vacancy list on www2.jobs.gov.hk — server-rendered
//         HTML, no login. robots.txt disallows the search paths, so volume must
//         stay low: personal use only, a handful of requests per run.
// Tier B: WeChat 公众号 recruitment articles exported by the user with
//         wechat-article-exporter and dropped into job_scraper/wechat_inbox/.
//         We never touch WeChat itself — we only parse exported local files.
//
// Parsed with regex throughout (the markup is shallow and stable; zero runtime
// dependencies per the portal-skill contract).

import { join } from "path"

// helpers.ts sits at <repo>/.agents/skills/gba-hk-search/cli/src/ → five
// levels up is the repo root.
export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..")
export const WATCHLIST_PATH = join(import.meta.dir, "..", "..", "watchlist.md")
export const DEFAULT_INBOX = join(REPO_ROOT, "job_scraper", "wechat_inbox")

export const BASE = "https://www2.jobs.gov.hk"

/** Listing page for the GBA scheme. lang: tc | cn | en. 1-indexed page. */
export function listUrl(lang: string, page: number): string {
  return `${BASE}/0/${lang}/jobseeker/jobsearch/quickview/gbayes/?page=${page}`
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; gba-hk-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 4
  let delay = 800
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.6",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------- text utils

export function djb2Hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const NUMERIC_ENTITY = (cp: number): string =>
  cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => NUMERIC_ENTITY(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => NUMERIC_ENTITY(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

export function stripTags(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\n{3,}/g, "\n\n")
}

/**
 * Extract the inner HTML of the element with the given id. The element's own
 * tag name is detected from its opening tag, then depth-tracked to its
 * matching close — so nested containers of any kind don't truncate the value.
 */
export function extractIdContent(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<(\\w+)[^>]*id="${escaped}"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null
  const tag = open[1].toLowerCase()

  // void elements never have a closing tag
  if (["img", "br", "input", "hr", "meta", "link"].includes(tag)) return null

  const start = open.index + open[0].length
  const openRe2 = new RegExp(`<${tag}\\b`, "gi")
  const closeTag = `</${tag}>`
  let depth = 1
  let i = start
  openRe2.lastIndex = i
  while (depth > 0) {
    const nextOpen = openRe2.exec(html)
    const nextClose = html.indexOf(closeTag, i)
    if (nextClose === -1) return null
    if (nextOpen && nextOpen.index < nextClose) {
      depth++
      i = nextOpen.index + nextOpen[0].length
    } else {
      depth--
      i = nextClose + closeTag.length
    }
  }
  return html.slice(start, i - closeTag.length)
}

// ---------------------------------------------------------------- date utils

const pad = (n: number) => String(n).padStart(2, "0")

function toIso(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** gbayes detail pages show DD/MM/YYYY. */
export function dmyToIso(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? toIso(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10)) : null
}

const DATE_PATTERNS: RegExp[] = [
  /(\d{4})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})[日號]?/g, // 2026年9月30日 / 2026-09-30 / 2026.9.30
  /(\d{1,2})\/(\d{1,2})\/(\d{4})/g, // 30/9/2026 (DD/MM/YYYY, HK convention)
  /(\d{1,2})月(\d{1,2})[日號]/g, // 9月30日 (year resolved against base)
]

/** Resolve a year-less month/day against base (next occurrence, not past). */
function resolveYearless(m: number, d: number, base: Date): string | null {
  const y = base.getUTCFullYear()
  const iso = toIso(y, m, d)
  const baseIso = `${y}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`
  if (iso && iso >= baseIso) return iso
  return toIso(y + 1, m, d)
}

/**
 * Find the first application deadline mentioned in text. Only dates on a line
 * that carries a deadline trigger word count — a random date elsewhere is not
 * a deadline. baseDate anchors year-less dates; null base = today.
 */
export function extractDeadline(text: string, baseDate?: string | null): string | null {
  const trigger = /(截止|截至|報名|报名|ddl|deadline|apply\s*(by|before)|before)/i
  const base = baseDate ? new Date(baseDate + "T00:00:00Z") : new Date()
  if (isNaN(base.getTime())) return null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || !trigger.test(line)) continue
    for (const pattern of DATE_PATTERNS) {
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(line)) !== null) {
        let iso: string | null = null
        if (pattern === DATE_PATTERNS[0]) {
          iso = toIso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10))
        } else if (pattern === DATE_PATTERNS[1]) {
          iso = toIso(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10))
        } else {
          iso = resolveYearless(parseInt(m[1], 10), parseInt(m[2], 10), base)
        }
        if (iso) return iso
      }
    }
  }
  return null
}

// ------------------------------------------------------------- gbayes (Tier A)

export interface GbaJob {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  deadline: string | null
  url: string
  salary?: string | null
  source: string
}

export interface ListingCard {
  id: string
  title: string
  url: string // absolute jobCard URL (carries the one-time order token)
  salary: string | null
  location: string | null
}

/** Listing card after detail hydration fills company + posted date. */
export type HydratableCard = ListingCard & { company?: string | null; date?: string | null }

/** Split the listing page into per-card chunks and parse each independently. */
export function parseListingCards(html: string): ListingCard[] {
  const cards: ListingCard[] = []
  // Live cards read class="row item p-1 no-gutters" — match the prefix only,
  // the remaining attributes (data-roworder/data-prev/data-jobcard) stay in
  // the chunk that follows the split point.
  const chunks = html.split(/class="row\s+item[^"]*"/).slice(1)

  for (const chunk of chunks) {
    const ordno =
      chunk.match(/data-ordno="([^"]+)"/)?.[1] ??
      chunk.match(/value="(\d{2}-\d{2}-\d{7})"/)?.[1]
    if (!ordno) continue

    const rel = chunk.match(/data-jobcard="([^"]+)"/)?.[1]
    const url = rel ? decodeHtmlEntities(rel) : null

    // Title: first short plain-text div in the card (the flex row's first cell).
    let title: string | null = null
    const t = /<div[^>]*>\s*([^<>\n]{3,120})\s*<\/div>/i.exec(chunk)
    if (t) title = clean(t[1])
    if (!title) {
      const attr = chunk.match(/title="([^"]{3,120})"/)
      if (attr) title = clean(attr[1])
    }
    if (!title) continue

    const salary = clean(chunk.match(/icon_salary[^>]*>\s*([^<]{1,80})/)?.[1] ?? "") || null
    const location = clean(chunk.match(/icon_address[^>]*>\s*([^<]{1,120})/)?.[1] ?? "") || null

    cards.push({
      id: ordno,
      title,
      url: url ? (url.startsWith("http") ? url : BASE + url) : "",
      salary,
      location,
    })
  }
  return cards
}

export interface GbaDetail {
  title: string | null
  company: string | null
  date: string | null // posted date, ISO
  location: string | null
  industry: string | null
  duties: string | null
  requirements: string | null
  terms: string | null
  apply: string | null
  eligibility: string | null
}

/** Parse one jobCard detail page (all fields are id-anchored). */
export function parseGbaDetail(html: string): GbaDetail {
  const field = (id: string) => {
    const raw = extractIdContent(html, id)
    return raw ? (clean(raw) || null) : null
  }
  return {
    title: field("jobTitle"),
    company: field("empName"),
    date: dmyToIso(field("postedDt")),
    location: field("locDesc"),
    industry: field("indsDesc"),
    duties: field("jobRemark"),
    requirements: field("eduRemark"),
    terms: field("empTerm"),
    apply: field("openupRemark"),
    eligibility: field("propRemark"),
  }
}

// ------------------------------------------------------------- wechat (Tier B)

export interface WechatArticle {
  title: string
  account: string
  publishDate: string | null // ISO
  url: string | null
  body: string
}

function findWechatUrl(text: string): string | null {
  const m =
    text.match(/https:\/\/mp\.weixin\.qq\.com\/s[?=\w\-&#\/]*/) ??
    text.match(/https:\\\/\\\/mp\.weixin\.qq\.com\\\/s[?=\w\-&#\\\/]*/)
  if (!m) return null
  return decodeHtmlEntities(m[0]).replace(/\\+\//g, "/").replace(/["').,;]+$/, "")
}

/** Raw mp.weixin.qq.com article HTML (user saved the page directly). */
export function parseWechatHtml(html: string, fallbackName: string): WechatArticle {
  const title =
    clean(extractIdContent(html, "activity-name") ?? "") ||
    clean(html.match(/var msg_title\s*=\s*'(.*?)'/)?.[1] ?? "") ||
    fallbackName
  const account =
    clean(html.match(/var nickname\s*=\s*htmlDecode\("(.*?)"\)/)?.[1] ?? "") ||
    clean(extractIdContent(html, "js_name") ?? "") ||
    clean(html.match(/class="profile_nickname"[^>]*>([^<]{1,60})</)?.[1] ?? "") ||
    fallbackName
  const ts = html.match(/create_timestamp\s*=\s*['"]?(\d{10})/)?.[1] ??
    html.match(/create_time\s*=\s*['"]?(\d{10})/)?.[1]
  const publishDate = ts ? new Date(parseInt(ts, 10) * 1000).toISOString().slice(0, 10) : null
  const body = clean(extractIdContent(html, "js_content") ?? clean(html).slice(0, 20000))
  return { title: title || fallbackName, account, publishDate, url: findWechatUrl(html), body }
}

/** Markdown exported by wechat-article-exporter (front matter tolerated). */
export function parseWechatMarkdown(md: string, fallbackName: string): WechatArticle {
  const heading = md.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const fm = (key: string) =>
    new RegExp(`^${key}\\s*:\\s*(.+)$`, "mi").exec(md)?.[1]?.trim().replace(/^["']|["']$/g, "")
  const title = fm("title") || heading || fallbackName
  const account = fm("author") || fm("account") || fm("nickname") || fallbackName
  const dateRaw = fm("date") || fm("publish_time") || md.match(/发布于[:：]?\s*(\d{4}-\d{2}-\d{2})/)?.[1]
  const body = md
    .replace(/^---[\s\S]*?---/, "") // front matter
    .replace(/^#\s+.+$/m, "") // H1 title line
    .trim()
  return { title, account, publishDate: dateRaw || null, url: findWechatUrl(md), body }
}

const CITIES = [
  "广州", "深圳", "珠海", "佛山", "惠州", "东莞", "中山", "江门", "肇庆",
  "香港", "澳门", "前海", "南沙", "横琴",
  // traditional variants commonly used by HK-facing 公众号
  "廣州", "東莞", "江門", "肇慶", "澳門", "橫琴",
]

export function detectCities(text: string): string | null {
  const found = CITIES.filter((c) => text.includes(c))
  return found.length ? found.join("/") : null
}

export function detectCompany(text: string): string | null {
  const m =
    text.match(/(?:招聘单位|用人单位|公司名称|企业名称|招募单位)\s*[:：]\s*([^\n]{2,60})/) ??
    text.match(/(?:主办|承办)(?:单位)?\s*[:：]\s*([^\n]{2,60})/)
  return m ? clean(m[1]) : null
}

// ------------------------------------------------------- posting extraction

const JOB_WORDS =
  /岗位|职位|招聘|专员|经理|主管|助理|工程师|运营|销售|客服|文员|店长|技术员|实习|管培|培训生|会计|设计|司机|护理|教师|顾问|编辑|翻译|誠聘|急聘|運營|專員|經理|工程師|銷售|文員|店長|技術員|實習|培訓生|會計|設計|司機|護理|教師|顧問|編輯|翻譯|職員|店員/i

const NUMBERED = /^[\s>]*(\d{1,2}|[一二三四五六七八九十]{1,3})[、.．)）:：]\s*(.{3,60})$/
const BRACKETED = /^[【\[]\s*(.{3,40}?)\s*[】\]]/

interface Candidate {
  title: string
  startLine: number
}

function candidateTitleLines(lines: string[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.length > 70) continue
    const num = NUMBERED.exec(line)
    if (num) {
      const rest = num[2].trim()
      if (JOB_WORDS.test(rest)) out.push({ title: clean(rest), startLine: i + 1 })
      continue
    }
    const br = BRACKETED.exec(line)
    if (br && JOB_WORDS.test(br[1])) {
      out.push({ title: clean(br[1]), startLine: i + 1 })
    }
  }
  return out
}

export interface ExtractedPosting {
  title: string
  company: string | null
  location: string | null
  deadline: string | null
}

/**
 * Split an article body into individual job postings. Heuristic v1: numbered
 * or 【】-marked lines that carry a job word start a posting; each posting
 * owns its lines until the next candidate. Articles with no candidates are
 * treated as a single posting (very common for 专项招聘推文).
 */
export function extractPostings(article: WechatArticle): ExtractedPosting[] {
  const lines = article.body.split(/\r?\n/)
  const candidates = candidateTitleLines(lines)

  if (candidates.length === 0) {
    return [
      {
        title: article.title,
        company: detectCompany(article.body),
        location: detectCities(article.body),
        deadline: extractDeadline(article.body, article.publishDate),
      },
    ]
  }

  if (candidates.length === 1) {
    // One numbered/【】heading: it IS the posting title (better than the
    // article title); everything after it is the posting's block.
    const start = candidates[0].startLine
    const block = lines.slice(start).join("\n")
    return [
      {
        title: candidates[0].title,
        company: detectCompany(block) ?? detectCompany(article.body),
        location: detectCities(block) ?? detectCities(article.body),
        deadline: extractDeadline(block, article.publishDate) ?? extractDeadline(article.body, article.publishDate),
      },
    ]
  }

  const postings: ExtractedPosting[] = []
  for (let c = 0; c < candidates.length; c++) {
    const start = candidates[c].startLine
    const end = c + 1 < candidates.length ? candidates[c + 1].startLine : lines.length
    const block = lines.slice(start, end).join("\n")
    postings.push({
      title: candidates[c].title,
      company: detectCompany(block) ?? detectCompany(article.body),
      location: detectCities(block) ?? detectCities(article.body),
      deadline: extractDeadline(block, article.publishDate) ?? extractDeadline(article.body, article.publishDate),
    })
  }
  return postings
}

// ---------------------------------------------------------------- inbox scan

async function readTextFile(path: string): Promise<{ name: string; text: string } | null> {
  try {
    const f = Bun.file(path)
    if (!(await f.exists())) return null
    return { name: path.split(/[\\/]/).pop() ?? path, text: await f.text() }
  } catch {
    return null
  }
}

export interface InboxArticle {
  file: string
  path: string
  article: WechatArticle
}

/**
 * Scan an inbox directory (plus its processed\ subfolder) read-only for
 * exported WeChat articles (.md / .html / .htm). Returns one parsed article
 * per file; unparseable files are skipped silently.
 */
export async function scanInbox(inboxDir: string): Promise<InboxArticle[]> {
  const out: InboxArticle[] = []
  const dirs = [inboxDir, join(inboxDir, "processed")]
  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = await Array.fromAsync(new Bun.Glob("*.{md,html,htm}").scan({ cwd: dir }))
    } catch {
      continue // folder missing
    }
    for (const name of names) {
      const path = join(dir, name)
      const file = await readTextFile(path)
      if (!file) continue
      const isHtml = /\.html?$/i.test(name)
      const fallback = name.replace(/\.(md|html?)$/i, "").replace(/^.*?__/, "")
      const article = isHtml
        ? parseWechatHtml(file.text, fallback)
        : parseWechatMarkdown(file.text, fallback)
      out.push({ file: name, path, article })
    }
  }
  return out
}

// ---------------------------------------------------------------- watchlist

const DEFAULT_GATE = ["港澳居民", "香港青年", "回乡证", "回鄉證", "大湾区青年就业计划", "大灣區青年就業計劃", "港澳青年", "港澳学生", "港人"]

/**
 * Eligibility gate keywords, read from the user-editable watchlist.md line
 * `keywords: a, b, c`. Falls back to the built-in list when the file or line
 * is missing.
 */
export async function loadGateKeywords(): Promise<string[]> {
  try {
    const f = Bun.file(WATCHLIST_PATH)
    if (await f.exists()) {
      const text = await f.text()
      const line = text.match(/^keywords?\s*:\s*(.+)$/mi)?.[1]
      if (line) {
        const words = line
          .split(/[,，、|]/)
          .map((w) => w.trim())
          .filter(Boolean)
        if (words.length) return words
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_GATE
}

export function matchesGate(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

// ------------------------------------------------------------- ingest --urls

/**
 * Fetch one mp.weixin.qq.com article URL and archive the raw HTML into the
 * inbox's processed\ folder so the regular file-based pipeline (and search's
 * read-only merge) picks it up. Returns the parse result.
 */
export async function fetchArticleFromUrl(
  url: string,
  processedDir: string,
): Promise<{ article: WechatArticle; file: string }> {
  const html = await htmlFetch(url)
  if (!html) throw new Error(`empty response from ${url}`)
  const hash = djb2Hash(url)
  const article = parseWechatHtml(html, `url_${hash}`)
  // Re-run parse on the saved file's anchors: keep the raw page so
  // create_timestamp/nickname survive.
  const { mkdirSync } = await import("fs")
  mkdirSync(processedDir, { recursive: true })
  const file = `url_${hash}.html`
  await Bun.write(join(processedDir, file), html)
  return { article, file }
}

// ------------------------------------------------------------------- watch

export interface WatchTarget {
  name: string
  url: string
}

/**
 * Parse `- 名称 | https://...` lines from watchlist.md (tolerant: any bullet
 * line carrying a URL works, section markers are ignored).
 */
export async function loadWatchTargets(): Promise<WatchTarget[]> {
  try {
    const f = Bun.file(WATCHLIST_PATH)
    if (!(await f.exists())) return []
    const text = await f.text()
    const out: WatchTarget[] = []
    for (const line of text.split(/\r?\n/)) {
      const m = /^-\s*(.+?)\s*\|\s*(https?:\/\/\S+?)\s*$/.exec(line.trim())
      if (m) out.push({ name: m[1], url: m[2] })
    }
    return out
  } catch {
    return []
  }
}

export const RECRUIT_LINK_RE =
  /招聘|招募|招引|公开招聘|就业|人才引进|招录|招用|岗位|職招|诚聘|誠聘/

export interface WatchItem {
  source: string
  title: string
  url: string
  date: string | null
}

/**
 * Site-agnostic listing extraction: pull every <a href> whose visible text
 * carries a recruitment keyword, absolutize the href, and grab a date from
 * the link text or its immediate surroundings. Works on server-rendered gov
 * pages without per-site anchors.
 */
export function extractPageLinks(html: string, baseUrl: string, source: string): WatchItem[] {
  const items: WatchItem[] = []
  const seen = new Set<string>()
  const re = /<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const rawHref = decodeHtmlEntities(m[1])
    const text = clean(m[2]).replace(/\s+/g, " ").trim()
    if (!text || !RECRUIT_LINK_RE.test(text)) continue
    if (/^(javascript:|mailto:|tel:)/i.test(rawHref)) continue
    let abs: string
    try {
      abs = new URL(rawHref, baseUrl).toString()
    } catch {
      continue
    }
    if (seen.has(abs)) continue
    seen.add(abs)
    // date: from the link text, else the 60 chars after the anchor
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 60)
    const ctx = `${text} ${after}`
    const dm =
      ctx.match(/(\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2})/) ??
      ctx.match(/(\d{1,2}月\d{1,2}[日號])/) ??
      ctx.match(/(\d{4}-\d{2}-\d{2})/)
    let date: string | null = null
    if (dm) {
      const n = dm[1].match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
      if (n) date = toIso(parseInt(n[1], 10), parseInt(n[2], 10), parseInt(n[3], 10))
      else {
        const ym = dm[1].match(/(\d{1,2})月(\d{1,2})/)
        if (ym) date = resolveYearless(parseInt(ym[1], 10), parseInt(ym[2], 10), new Date())
      }
    }
    items.push({ source, title: text.slice(0, 120), url: abs, date })
  }
  return items
}

export const WATCH_STATE_PATH = join(REPO_ROOT, "job_scraper", "watch_state.json")

export async function loadWatchState(): Promise<Record<string, string>> {
  try {
    const f = Bun.file(WATCH_STATE_PATH)
    if (await f.exists()) return JSON.parse(await f.text())
  } catch {
    // corrupted state = start fresh
  }
  return {}
}

export async function saveWatchState(state: Record<string, string>): Promise<void> {
  await Bun.write(WATCH_STATE_PATH, JSON.stringify(state, null, 2))
}

/** Default location of the user-maintained WeChat article URL list. */
export const URLS_FILE_PATH = join(DEFAULT_INBOX, "urls.txt")

/**
 * Gov sites reject proxy exits, and bun's fetch ignores NO_PROXY — so when a
 * watch target fails through fetch, fall back to curl with proxy disabled
 * (direct connection), then plain curl as a last resort.
 */
export async function govFetch(url: string): Promise<string> {
  try {
    const html = await htmlFetch(url)
    if (html) return html
  } catch {
    // fall through to curl
  }
  for (const args of [
    ["--noproxy", "*"],
    [],
  ]) {
    try {
      const proc = Bun.spawn(
        ["curl", "-s", "-L", ...args, "--max-time", "30", "-A", UA, url],
        { stdout: "pipe", stderr: "pipe" },
      )
      const [out, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      if (exit === 0 && out.trim()) return out
    } catch {
      // try next strategy
    }
  }
  return ""
}
