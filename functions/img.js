export const onRequestGet = async ({ request }) => {
	const url = new URL(request.url);
	const src = (url.searchParams.get('src') || '').trim();
	if (!src) return Response.redirect('/placeholder.svg', 302);
	try {
		const o = new URL(src);
		const resp = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': o.origin }, cf: { cacheTtl: 86400 } });
		const h = new Headers(resp.headers);
		h.set('Cache-Control', 'public, max-age=86400');
		return new Response(resp.body, { status: resp.status, headers: h });
	} catch (e) {
		return Response.redirect('/placeholder.svg', 302);
	}
}; 