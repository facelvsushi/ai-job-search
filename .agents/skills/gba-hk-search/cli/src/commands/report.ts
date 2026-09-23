import {
  fetchGbayes,
  hydrateCards,
  wechatResults,
  dedupById,
  type SearchOpts,
} from "./search.js"
import { REPO_ROOT, writeError } from "../helpers.js"
import { join } from "path"

export interface ReportOpts {
  pages: number
  limit: number // 0 = all
  lang: string
  wechat: boolean
  out: string // "" = default location
  open: boolean
}

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

function row(r: Record<string, unknown>): string {
  const title = esc(r.title)
  const url = r.url ? esc(r.url) : ""
  const source = esc(r.source)
  const isGba = String(r.source) === "gbayes"
  const badge = isGba
    ? '<span class="badge gba">计划官方</span>'
    : `<span class="badge wx">${source.replace(/^wechat:/, "公众号·")}</span>`
  const link = url
    ? `<a href="${url}" target="_blank" rel="noopener">${title}</a>`
    : title
  return `<tr data-text="${esc(`${r.title} ${r.company ?? ""} ${r.location ?? ""} ${r.salary ?? ""}`)}">
    <td class="t">${link}<div class="sub">${badge}${r._article ? `<span class="art">${esc(r._article)}</span>` : ""}</div></td>
    <td>${esc(r.company ?? "—")}</td>
    <td>${esc(r.location ?? "—")}</td>
    <td class="sal">${esc(r.salary ?? "—")}</td>
    <td>${esc(r.date ?? "—")}</td>
    <td class="dl">${esc(r.deadline ?? "—")}</td>
  </tr>`
}

function page(results: Record<string, unknown>[], meta: { pages: number; wechatArticles: number }): string {
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false })
  const gbaCount = results.filter((r) => r.source === "gbayes").length
  const wxCount = results.length - gbaCount
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>大湾区青年就业计划 · 岗位看板</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 "Microsoft YaHei", system-ui, sans-serif; margin: 0; padding: 24px; background: #f6f7f9; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 14px; }
  input { width: 100%; max-width: 420px; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 14px; }
  th { background: #fafbfc; font-weight: 600; color: #444; white-space: nowrap; }
  tr:hover td { background: #f8fbff; }
  a { color: #0b5cad; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .sub { margin-top: 3px; font-size: 12px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; margin-right: 6px; }
  .badge.gba { background: #e6f0fb; color: #0b5cad; }
  .badge.wx { background: #e8f7ec; color: #1a7f37; }
  .art { color: #999; }
  .sal { white-space: nowrap; color: #1a7f37; }
  .dl { white-space: nowrap; font-weight: 600; color: #b3261e; }
  .dl:empty::before { content: "—"; }
  .note { margin-top: 14px; color: #777; font-size: 12px; line-height: 1.7; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6; }
    table { background: #1e2126; box-shadow: none; }
    th { background: #23262c; color: #bbb; }
    td, th { border-color: #2c2f36; }
    tr:hover td { background: #23262c; }
    a { color: #6cb0f5; }
    input { background: #1e2126; color: #e6e6e6; border-color: #3a3f47; }
    .badge.gba { background: #1c2c40; color: #6cb0f5; }
    .badge.wx { background: #17301f; color: #5cc98a; }
    .sal { color: #5cc98a; }
    .dl { color: #f28b82; }
  }
</style>
</head>
<body>
<h1>大湾区青年就业计划 · 岗位看板</h1>
<div class="meta">生成时间 ${stamp} ｜ 共 ${results.length} 个岗位（官方职位库 ${gbaCount} · 公众号 ${wxCount}）｜ 扫描官方库前 ${meta.pages} 页</div>
<input id="q" type="search" placeholder="输入关键词过滤（岗位/公司/地点/薪资）…">
<table>
<thead><tr><th>岗位</th><th>公司</th><th>地点</th><th>月薪</th><th>刊登</th><th>截止报名</th></tr></thead>
<tbody id="tb">
${results.map(row).join("\n")}
</tbody>
</table>
<div class="note">
  点击岗位名直达官方职位详情页（含职责、要求、申请邮箱）。官方职位库没有截止日期字段，所以「截止报名」多为空——
  公众号来源的文章（前海/南沙/横琴专项）才带截止日期。<br>
  数据源：香港劳工处「大湾区青年就业计划」职位库 + 你投喂的公众号文章。重新生成：双击桌面「大湾区岗位.bat」。
</div>
<script>
  const q = document.getElementById('q'), rows = [...document.querySelectorAll('#tb tr')];
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    for (const r of rows) r.style.display = !v || r.dataset.text.toLowerCase().includes(v) ? '' : 'none';
  });
</script>
</body>
</html>`
}

export async function runReport(opts: ReportOpts): Promise<number> {
  try {
    const searchOpts: SearchOpts = {
      lang: opts.lang,
      page: 1,
      pages: opts.pages,
      limit: opts.limit > 0 ? opts.limit : undefined,
      format: "json",
      hydrate: true,
      wechat: opts.wechat,
    }

    const cards = await fetchGbayes(searchOpts)
    const sliced = opts.limit > 0 ? cards.slice(0, opts.limit) : cards
    await hydrateCards(sliced)
    const gba = sliced.map((c) => ({
      id: `gbayes:${c.id}`,
      title: c.title,
      company: c.company ?? null,
      location: c.location,
      date: c.date ?? null,
      deadline: null,
      url: c.url || null,
      salary: c.salary,
      source: "gbayes",
    }))

    let wechat: Record<string, unknown>[] = []
    let wechatArticles = 0
    if (opts.wechat) {
      const w = await wechatResults()
      wechat = w.results
      wechatArticles = w.articles
    }

    const results = dedupById([...gba, ...wechat])
    const html = page(results, { pages: opts.pages, wechatArticles })

    const out = opts.out || join(REPO_ROOT, "documents", `gba-jobs-${new Date().toISOString().slice(0, 10)}.html`)
    await Bun.write(out, html)

    process.stdout.write(
      `生成完成：${out}\n共 ${results.length} 个岗位（官方 ${gba.length} · 公众号 ${wechat.length}）\n`,
    )

    if (opts.open) {
      // Windows: hand the file to the default browser
      try {
        Bun.spawn(["cmd", "/c", "start", "", out], { stdout: "ignore", stderr: "ignore" })
      } catch {
        // opening is best-effort
      }
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "REPORT_FAILED")
    return 1
  }
}
