export const onRequestGet = async ({ request }) => {
	const url = new URL(request.url);
	const target = (url.searchParams.get('url') || '').trim();
	if (!target) return new Response('missing url', { status: 400 });
	try {
		const o = new URL(target);
		const resp = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': o.origin } });
		const ct = resp.headers.get('content-type') || '';
		const isM3u8Hint = /\.m3u8(\?.*)?$/i.test(target);
		const isHtml = ct.includes('text/html');
		const isM3u8 = ct.includes('application/vnd.apple.mpegurl') || ct.includes('application/x-mpegURL') || (isM3u8Hint && ct.includes('text'));
		if (isM3u8) {
			const text = await resp.text();
			const base = new URL(target);
			const rewritten = text.split(/\r?\n/).map(line => {
				const s = line.trim();
				if (!s || s.startsWith('#')) return line;
				try { const abs = new URL(s, base).toString(); return `/stream?url=${encodeURIComponent(abs)}`; } catch { return line; }
			}).join('\n');
			return new Response(rewritten, { headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-cache' } });
		}
		if (isHtml) {
			const html = await resp.text();
			const reg = /(https?:[^'"\s]+\.m3u8[^'"\s]*)/ig;
			const m = reg.exec(html);
			if (m && m[1]) {
				const abs = new URL(m[1], new URL(target)).toString();
				return Response.redirect(`/stream?url=${encodeURIComponent(abs)}`, 302);
			}
		}
		const h = new Headers(resp.headers);
		h.set('cache-control', 'no-cache');
		return new Response(resp.body, { status: resp.status, headers: h });
	} catch (e) {
		return new Response('bad gateway', { status: 502 });
	}
}; 