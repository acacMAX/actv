# 聚合影视搜索

一个简单的聚合搜索站点：前端中心搜索框 + 网格卡片；后端并行请求多个采集源，标准化结果并去重返回。

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

## 接口说明
- GET `/api/search?wd=关键词`
  - 返回：`{ code, tookMs, count, list: [{source,title,cover,year,type,remarks,id}] }`

## 配置采集源
- 源列表在 `src/server.js` 的 `sources` 数组。
- 如遇站点接口变更，可调整 `patterns`，常见为：
  - `/api.php/provide/vod/?ac=list&wd={wd}`
  - `/index.php/ajax/suggest?mid=1&wd={wd}`

仅用于学习与聚合检索演示，请遵守各站点协议与法律法规。 