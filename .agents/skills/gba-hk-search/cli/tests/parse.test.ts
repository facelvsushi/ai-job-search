import { describe, test, expect } from "bun:test";
import {
  parseListingCards,
  parseGbaDetail,
  extractDeadline,
  extractPostings,
  parseWechatMarkdown,
  detectCities,
  dmyToIso,
  matchesGate,
} from "../src/helpers.js";

// ------- fixtures (structure mirrors live jobs.gov.hk gbayes markup, 2026-09-18 recon)

const LISTING_HTML = `
<div id="job_list_table">
  <div class="row item p-1 no-gutters" data-roworder="1" data-prev="" data-jobcard="/0/tc/jobseeker/jobCard/?order=AbCdEf123&amp;from=quickview&amp;for=gbayes">
    <div class="col">
      <div class="d-flex justify-content-between pb-2">
        <div>營銷運營主任 (Marketing Operations)</div>
        <a href="#" data-ordno="11-26-0011957"><input type="hidden" value="11-26-0011957"></a>
      </div>
      <div class="menu_icon icon_salary pb-2">HK$18,000 - HK$22,000 （月薪）</div>
      <div class="menu_icon icon_address pb-2">深圳</div>
    </div>
  </div>
  <div class="row item p-1 no-gutters" data-roworder="2" data-prev="11-26-0011957" data-jobcard="/0/tc/jobseeker/jobCard/?order=XyZ789&amp;from=quickview&amp;for=gbayes">
    <div class="col">
      <div class="d-flex justify-content-between pb-2">
        <div>采購員（電商）</div>
        <a href="#" data-ordno="11-26-0012345"><input type="hidden" value="11-26-0012345"></a>
      </div>
      <div class="menu_icon icon_salary pb-2">人民幣20,000-29,999</div>
      <div class="menu_icon icon_address pb-2">廣州</div>
    </div>
  </div>
</div>`;

const DETAIL_HTML = `
<div id="postedDt">18/09/2026</div>
<h1 id="jobTitle">營銷運營主任</h1>
<div id="empName">JINGDONG E-COMMERCE (HONG KONG) LIMITED</div>
<div id="locDesc">深圳</div>
<div id="indsDesc">零售業</div>
<div id="jobRemark">負責品類營銷策劃、活動執行。</div>
<div id="eduRemark">學士學位，歡迎應屆畢業生。</div>
<div id="empTerm">全職</div>
<div id="openupRemark">經「大灣區青年就業計劃」網站申請。</div>
<div id="propRemark">須持有香港居民身份。</div>`;

// wechat-article-exporter style markdown with two numbered postings
const WECHAT_MD = `---
title: 前海港澳青年專場招聘來了
author: 深圳人社
date: 2026-09-10
url: https://mp.weixin.qq.com/s/AbCdEfGh12345678
---

# 前海港澳青年專場招聘來了

深圳前海面向港澳青年發布一批崗位，歡迎持回鄉證的香港青年報名。

1、跨境電商運營專員 前海某科技企業 月薪10k-15k
工作地點：深圳前海
報名截止2026年9月30日。

2、行政助理 某港資企業
工作地點：深圳
报名截止: 2026-10-15。

名額有限，招滿即止。`;

describe("gbayes listing parsing", () => {
  test("extracts id, title, url, salary, location per card", () => {
    const cards = parseListingCards(LISTING_HTML);
    expect(cards.length).toBe(2);
    expect(cards[0].id).toBe("11-26-0011957");
    expect(cards[0].title).toContain("營銷運營主任");
    expect(cards[0].url).toBe(
      "https://www2.jobs.gov.hk/0/tc/jobseeker/jobCard/?order=AbCdEf123&from=quickview&for=gbayes",
    );
    expect(cards[0].salary).toContain("18,000");
    expect(cards[0].location).toBe("深圳");
    expect(cards[1].id).toBe("11-26-0012345");
  });
});

describe("gbayes detail parsing", () => {
  test("extracts all id-anchored fields and normalizes DD/MM/YYYY", () => {
    const d = parseGbaDetail(DETAIL_HTML);
    expect(d.title).toBe("營銷運營主任");
    expect(d.company).toContain("JINGDONG");
    expect(d.date).toBe("2026-09-18");
    expect(d.location).toBe("深圳");
    expect(d.apply).toContain("大灣區青年就業計劃");
    expect(d.eligibility).toContain("香港居民");
  });
});

describe("deadline extraction", () => {
  test("full ISO and 年月日 forms", () => {
    expect(extractDeadline("報名截止2026年9月30日。", "2026-09-10")).toBe("2026-09-30");
    expect(extractDeadline("报名截止: 2026-10-15。", "2026-09-10")).toBe("2026-10-15");
    expect(extractDeadline("申請截止 30/9/2026", "2026-09-01")).toBe("2026-09-30");
  });

  test("year-less dates resolve forward from the base date", () => {
    expect(extractDeadline("截止日期：10月8日", "2026-09-10")).toBe("2026-10-08");
    expect(extractDeadline("截止日期：3月1日", "2026-09-10")).toBe("2027-03-01");
  });

  test("dates without a trigger word are ignored", () => {
    expect(extractDeadline("公司成立於2020年5月1日，發布於2026-09-10", "2026-09-10")).toBeNull();
    expect(extractDeadline("沒有任何日期", null)).toBeNull();
  });

  test("dmyToIso handles HK listing dates", () => {
    expect(dmyToIso("18/09/2026")).toBe("2026-09-18");
    expect(dmyToIso(null)).toBeNull();
  });
});

describe("wechat article parsing", () => {
  const article = parseWechatMarkdown(WECHAT_MD, "fallback-name");

  test("front matter drives title/account/date/url", () => {
    expect(article.title).toContain("前海");
    expect(article.account).toBe("深圳人社");
    expect(article.publishDate).toBe("2026-09-10");
    expect(article.url).toBe("https://mp.weixin.qq.com/s/AbCdEfGh12345678");
  });

  test("eligibility gate matches on 回鄉證", () => {
    expect(matchesGate(article.body + article.title, ["回鄉證", "港澳居民"])).toBe(true);
    expect(matchesGate("完全普通嘅內地招聘文章", ["回鄉證", "港澳居民"])).toBe(false);
  });

  test("two numbered postings extracted with per-posting deadlines", () => {
    const postings = extractPostings(article);
    expect(postings.length).toBe(2);
    expect(postings[0].title).toContain("跨境電商運營專員");
    expect(postings[0].deadline).toBe("2026-09-30");
    expect(postings[0].location).toContain("深圳");
    expect(postings[1].title).toContain("行政助理");
    expect(postings[1].deadline).toBe("2026-10-15");
  });

  test("article without candidates becomes a single posting", () => {
    const single = parseWechatMarkdown(
      `---\ntitle: 某公司港人專場\nauthor: 港聯\n---\n\n誠聘銷售代表，工作地點廣州，截止2026年11月30日。`,
      "x",
    );
    const postings = extractPostings(single);
    expect(postings.length).toBe(1);
    expect(postings[0].deadline).toBe("2026-11-30");
    expect(postings[0].location).toContain("廣州");
  });
});

describe("city detection", () => {
  test("finds GBA cities including 前海", () => {
    expect(detectCities("工作地點：深圳前海保稅區")).toBe("深圳/前海");
    expect(detectCities("冇地方")).toBeNull();
  });
});
