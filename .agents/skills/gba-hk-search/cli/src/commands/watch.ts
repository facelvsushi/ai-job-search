import {
  loadWatchTargets,
  extractPageLinks,
  loadWatchState,
  saveWatchState,
  govFetch,
  writeError,
  type WatchItem,
} from "../helpers.js"

export interface WatchOpts {
  format: "json" | "table" | "plain"
  all: boolean // emit every seen item, not just new ones
}

/**
 * Poll the gov recruitment pages listed in watchlist.md, extract article
 * links carrying recruitment keywords, and diff against watch_state.json.
 * First run reports everything as new (state seeding).
 */
export async function runWatch(opts: WatchOpts): Promise<number> {
  try {
    const targets = await loadWatchTargets()
    if (targets.length === 0) {
      writeError(
        "no watch targets — add `- 名称 | https://...` lines to .agents/skills/gba-hk-search/watchlist.md",
        "NO_TARGETS",
      )
      return 1
    }

    const state = await loadWatchState()
    const today = new Date().toISOString().slice(0, 10)
    const all: WatchItem[] = []
    const fresh: WatchItem[] = []
    const errors: string[] = []

    for (const target of targets) {
      const html = await govFetch(target.url)
      if (!html) {
        errors.push(`${target.name}: fetch failed (direct + proxied curl both empty)`)
        continue
      }
      for (const item of extractPageLinks(html, target.url, target.name)) {
        all.push(item)
        if (!state[item.url]) {
          fresh.push(item)
        }
      }
    }

    // record everything seen this run
    for (const item of all) {
      if (!state[item.url]) state[item.url] = today
    }
    if (!opts.all) await saveWatchState(state)

    const emit = opts.all ? all : fresh
    const meta = {
      targets: targets.length,
      items_seen: all.length,
      new_items: fresh.length,
      errors,
      note: opts.all ? "state unchanged (--all)" : "state updated",
    }

    if (opts.format === "table") {
      if (emit.length === 0) process.stdout.write("No recruitment links found (or nothing new).\n")
      else {
        const rows = emit.map(
          (r) => `${r.source}  |  ${(r.date ?? "—").padEnd(10)}  |  ${r.title.slice(0, 60)}\n    ${r.url}`,
        )
        process.stdout.write(rows.join("\n") + "\n")
      }
      if (errors.length) process.stdout.write(`\nerrors:\n  ${errors.join("\n  ")}\n`)
    } else {
      process.stdout.write(JSON.stringify({ meta, items: emit }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "WATCH_FAILED")
    return 1
  }
}
