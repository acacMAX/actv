export const onRequestGet = async ({ request }) => {
	const url = new URL(request.url);
	const source = (url.searchParams.get('source') || '').trim();
	const id = (url.searchParams.get('id') || '').trim();
	if (!source || !id) return json({ code: 400, msg: '缺少 source 或 id' }, 400);

	const src = getSources().find(s => s.name === source);
	if (!src) return json({ code: 400, msg: '未知的来源' }, 400);
	const api = `${src.base}/api.php/provide/vod/?ac=detail&ids=${encodeURIComponent(id)}`;
	const baseOrigin = new URL(src.base).origin;
	try {
		const resp = await fetch(api, { headers: defHeaders(api) });
		const data = await resp.json();
		let list = data?.list ?? data?.data;
		if (!Array.isArray(list) || list.length === 0) {
			const single = data?.vod ?? data?.info ?? (data?.vod_id != null || data?.vod_name != null ? data : null);
			list = single ? [single] : [];
		}
		const item = list.length ? list[0] : null;
		if (!item) return json({ code: 0, title: '', episodes: [] });
		let episodes = parseEpisodesPreferM3u8(item, baseOrigin);
		const fallbackUrls = [];
		for (let i = 0; i < episodes.length; i++) {
			const ep = episodes[i];
			if (!/\.m3u8(\?.*)?$/i.test(ep.url)) {
				const found = await extractM3u8FromPage(ep.url);
				if (found) ep.url = found; else { fallbackUrls.push({ name: ep.name, url: ep.url }); ep.url = ''; }
			}
		}
		let finalList = episodes.filter(ep => !!ep.url && /\.m3u8(\?.*)?$/i.test(ep.url));
		if (finalList.length === 0 && fallbackUrls.length > 0) finalList = fallbackUrls;
		return json({ code: 0, title: item.vod_name || item.name || item.title || '', episodes: finalList });
	} catch (e) {
		return json({ code: 500, msg: '获取详情失败' }, 500);
	}
};

function getSources() {
	return [
		{ name: '天天影视', base: 'https://www.tttv01.com' },
		{ name: '秒看', base: 'https://miaokan.cc' },
		{ name: 'HD电影', base: 'https://www.hd-dy.cc' },
		{ name: '3Q影视', base: 'https://qqqys.com' },
		{ name: '小红影视', base: 'https://www.xiaohys.com' }
	];
}

function splitBlocks(s) { return String(s || '').split('$$$').map(x => x.trim()).filter(Boolean); }

function absolutifyPlayUrl(url, baseOrigin) {
	if (!url || typeof url !== 'string') return '';
	const u = url.trim();
	if (/^https?:\/\//i.test(u)) return u;
	if (/^\/\//.test(u)) return `https:${u}`;
	try { return new URL(u, baseOrigin).href; } catch { return u.startsWith('/') ? `${baseOrigin}${u}` : `${baseOrigin}/${u}`; }
}

function parseEpisodesPreferM3u8(item, baseOrigin = '') {
	const playFrom = item.vod_play_from ?? item.play_from ?? item.play_from_name ?? '';
	const playUrl = item.vod_play_url ?? item.play_url ?? item.play_url_name ?? '';
	const froms = splitBlocks(playFrom);
	const urlsBlocks = splitBlocks(playUrl);
	let pairs = froms.map((f, i) => ({ from: (f || '').toLowerCase(), raw: urlsBlocks[i] || '' }));
	if (pairs.every(p => !p.raw) && urlsBlocks.length > 0) pairs = [{ from: '', raw: urlsBlocks[0] || '' }];
	pairs.sort((a, b) => (a.from.includes('m3u8') ? 0 : 1) - (b.from.includes('m3u8') ? 0 : 1));
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

async function extractM3u8FromPage(pageUrl) {
	try {
		const res = await fetch(pageUrl, { headers: defHeaders(pageUrl) });
		const html = await res.text();
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

function defHeaders(u) { const o = new URL(u); return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Referer': o.origin + '/', 'Origin': o.origin }; }

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); } 