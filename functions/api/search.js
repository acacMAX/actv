export const onRequestGet = async ({ request, env, waitUntil }) => {
	const url = new URL(request.url);
	const wd = (url.searchParams.get('wd') || '').trim();
	const mode = (url.searchParams.get('mode') || 'full').trim();
	if (!wd) return json({ code: 400, msg: '缺少参数 wd' }, 400);

	const cacheKey = `search:${mode}:${wd}`;
	const now = Date.now();
	const cache = getCache(env);
	const cached = cache.get(cacheKey);
	if (cached && cached.expireAt > now) return json(cached.data);

	const started = now;
	const sources = getSources();

	const fetchFromSource = async (source, keyword) => {
		const tryUrls = source.patterns.map(p => `${source.base}${p.replace('{wd}', encodeURIComponent(keyword))}`);
		for (const u of tryUrls) {
			try {
				const resp = await fetch(u, { headers: defaultHeaders(u), cf: { cacheTtl: 60 } });
				const data = await resp.json().catch(() => ({}));
				const list = extractList(data);
				if (list.length) return list.slice(0, 20).map(v => normalizeVodItem(v, source));
			} catch {}
		}
		return [];
	};

	const dedupe = (items) => {
		const seen = new Set();
		const out = [];
		for (const it of items) {
			const key = `${it.title}|${it.cover}`;
			if (seen.has(key)) continue; seen.add(key); out.push(it);
		}
		return out;
	};

	try {
		if (mode === 'fast') {
			let collected = [];
			let resolved = 0;
			await Promise.race([
				Promise.all(sources.map(async s => {
					const r = await fetchFromSource(s, wd);
					if (r.length) { collected = dedupe(collected.concat(r)); resolved++; }
					if (resolved >= 2) throw new Error('FAST_DONE');
				})),
				wait(2500)
			]).catch(() => {});
			const resp = { code: 0, tookMs: Date.now() - started, count: collected.length, list: collected };
			cache.set(cacheKey, { expireAt: Date.now() + 20_000, data: resp });
			return json(resp);
		}

		const results = await Promise.allSettled(sources.map(s => fetchFromSource(s, wd)));
		const items = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
		const deduped = dedupe(items);
		const resp = { code: 0, tookMs: Date.now() - started, count: deduped.length, list: deduped };
		cache.set(cacheKey, { expireAt: Date.now() + 60_000, data: resp });
		return json(resp);
	} catch (e) {
		return json({ code: 500, msg: '搜索失败' }, 500);
	}
};

function getSources() {
	return [
		{ name: '天天影视', base: 'https://www.tttv01.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
		{ name: '秒看', base: 'https://miaokan.cc', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
		{ name: 'HD电影', base: 'https://www.hd-dy.cc', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
		{ name: '3Q影视', base: 'https://qqqys.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] },
		{ name: '小红影视', base: 'https://www.xiaohys.com', patterns: ['/index.php/ajax/suggest?mid=1&wd={wd}', '/api.php/provide/vod/?ac=list&wd={wd}'] }
	];
}

function extractList(data) {
	if (!data || typeof data !== 'object') return [];
	if (Array.isArray(data)) return data;
	const list = data.list ?? data.data ?? data.result ?? data.res ?? data.vod_list ?? data.vodlist ?? data.vod;
	if (Array.isArray(list)) return list;
	for (const v of Object.values(data)) {
		if (Array.isArray(v) && v.length && (v[0]?.vod_name != null || v[0]?.name != null)) return v;
	}
	return [];
}

function normalizeVodItem(item, source) {
	const raw = item.pic || item.vod_pic || item.cover || item.img || '';
	const cover = absolutify(raw, source.base);
	const title = item.name || item.vod_name || item.title || '';
	const year = item.year || item.vod_year || item.publish_year || '';
	const type = item.type || item.type_name || item.vod_class || '';
	const id = String(item.id || item.vod_id || item.sid || `${source.name}-${title}`);
	return { source: source.name, title, cover, year, type, remarks: item.note || item.vod_remarks || item.remarks || '', id };
}

function absolutify(cover, base) {
	if (!cover) return '';
	const c = String(cover).trim();
	if (/^https?:\/\//i.test(c)) return c;
	if (/^\/\//.test(c)) return `https:${c}`;
	if (c.startsWith('/')) return `${base}${c}`;
	return `${base}/${c}`;
}

function defaultHeaders(u) {
	const o = new URL(u);
	return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Referer': o.origin + '/', 'Origin': o.origin };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCache(env) {
	if (!env.__MEMO) env.__MEMO = new Map();
	return env.__MEMO;
}

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); } 