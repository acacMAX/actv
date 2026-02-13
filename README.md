# acTV · 聚合影视搜索

acTV 是一个轻量的聚合影视搜索网站：前端提供简洁的中心搜索框与自适应卡片网格；后端并行请求多个资源站采集源，统一标准化结果、去重合并后返回，让你用一个关键词即可在多个站点间快速比对与直达播放。

##官方提供网站
- actv.qzz.io

## 功能特性
- 聚合检索：一次搜索，横跨多个资源站点
- 去重整合：统一数据结构，智能去重合并
- 即点即播：内置 HLS 播放（m3u8），支持收藏
- 快速/完整：快速模式优先返回速度，完整模式获取更多结果
- 纯前后端分离：前端静态页，后端 Node.js API

## 本地启动
1. 安装 Node.js 18+
2. 安装依赖：
```bash
npm install
```
3. 运行服务：
```bash
npm start
```
访问 `http://localhost:3000`，输入关键词搜索。

## 部署与环境变量
- 直接在任意 Node.js 18+ 环境运行 `npm start`
- 常用环境变量（可选）：
  - `PORT`：服务监听端口，默认 `3000`
  - `LOG_LEVEL`：日志级别（如 `info`/`debug`），默认 `info`

## API 说明
- GET `/api/search?wd=关键词&mode=fast|full`
  - 返回：`{ code, tookMs, count, list: [{source,title,cover,year,type,remarks,id}] }`
  - 示例：
```bash
curl "http://localhost:3000/api/search?wd=三体&mode=fast"
```
- GET `/api/detail?source=来源标识&id=资源ID`
  - 返回：`{ title, episodes: [{ name, url }], ... }`

## 配置采集源
- **本地 / Node 部署**：源列表在 `src/server.js` 的 `sources` 数组。
- **Cloudflare Pages 部署**：实际运行的是 `functions/` 下的 Pages Functions，源在 `functions/api/search.js` 与 `functions/api/detail.js` 的 `getSources()` 中，修改源或解析逻辑时需两处同步（或先改 `src/server.js` 再同步到 `functions/`）。
- 如遇站点接口变更，可调整 `patterns`，常见为：
  - `/api.php/provide/vod/?ac=list&wd={wd}`
  - `/index.php/ajax/suggest?mid=1&wd={wd}`

### 源失效排查
- 资源站域名经常更换或下线，若某源不可用属正常现象。
- 启动时设置 `LOG_LEVEL=debug` 或在搜索时查看控制台：每个失败的源会打印 `source fetch failed` 及原因（如 HTTP 404、超时等）。
- 可自行替换/新增 `sources` 中的 `base` 为当前可用的苹果 CMS 资源站地址；接口规范参考 [苹果CMS 采集接口](https://www.maccms.plus/api/collect.html)。

仅用于学习与聚合检索演示，请遵守各站点协议与法律法规。
