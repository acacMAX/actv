# Changelog

本文档记录 acTV 项目的版本更新内容。

---

## [1.1.0] - 2025-02-13

### 视频源

- 移除原 15 个失效源（暴风、非凡、快看、乐视、量子、索尼、红牛、优质、鸭鸭、牛牛、OK、49、360、奇虎、飞速）
- 新增 5 个源：天天影视、秒看、HD电影、3Q影视、小红影视
- 请求增加 `Referer` / `Origin`，降低被源站拒绝概率
- 单次请求超时由 8s 调整为 12s
- 原 HTTP 源改为 HTTPS（非凡、量子等）

### 搜索与兼容

- 源请求失败时输出日志（`source fetch failed` + 原因），便于排查不可用源
- 响应解析支持更多字段：`list` / `data` / `result` / `res` / `vod_list` / `vodlist` / `vod` 及单键对象
- 新增 `extractList()` 统一从接口响应中抽取列表

### 详情与播放地址

- 播放列表支持更多字段名：`vod_play_from`、`play_from`、`play_from_name`；`vod_play_url`、`play_url`、`play_url_name`
- 相对播放地址自动补全为绝对地址（`absolutifyPlayUrl`）
- 仅存在 `vod_play_url`、无 `vod_play_from` 时按单组解析
- 集数格式兼容「名称$地址」及仅一个 `$` 的写法
- 详情接口兼容 `data.vod`、`data.info` 或根对象单条返回（不强制 `list[0]`）
- 从播放页抓 m3u8：多组正则匹配 HTML 中 `url` / `src` / `link` 等中的 m3u8 链接
- 无 m3u8 时仍返回播放页链接，由前端通过 `/stream` 再次尝试从页面解析
- `/stream` 遇到 HTML 时使用相同多正则提取 m3u8 并 302 跳转，提高「天天影视」等源的可用性

### 文档

- README 新增「源失效排查」说明
- 补充苹果 CMS 采集接口文档链接

---

格式说明：版本号与日期以 `[版本] - 日期` 标注；`[Unreleased]` 表示尚未打 tag 的当前改动。
