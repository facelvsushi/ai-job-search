# gba-hk-search watchlist（用户可编辑）

## 资格关键词门（CLI 运行时读取）

文章正文/标题命中以下任意一个词才会入库，防止面向内地求职者的普通岗位混进结果。
逗号、顿号、竖线分隔均可，随意增删：

keywords: 港澳居民, 香港青年, 回乡证, 回鄉證, 大湾区青年就业计划, 大灣區青年就業計劃, 港澳青年, 港澳学生, 港人

## 公众号关注清单（供 wechat-article-exporter 导出时参考，CLI 不读取）

| 公众号 | 为什么关注 |
|---|---|
| 深圳人社 | 深圳港澳青年就业计划补贴、专场招聘通知 |
| 广东人社（广东人社厅） | 省级大湾区就业政策与招聘会 |
| 前海控股 / 前海港澳e站通 | 前海港澳青年招聘计划岗位（无公开列表页，只在此发布） |
| 香港工会联合会（内地服务中心） | 面向港人的内地职位汇总 |
| 南沙发布 / 横琴在线 | 南沙、横琴港澳专项（随缘出现，命中关键词门才入库） |

自行添加即可——导出文章丢进 `job_scraper/wechat_inbox/`，跑 `ingest`。

## 微信文章 URL 投喂（wechat-article-exporter 的防断供替代）

公众号批量导出工具随时可能被微信接口变更弄死（exporter 已死于 2026-09）。
保底方案：**在微信里关注上表公众号 → 推文到了复制链接 → 粘贴进
`job_scraper/wechat_inbox/urls.txt`（每行一条，# 开头是注释）→ 跑 `ingest --urls`**。
文章正文页免登录可读（2026-09-18 实测），这条路不依赖任何会失效的接口。

## watch 政府网站列表（CLI 运行时读取，`- 名称 | URL` 格式）

watch:
- 深圳人社 | https://hrss.sz.gov.cn/
- 前海管理局 | https://qh.sz.gov.cn/
- 南沙区政府 | https://www.gzns.gov.cn/
- 横琴粤澳深度合作区 | https://www.hengqin.gov.cn/

（已验证可直连 2026-09-20。www.qianhai.gov.cn 与 hrss.gd.gov.cn 直连失败——
前者可先用 qh.sz.gov.cn 替代，后者暂缓。政府站拒绝代理出口：fetch 失败时设置
`$env:NO_PROXY="*.gov.cn"` 再跑。）
