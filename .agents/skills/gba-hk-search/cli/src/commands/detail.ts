import {
  listUrl,
  htmlFetch,
  parseListingCards,
  parseGbaDetail,
  writeError,
  BASE,
} from "../helpers.js"

export interface DetailOpts {
  idOrUrl: string
  lang: string
  pages: number
  format: "json" | "plain"
}

const looksLikeUrl = (s: string) => s.includes("jobCard") || s.includes("order=") || s.startsWith("http")
const ORDNO = /^\d{2}-\d{2}-\d{7}$/

/**
 * The listing page's data-jobcard URL carries a one-time order token that
 * cannot be reconstructed from the ordno alone. A bare ordno therefore
 * triggers a bounded re-scan of the listing pages to find a fresh token
 * (tokens can expire; the scan is the recovery path).
 */
async function resolveUrl(input: string, lang: string, pages: number): Promise<string | null> {
  if (looksLikeUrl(input)) {
    return input.startsWith("http") ? input : BASE + input
  }
  if (ORDNO.test(input)) {
    for (let p = 1; p <= pages; p++) {
      const html = await htmlFetch(listUrl(lang, p))
      if (!html) continue
      const card = parseListingCards(html).find((c) => c.id === input)
      if (card?.url) return card.url
    }
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const url = await resolveUrl(opts.idOrUrl, opts.lang, opts.pages)
    if (!url) {
      writeError(
        `"${opts.idOrUrl}" is neither a jobCard URL nor an ordno found on the first ${opts.pages} listing page(s). Pass the full URL from search results, or raise --pages.`,
        "BAD_ID",
      )
      return 1
    }
    const html = await htmlFetch(url)
    if (!html) {
      writeError("Job card not found (the order token may have expired — re-run search)", "NOT_FOUND")
      return 1
    }
    const d = parseGbaDetail(html)
    const job = {
      id: opts.idOrUrl,
      title: d.title,
      company: d.company,
      location: d.location,
      date: d.date,
      deadline: null, // the official source has no closing-date field
      url,
      source: "gbayes",
      industry: d.industry,
      duties: d.duties,
      requirements: d.requirements,
      terms: d.terms,
      apply: d.apply,
      eligibility: d.eligibility,
    }

    if (opts.format === "plain") {
      const lines = [
        job.title ?? "(untitled)",
        `${job.company ?? "—"} · ${job.location ?? "—"} · 刊登 ${job.date ?? "—"}`,
        job.industry ? `行业: ${job.industry}` : "",
        job.terms ? `雇佣条件: ${job.terms}` : "",
        "",
        job.duties ? `职责:\n${job.duties}` : "",
        job.requirements ? `要求:\n${job.requirements}` : "",
        job.apply ? `申请方式:\n${job.apply}` : "",
        job.eligibility ? `计划资格说明:\n${job.eligibility}` : "",
        "",
        `URL: ${job.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
