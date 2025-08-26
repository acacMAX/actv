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
	return { 'User-Agent': 'Mozilla/5.0', 'Referer': o.origin };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCache(env) {
	if (!env.__MEMO) env.__MEMO = new Map();
	return env.__MEMO;
}

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); } 