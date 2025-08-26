const form = document.getElementById('searchForm');
const input = document.getElementById('wd');
const grid = document.getElementById('grid');
const stats = document.getElementById('stats');
const favoritesBar = document.getElementById('favoritesBar');
const favGrid = document.getElementById('favGrid');

let searchMode = 'fast';

function proxied(src) {
	if (!src) return '/placeholder.svg';
	return `/img?src=${encodeURIComponent(src)}`;
}

// 收藏逻辑
const FAV_KEY = 'actv:favorites:v1';
function loadFavs() {
	try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}
function saveFavs(favs) { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); renderFavs(); renderFavGrid(); }
function isFav(item) { return loadFavs().some(x => x.source === item.source && x.id === item.id); }
function toggleFav(item) {
	const favs = loadFavs();
	const idx = favs.findIndex(x => x.source === item.source && x.id === item.id);
	if (idx >= 0) { favs.splice(idx, 1); } else { favs.unshift({ source: item.source, id: item.id, title: item.title, cover: item.cover }); }
	saveFavs(favs);
}
function renderFavs() {
	const favs = loadFavs();
	favoritesBar.innerHTML = '';
	favs.forEach(f => {
		const chip = document.createElement('span');
		chip.className = 'fav-chip';
		chip.innerHTML = `<img src="${proxied(f.cover)}" style="width:18px;height:18px;border-radius:4px;object-fit:cover;"> <span>${f.title}</span> <button class="remove">×</button>`;
		chip.addEventListener('click', (e) => {
			if (e.target.classList.contains('remove')) { e.stopPropagation(); saveFavs(loadFavs().filter(x => !(x.source===f.source && x.id===f.id))); return; }
			openPlayer(f);
		});
		favoritesBar.appendChild(chip);
	});
}
function renderFavGrid() {
	if (!favGrid) return;
	const favs = loadFavs();
	favGrid.innerHTML = '';
	if (!favs.length) {
		const hint = document.createElement('div');
		hint.className = 'empty-hint';
		hint.textContent = '暂无收藏，点击卡片或在播放页点“收藏”试试~';
		favGrid.appendChild(hint);
		return;
	}
	favs.forEach(f => favGrid.appendChild(createCard(f)));
}
renderFavs();
renderFavGrid();

function createCard(item) {
	const el = document.createElement('article');
	el.className = 'card';
	el.dataset.source = item.source;
	el.dataset.id = item.id;
	const poster = proxied(item.cover);
	el.innerHTML = `
		<a href="javascript:void(0)" style="text-decoration:none;color:inherit;display:block;">
			<img class="poster" src="${poster}" alt="${item.title}" onerror="this.onerror=null;this.src='/placeholder.svg';">
			<div class="meta">
				<div class="title" title="${item.title}">${item.title}</div>
				<div class="sub">
					<span class="badge">${item.source}</span>
					<span>${item.year || ''}</span>
				</div>
			</div>
		</a>
	`;
	el.addEventListener('click', () => openPlayer(item));
	return el;
}

async function doSearch(keyword) {
	grid.innerHTML = '';
	stats.textContent = '搜索中...';
	try {
		const resp = await fetch(`/api/search?mode=${encodeURIComponent(searchMode)}&wd=${encodeURIComponent(keyword)}`);
		const data = await resp.json();
		if (data.code !== 0) throw new Error(data.msg || '搜索失败');
		const toggle = document.createElement('a');
		toggle.href = 'javascript:void(0)';
		toggle.style = 'margin-left:8px;color:#7aa0ff;';
		toggle.textContent = searchMode === 'fast' ? '切换完整结果' : '切换快速模式';
		toggle.onclick = () => { searchMode = searchMode === 'fast' ? 'full' : 'fast'; if (input.value.trim()) doSearch(input.value.trim()); };
		stats.innerHTML = `共 ${data.count} 条，耗时 ${data.tookMs} ms `;
		stats.appendChild(toggle);
		data.list.forEach(item => grid.appendChild(createCard(item)));
	} catch (e) {
		console.error(e);
		stats.textContent = '搜索失败，请稍后再试';
	}
}

form.addEventListener('submit', (e) => {
	e.preventDefault();
	const kw = input.value.trim();
	if (!kw) return;
	doSearch(kw);
});

const urlKw = new URLSearchParams(location.search).get('q');
if (urlKw) {
	input.value = urlKw;
	doSearch(urlKw);
}

// 播放器逻辑
const modal = document.getElementById('playerModal');
const closeBtn = document.getElementById('closePlayer');
const episodeList = document.getElementById('episodeList');
const video = document.getElementById('video');
const playerTitle = document.getElementById('playerTitle');
const favBtn = document.getElementById('favBtn');
let hls; let currentItem = null;

function showModal() { modal.classList.remove('hidden'); }
function hideModal() { modal.classList.add('hidden'); if (hls) { hls.destroy(); hls = null; } video.pause(); video.removeAttribute('src'); }
closeBtn.addEventListener('click', hideModal);

function refreshFavBtn() {
	if (!currentItem) return;
	const liked = isFav(currentItem);
	favBtn.classList.toggle('active', liked);
	favBtn.textContent = liked ? '★ 已收藏' : '☆ 收藏';
}

favBtn.addEventListener('click', () => { if (!currentItem) return; toggleFav(currentItem); refreshFavBtn(); });

function playM3u8(rawUrl) {
	const url = `/stream?url=${encodeURIComponent(rawUrl)}`;
	if (Hls.isSupported()) {
		if (hls) hls.destroy();
		hls = new Hls({ maxBufferLength: 30 });
		hls.loadSource(url);
		hls.attachMedia(video);
		hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
	} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
		video.src = url; video.play();
	} else {
		alert('当前浏览器不支持 HLS 播放');
	}
}

async function openPlayer(item) {
	currentItem = item; refreshFavBtn();
	showModal();
	playerTitle.textContent = item.title || '播放';
	episodeList.innerHTML = '<li>加载中...</li>';
	try {
		const resp = await fetch(`/api/detail?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}`);
		const data = await resp.json();
		const eps = data.episodes || [];
		if (!eps.length) { episodeList.innerHTML = '<li>未获得播放地址</li>'; return; }
		episodeList.innerHTML = '';
		eps.forEach((ep, idx) => {
			const li = document.createElement('li');
			li.textContent = ep.name || `第${idx+1}集`;
			li.addEventListener('click', () => {
				Array.from(episodeList.children).forEach(x => x.classList.remove('active'));
				li.classList.add('active');
				playM3u8(ep.url);
			});
			episodeList.appendChild(li);
			if (idx === 0) li.click();
		});
	} catch (e) {
		console.error(e);
		episodeList.innerHTML = '<li>加载失败</li>';
	}
} 