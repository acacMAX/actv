import express from 'express';
import cors from 'cors';
import axios from 'axios';
import pino from 'pino';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 简易内存缓存
const cache = new Map(); // key -> { expireAt, data }
function getCache(key) { const v = cache.get(key); if (v && v.expireAt > Date.now()) return v.data; cache.delete(key); return null; }
function setCache(key, data, ttlMs = 60_000) { cache.set(key, { expireAt: Date.now() + ttlMs, data }); }

// Utility: HTTP client with timeout and UA
const http = axios.create({
	// 8s timeout for remote sources
	timeout: 8000,
	headers: {
		'User-Agent':
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
	}
});

// Source adapters（优先使用 suggest 接口以获取封面）
const sources = [
	{ name: '暴风', base: 'https://publish.bfzy.tv', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '非凡', base: 'http://ffzy5.tv', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '快看', base: 'https://kuaikanzy.net', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '乐视', base: 'https://www.leshizy1.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '量子', base: 'http://lzizy.net', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '索尼', base: 'https://suonizy.net', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '红牛', base: 'https://hongniuziyuan.net', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '优质', base: 'https://1080zyk6.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '鸭鸭', base: 'https://yayazy.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '牛牛', base: 'https://niuniuzy.cc', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: 'OK', base: 'https://okzyw.vip', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '49', base: 'https://49zyw.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '360', base: 'https://360zy5.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
	{ name: '奇虎', base: 'https://qihuzy4.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] }
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

async function fetchFromSource(source, wd) {
	const urls = buildTryUrls(source, wd);
	for (const url of urls) {
		try {
			const { data } = await http.get(url);
			let list = [];
			if (Array.isArray(data)) list = data;
			else if (Array.isArray(data?.list)) list = data.list;
			else if (Array.isArray(data?.data)) list = data.data;
			else if (Array.isArray(data?.result)) list = data.result;
			else if (Array.isArray(data?.res)) list = data.res;
			if (list.length) return list.slice(0, 20).map(v => normalizeVodItem(v, source));
		} catch {}
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

function parseEpisodesPreferM3u8(item) {
	const froms = splitPlayBlocks(item.vod_play_from || item.play_from || '');
	const urlsBlocks = splitPlayBlocks(item.vod_play_url || item.play_url || '');
	// 对齐 from 与 url，以包含 m3u8 的来源优先
	let pairs = froms.map((f, idx) => ({ from: f.toLowerCase(), raw: urlsBlocks[idx] || '' }));
	pairs.sort((a, b) => {
		const as = a.from.includes('m3u8') ? 0 : 1;
		const bs = b.from.includes('m3u8') ? 0 : 1;
		return as - bs;
	});
	for (const p of pairs) {
		const eps = String(p.raw).split('#').map(x => x.trim()).filter(Boolean).map(seg => {
			const [name, url] = seg.split('$');
			return { name: name || '第1集', url: url || '' };
		}).filter(ep => ep.url);
		if (eps.length) return eps;
	}
	return [];
}

async function tryExtractM3u8FromPage(pageUrl) {
	try {
		const { data } = await axios.get(pageUrl, { timeout: 8000, headers: { Referer: new URL(pageUrl).origin, 'User-Agent': 'Mozilla/5.0' } });
		if (typeof data !== 'string') return '';
		const reg = /(https?:[^'"\s]+\.m3u8[^'"\s]*)/ig;
		const match = reg.exec(data);
		return match ? match[1] : '';
	} catch { return ''; }
}

app.get('/api/detail', async (req, res) => {
	const sourceName = String(req.query.source || '');
	const id = String(req.query.id || '');
	if (!sourceName || !id) return res.status(400).json({ code: 400, msg: '缺少 source 或 id' });
	const src = findSourceByName(sourceName);
	if (!src) return res.status(400).json({ code: 400, msg: '未知的来源' });
	const url = `${src.base}/api.php/provide/vod/?ac=detail&ids=${encodeURIComponent(id)}`;
	try {
		const { data } = await http.get(url);
		const list = data?.list || data?.data || [];
		const item = Array.isArray(list) && list.length ? list[0] : null;
		if (!item) return res.json({ code: 0, title: '', episodes: [] });
		let episodes = parseEpisodesPreferM3u8(item);
		for (let i = 0; i < episodes.length; i++) {
			const ep = episodes[i];
			if (!/\.m3u8(\?.*)?$/i.test(ep.url)) {
				const found = await tryExtractM3u8FromPage(ep.url);
				if (found) ep.url = found; else ep.url = '';
			}
		}
		episodes = episodes.filter(ep => !!ep.url && /\.m3u8(\?.*)?$/i.test(ep.url));
		res.json({ code: 0, title: item.vod_name || item.name || '', episodes });
	} catch (e) {
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
		const contentType = head.headers['content-type'] || '';
		const isHtml = contentType.includes('text/html');
		const looksM3u8 = contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegURL') || contentType.includes('vnd.apple.mpegurl') || (isM3u8Hint && contentType.includes('text'));
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
			const reg = /(https?:[^'"\s]+\.m3u8[^'"\s]*)/ig;
			const m = reg.exec(html);
			if (m && m[1]) {
				const abs = new URL(m[1], new URL(url)).toString();
				return res.redirect(302, `/stream?url=${encodeURIComponent(abs)}`);
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