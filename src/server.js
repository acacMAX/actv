import express from 'express';
import cors from 'cors';
import axios from 'axios';
import pino from 'pino';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

app.use(cors());
app.use(express.json());
app.use(express.static('public', { maxAge: '7d', etag: true, cacheControl: true }));

// 简易内存缓存
const cache = new Map(); // key -> { expireAt, data }
function getCache(key) { const v = cache.get(key); if (v && v.expireAt > Date.now()) return v.data; cache.delete(key); return null; }
function setCache(key, data, ttlMs = 60_000) { cache.set(key, { expireAt: Date.now() + ttlMs, data }); }

// Utility: HTTP client with timeout and UA（部分资源站会校验 Referer，在具体请求里按源补充）
const http = axios.create({
	timeout: 12000,
	headers: {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
		Accept: 'application/json, text/plain, */*'
	}
});

// Source adapters（优先 suggest 接口以获取封面；资源站常换域名，失效时请按苹果CMS接口自行替换 base）
const sources = [
	{ name: '天天影视', base: 'https://www.tttv01.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '秒看', base: 'https://miaokan.cc', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: 'HD电影', base: 'https://www.hd-dy.cc', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '3Q影视', base: 'https://qqqys.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '小红影视', base: 'https://www.xiaohys.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] }
];

function buildTryUrls(source, wd) {
	return source.patterns.map(p => `${source.base}${p.replace('{wd}', encodeURIComponent(wd))}`);
}

function absolutifyCover(cover, base) {
	if (!cover) return '';
	const c = String(cover).trim();
	if (/^https?:\/\//i.test(c)) return c;
	if (/^\/\//.test(c)) return `https:${c}`;
	if (c.startsWith('/')) return `${base}${c}`;
	return `${base}/${c}`;
}

function findSourceByName(name) { return sources.find(s => s.name === name); }

function normalizeVodItem(item, source) {
	const rawCover = item.pic || item.vod_pic || item.cover || item.img || '';
	const cover = absolutifyCover(rawCover, source.base);
	const title = item.name || item.vod_name || item.title || '';
	const year = item.year || item.vod_year || item.publish_year || '';
	const type = item.type || item.type_name || item.vod_class || '';
	const searchUrl = `${source.base}/index.php/vod/search.html?wd=${encodeURIComponent(title)}`;
	const id = String(item.id || item.vod_id || item.sid || `${source.name}-${title}`);
	const detailApi = `${source.base}/api.php/provide/vod/?ac=detail&ids=${encodeURIComponent(id)}`;
	return { source: source.name, title, cover, year, type, remarks: item.note || item.vod_remarks || item.remarks || '', id, detailApi, openUrl: searchUrl };
}

function extractList(data) {
	if (!data || typeof data !== 'object') return [];
	if (Array.isArray(data)) return data;
	const list = data.list ?? data.data ?? data.result ?? data.res ?? data.vod_list ?? data.vodlist ?? data.vod;
	if (Array.isArray(list)) return list;
	// 部分站点把列表放在单键对象里
	for (const v of Object.values(data)) {
		if (Array.isArray(v) && v.length && (v[0]?.vod_name != null || v[0]?.name != null)) return v;
	}
	return [];
}

async function fetchFromSource(source, wd) {
	const urls = buildTryUrls(source, wd);
	const headers = { Referer: source.base + '/', Origin: new URL(source.base).origin };
	for (const url of urls) {
		try {
			const { data } = await http.get(url, { headers });
			const list = extractList(data);
			if (list.length) return list.slice(0, 20).map(v => normalizeVodItem(v, source));
		} catch (err) {
			const msg = err.response?.status ? `HTTP ${err.response.status}` : err.code || err.message || 'unknown';
			logger.warn({ source: source.name, url: url.slice(0, 60), err: msg }, 'source fetch failed');
		}
	}
	return [];
}

function dedupe(items) {
	const seen = new Set();
	const out = [];
	for (const it of items) {
		const key = `${it.title}|${it.cover}`;
		if (seen.has(key)) continue;
		seen.add(key); out.push(it);
	}
	return out;
}

app.get('/api/search', async (req, res) => {
	const wd = String(req.query.wd || '').trim();
	const mode = String(req.query.mode || 'full'); // full | fast
	if (!wd) return res.status(400).json({ code: 400, msg: '缺少参数 wd' });
	const cacheKey = `${mode}:${wd}`;
	const cached = getCache(cacheKey);
	if (cached) return res.json(cached);
	const started = Date.now();
	try {
		if (mode === 'fast') {
			// 竞速返回：按源并发，请求至多前 2 个成功源后立即返回
			let collected = [];
			let resolvedCount = 0;
			await Promise.race([
				Promise.all(sources.map(async (src) => {
					const r = await fetchFromSource(src, wd);
					if (r.length) {
						collected = dedupe(collected.concat(r));
						resolvedCount++;
					}
					// 当已拿到两个以上源，短路
					if (resolvedCount >= 2) throw new Error('FAST_DONE');
				})),
				new Promise((_, reject) => setTimeout(() => reject(new Error('FAST_TIMEOUT')), 2500))
			]).catch(() => {});
			const resp = { code: 0, tookMs: Date.now() - started, count: collected.length, list: collected };
			setCache(cacheKey, resp, 20_000);
			return res.json(resp);
		}
		// full 模式：等待所有源（设置总超时）
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 7000);
		const tasks = sources.map(src => fetchFromSource(src, wd));
		const results = await Promise.allSettled(tasks);
		clearTimeout(timer);
		const items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
		const deduped = dedupe(items);
		const resp = { code: 0, tookMs: Date.now() - started, count: deduped.length, list: deduped };
		setCache(cacheKey, resp, 60_000);
		res.json(resp);
	} catch (e) {
		res.status(500).json({ code: 500, msg: '搜索失败' });
	}
});

function splitPlayBlocks(str) {
	return String(str || '').split('$$$').map(s => s.trim()).filter(Boolean);
}

function absolutifyPlayUrl(url, baseOrigin) {
	if (!url || typeof url !== 'string') return '';
	const u = url.trim();
	if (/^https?:\/\//i.test(u)) return u;
	if (/^\/\//.test(u)) return `https:${u}`;
	try {
		return new URL(u, baseOrigin).href;
	} catch {
		return u.startsWith('/') ? `${baseOrigin}${u}` : `${baseOrigin}/${u}`;
	}
}

function parseEpisodesPreferM3u8(item, baseOrigin = '') {
	const playFrom = item.vod_play_from ?? item.play_from ?? item.play_from_name ?? '';
	const playUrl = item.vod_play_url ?? item.play_url ?? item.play_url_name ?? '';
	const froms = splitPlayBlocks(playFrom);
	const urlsBlocks = splitPlayBlocks(playUrl);
	// 对齐 from 与 url，以包含 m3u8 的来源优先
	let pairs = froms.map((f, idx) => ({ from: (f || '').toLowerCase(), raw: urlsBlocks[idx] || '' }));
	if (pairs.every(p => !p.raw) && urlsBlocks.length > 0) {
		// 仅有 vod_play_url 无 from 时，当作单组
		pairs = [{ from: '', raw: urlsBlocks[0] || '' }];
	}
	pairs.sort((a, b) => {
		const as = a.from.includes('m3u8') ? 0 : 1;
		const bs = b.from.includes('m3u8') ? 0 : 1;
		return as - bs;
	});
	for (const p of pairs) {
		const eps = String(p.raw).split('#').map(x => x.trim()).filter(Boolean).map(seg => {
			const dollarIdx = seg.indexOf('$');
			const name = dollarIdx >= 0 ? seg.slice(0, dollarIdx).trim() : '第1集';
			const url = dollarIdx >= 0 ? seg.slice(dollarIdx + 1).trim() : seg;
			const absUrl = baseOrigin ? absolutifyPlayUrl(url, baseOrigin) : url;
			return { name: name || '第1集', url: absUrl };
		}).filter(ep => ep.url);
		if (eps.length) return eps;
	}
	return [];
}

async function tryExtractM3u8FromPage(pageUrl) {
	try {
		const { data } = await axios.get(pageUrl, {
			timeout: 8000,
			headers: {
				Referer: new URL(pageUrl).origin + '/',
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
			}
		});
		const html = typeof data === 'string' ? data : (data && typeof data === 'object' ? JSON.stringify(data) : '');
		if (!html) return '';
		// 多种常见 m3u8 出现形式
		const patterns = [
			/(?:url|src|link)\s*[:=]\s*["'](https?:[^"']+\.m3u8[^"']*)["']/i,
			/(?:url|src)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
			/(https?:[^"'<>\s]+\.m3u8[^"'<>\s]*)/i,
			/["']([^"']*\.m3u8[^"']*)["']/i
		];
		for (const reg of patterns) {
			const m = reg.exec(html);
			if (m && m[1]) {
				let u = m[1].replace(/\\u002f/g, '/').trim();
				if (!/^https?:\/\//i.test(u)) u = new URL(u, pageUrl).href;
				return u;
			}
		}
		return '';
	} catch { return ''; }
}

app.get('/api/detail', async (req, res) => {
	const sourceName = String(req.query.source || '');
	const id = String(req.query.id || '');
	if (!sourceName || !id) return res.status(400).json({ code: 400, msg: '缺少 source 或 id' });
	const src = findSourceByName(sourceName);
	if (!src) return res.status(400).json({ code: 400, msg: '未知的来源' });
	const url = `${src.base}/api.php/provide/vod/?ac=detail&ids=${encodeURIComponent(id)}`;
	const headers = { Referer: src.base + '/', Origin: new URL(src.base).origin };
	try {
		const { data } = await http.get(url, { headers });
		// 兼容 list[0]、data[0]、单对象直接返回
		let list = data?.list ?? data?.data;
		if (!Array.isArray(list) || list.length === 0) {
			const single = data?.vod ?? data?.info ?? (data?.vod_id != null || data?.vod_name != null ? data : null);
			list = single ? [single] : [];
		}
		const item = list.length ? list[0] : null;
		if (!item) return res.json({ code: 0, title: '', episodes: [] });
		const baseOrigin = new URL(src.base).origin;
		let episodes = parseEpisodesPreferM3u8(item, baseOrigin);
		const fallbackUrls = []; // 非 m3u8 的播放页，供 /stream 再尝试解析
		for (let i = 0; i < episodes.length; i++) {
			const ep = episodes[i];
			if (!/\.m3u8(\?.*)?$/i.test(ep.url)) {
				const found = await tryExtractM3u8FromPage(ep.url);
				if (found) ep.url = found; else { fallbackUrls.push({ name: ep.name, url: ep.url }); ep.url = ''; }
			}
		}
		let finalList = episodes.filter(ep => !!ep.url && /\.m3u8(\?.*)?$/i.test(ep.url));
		// 若没有解析出任何 m3u8，仍返回播放页链接，前端通过 /stream 打开时可由服务端再尝试从页面提取
		if (finalList.length === 0 && fallbackUrls.length > 0) finalList = fallbackUrls;
		res.json({ code: 0, title: item.vod_name || item.name || item.title || '', episodes: finalList });
	} catch (e) {
		logger.warn({ err: e.message, source: sourceName, id }, 'detail fetch failed');
		res.status(500).json({ code: 500, msg: '获取详情失败' });
	}
});

app.get('/img', async (req, res) => {
	const src = String(req.query.src || '');
	if (!src) return res.redirect('/placeholder.svg');
	try {
		const upstream = await axios.get(src, {
			responseType: 'stream',
			timeout: 8000,
			headers: {
				Referer: new URL(src).origin,
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
			}
		});
		res.setHeader('Cache-Control', 'public, max-age=86400');
		if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
		upstream.data.pipe(res);
	} catch (err) {
		res.redirect('/placeholder.svg');
	}
});

app.get('/stream', async (req, res) => {
	const url = String(req.query.url || '');
	if (!url) return res.status(400).send('missing url');
	try {
		const headers = { Referer: new URL(url).origin, 'User-Agent': 'Mozilla/5.0' };
		const isM3u8Hint = /\.m3u8(\?.*)?$/i.test(url);
		const head = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, headers });
		const contentType = (head.headers['content-type'] || '').toLowerCase();
		const isHtml = contentType.includes('text/html');
		const looksM3u8 = contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl') || contentType.includes('vnd.apple.mpegurl') || contentType.includes('audio/mpegurl') || contentType.includes('application/mpegurl') || contentType.includes('text') || isM3u8Hint;
		if (looksM3u8) {
			const text = Buffer.from(head.data).toString('utf8');
			const base = new URL(url);
			const rewritten = text.split(/\r?\n/).map(line => {
				const s = line.trim();
				if (!s || s.startsWith('#')) return line;
				try { const abs = new URL(s, base).toString(); return `/stream?url=${encodeURIComponent(abs)}`; } catch { return line; }
			}).join('\n');
			res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
			res.setHeader('Cache-Control', 'no-cache');
			return res.send(rewritten);
		}
		if (isHtml) {
			const html = Buffer.from(head.data).toString('utf8');
			const patterns = [
				/(?:url|src|link)\s*[:=]\s*["'](https?:[^"']+\.m3u8[^"']*)["']/i,
				/(?:url|src)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
				/(https?:[^"'<>\s]+\.m3u8[^"'<>\s]*)/i,
				/["']([^"']*\.m3u8[^"']*)["']/i
			];
			for (const reg of patterns) {
				const m = reg.exec(html);
				if (m && m[1]) {
					let u = m[1].replace(/\\u002f/g, '/').trim();
					if (!/^https?:\/\//i.test(u)) u = new URL(u, url).href;
					return res.redirect(302, `/stream?url=${encodeURIComponent(u)}`);
				}
			}
		}
		res.setHeader('Cache-Control', 'no-cache');
		if (contentType) res.setHeader('Content-Type', contentType);
		return res.end(head.data);
	} catch (e) {
		return res.status(502).send('bad gateway');
	}
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
	console.log(`server running on http://localhost:${PORT}`);
}); 