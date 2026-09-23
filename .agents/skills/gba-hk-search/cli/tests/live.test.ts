import { describe, test, expect } from "bun:test";
import { runCLI, parseJSON } from "./helpers.js";

// Live smoke test against www2.jobs.gov.hk (personal use, low volume:
// 1 listing page + up to 2 hydration fetches). robots.txt disallows these
// paths; the SKILL.md carries the personal-use-only warning.

describe("live gbayes", () => {
  test(
    "search returns real hydrated results",
    async () => {
      const res = await runCLI([
        "search",
        "--limit",
        "2",
        "--pages",
        "1",
        "--no-wechat",
        "--format",
        "json",
      ]);
      const data = parseJSON<{
        meta: { count: number; sources: { gbayes: number } };
        results: { id: string; title: string; url: string | null; company: string | null }[];
      }>(res);

      expect(res.exitCode).toBe(0);
      expect(data.meta.sources.gbayes).toBeGreaterThan(0);
      const first = data.results[0];
      expect(first.id).toMatch(/^gbayes:\d{2}-\d{2}-\d{7}$/);
      expect(first.title.length).toBeGreaterThan(2);
      expect(first.url).toContain("jobs.gov.hk");
      // hydration is the point of this check — company must be filled
      expect(first.company).toBeTruthy();
    },
    60000,
  );

  test(
    "detail on a fresh search URL returns readable fields",
    async () => {
      const search = await runCLI(["search", "--limit", "1", "--pages", "1", "--no-wechat", "--format", "json"]);
      const { results } = parseJSON<{ results: { url: string | null }[] }>(search);
      expect(results[0]?.url).toBeTruthy();

      const res = await runCLI(["detail", results[0].url as string, "--format", "json"]);
      const d = parseJSON<{ title: string | null; company: string | null; apply: string | null }>(res);
      expect(res.exitCode).toBe(0);
      expect(d.company).toBeTruthy();
    },
    60000,
  );
});
