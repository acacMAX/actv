export const onRequestGet = async ({ request }) => {
	const url = new URL(request.url);
	const source = (url.searchParams.get('source') || '').trim();
	const id = (url.searchParams.get('id') || '').trim();
	if (!source || !id) return json({ code: 400, msg: '缺少 source 或 id' }, 400);

	const src = getSources().find(s => s.name === source);
	if (!src) return json({ code: 400, msg: '未知的来源' }, 400);
	const api = `${src.base}/api.php/provide/vod/?ac=detail&ids=${encodeURIComponent(id)}`;
	try {
		const resp = await fetch(api, { headers: defHeaders(api) });
		const data = await resp.json();
		const list = data?.list || data?.data || [];
		const item = Array.isArray(list) && list.length ? list[0] : null;
		if (!item) return json({ code: 0, title: '', episodes: [] });
		let episodes = parseEpisodesPreferM3u8(item);
		for (let i = 0; i < episodes.length; i++) {
			const ep = episodes[i];
			if (!/\.m3u8(\?.*)?$/i.test(ep.url)) {
				const found = await extractM3u8FromPage(ep.url);
				if (found) ep.url = found; else ep.url = '';
			}
		}
		episodes = episodes.filter(ep => !!ep.url && /\.m3u8(\?.*)?$/i.test(ep.url));
		return json({ code: 0, title: item.vod_name || item.name || '', episodes });
	} catch (e) {
		return json({ code: 500, msg: '获取详情失败' }, 500);
	}
};

function getSources() { return [
	{ name: '暴风', base: 'https://publish.bfzy.tv' },
	{ name: '非凡', base: 'http://ffzy5.tv' },
	{ name: '快看', base: 'https://kuaikanzy.net' },
	{ name: '乐视', base: 'https://www.leshizy1.com' },
	{ name: '量子', base: 'http://lzizy.net' },
	{ name: '索尼', base: 'https://suonizy.net' },
	{ name: '红牛', base: 'https://hongniuziyuan.net' },
	{ name: '优质', base: 'https://1080zyk6.com' },
	{ name: '鸭鸭', base: 'https://yayazy.com' },
	{ name: '牛牛', base: 'https://niuniuzy.cc' },
	{ name: 'OK', base: 'https://okzyw.vip' },
	{ name: '49', base: 'https://49zyw.com' },
	{ name: '360', base: 'https://360zy5.com' },
	{ name: '奇虎', base: 'https://qihuzy4.com' },
]; }

function splitBlocks(s) { return String(s || '').split('$$$').map(x => x.trim()).filter(Boolean); }

function parseEpisodesPreferM3u8(item) {
	const froms = splitBlocks(item.vod_play_from || item.play_from || '');
	const urlsBlocks = splitBlocks(item.vod_play_url || item.play_url || '');
	let pairs = froms.map((f, i) => ({ from: String(f || '').toLowerCase(), raw: urlsBlocks[i] || '' }));
	pairs.sort((a, b) => (a.from.includes('m3u8') ? 0 : 1) - (b.from.includes('m3u8') ? 0 : 1));
	for (const p of pairs) {
		const eps = String(p.raw).split('#').map(x => x.trim()).filter(Boolean).map(seg => {
			const [name, url] = seg.split('$');
			return { name: name || '第1集', url: url || '' };
		}).filter(ep => ep.url);
		if (eps.length) return eps;
	}
	return [];
}

async function extractM3u8FromPage(pageUrl) {
	try {
		const res = await fetch(pageUrl, { headers: defHeaders(pageUrl) });
		const html = await res.text();
		const reg = /(https?:[^'"\s]+\.m3u8[^'"\s]*)/ig;
		const m = reg.exec(html);
		return m && m[1] ? new URL(m[1], new URL(pageUrl)).toString() : '';
	} catch { return ''; }
}

function defHeaders(u) { const o = new URL(u); return { 'User-Agent': 'Mozilla/5.0', 'Referer': o.origin }; }

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }); } 