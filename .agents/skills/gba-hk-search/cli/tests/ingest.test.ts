import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCLI, parseJSON } from "./helpers.js";

let inbox: string;

const ARTICLE_MD = `---
title: 南沙港澳青年專場
author: 南沙发布
date: 2026-09-12
url: https://mp.weixin.qq.com/s/NsHa1234567890
---

# 南沙港澳港澳青年專場

面向港澳居民的一批崗位，持回鄉證可報名。

1、電商運營助理
工作地點：廣州南沙
報名截止2026年10月20日。`;

const OFF_TOPIC_MD = `---
title: 周末食好西
author: 深圳美食
date: 2026-09-12
---

# 周末食好西

同你推薦十間好餐廳，完全唔關招聘事。`;

beforeAll(() => {
  inbox = join(mkdtempSync(join(tmpdir(), "gba-inbox-")), "wechat_inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "nansha__南沙港澳青年專場.md"), ARTICLE_MD);
  writeFileSync(join(inbox, "food__周末食好西.md"), OFF_TOPIC_MD);
});

afterAll(() => {
  rmSync(inbox, { recursive: true, force: true });
});

describe("ingest", () => {
  test("dry-run parses postings without moving files", async () => {
    const res = await runCLI(["ingest", "--inbox", inbox, "--dry-run", "--format", "json"]);
    const data = parseJSON<{ meta: Record<string, number>; results: Record<string, string>[] }>(res);

    expect(data.meta.articles).toBe(2);
    expect(data.meta.skipped_no_gate).toBe(1); // food article gated out
    expect(data.meta.moved).toBe(0);
    expect(data.results.length).toBe(1);
    expect(data.results[0].title).toContain("電商運營助理");
    expect(data.results[0].deadline).toBe("2026-10-20");
    expect(data.results[0].source).toBe("wechat:南沙发布");
    expect(data.results[0].url).toContain("mp.weixin.qq.com");
    expect(data.results[0].id).toMatch(/^wechat:南沙发布:/);
    // nothing moved
    expect(existsSync(join(inbox, "nansha__南沙港澳青年專場.md"))).toBe(true);
  });

  test("real run parses and archives to processed/", async () => {
    const res = await runCLI(["ingest", "--inbox", inbox, "--format", "json"]);
    const data = parseJSON<{ meta: Record<string, number>; results: unknown[] }>(res);

    expect(data.meta.moved).toBe(2);
    expect(existsSync(join(inbox, "nansha__南沙港澳青年專場.md"))).toBe(false);
    const archived = readFileSync(
      join(inbox, "processed", "nansha__南沙港澳青年專場.md"),
      "utf8",
    );
    expect(archived).toContain("電商運營助理");
    // gated-out file still archived (nothing left in root)
    expect(existsSync(join(inbox, "food__周末食好西.md"))).toBe(false);
  });

  test("re-ingest after archive yields no fresh inbox files (idempotent)", async () => {
    const res = await runCLI(["ingest", "--inbox", inbox, "--dry-run", "--format", "json"]);
    const data = parseJSON<{ meta: Record<string, number>; results: unknown[] }>(res);
    // processed/ files are re-parsed for output but nothing new is "in root"
    expect(data.meta.moved).toBe(0);
  });
});

describe("flag handling", () => {
  test("unknown flag exits 1 with JSON error on stderr", async () => {
    const res = await runCLI(["search", "--bogus", "x"]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stderr)).toHaveProperty("code", "UNKNOWN_FLAG");
  });

  test("missing detail argument exits 1", async () => {
    const res = await runCLI(["detail"]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stderr)).toHaveProperty("code", "NO_ID");
  });

  test("bare non-lookupable ordno exits 1 with BAD_ID", async () => {
    const res = await runCLI(["detail", "99-99-9999999", "--pages", "1"]);
    expect(res.exitCode).toBe(1);
    expect(JSON.parse(res.stderr)).toHaveProperty("code", "BAD_ID");
  });
});
