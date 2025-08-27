const form = document.getElementById('searchForm');
const input = document.getElementById('wd');
const grid = document.getElementById('grid');
const stats = document.getElementById('stats');
const favoritesBar = document.getElementById('favoritesBar');
const favGrid = document.getElementById('favGrid');
const topProgress = document.getElementById('topProgress');

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
			if (e.target.classList.contains('remove')) { e.stopPropagation(); chip.classList.add('removing'); setTimeout(()=>{ saveFavs(loadFavs().filter(x => !(x.source===f.source && x.id===f.id))); }, 160); return; }
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
	el.className = 'card fade-in';
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
	topProgress && topProgress.classList.remove('hidden');
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
	} finally {
		topProgress && topProgress.classList.add('hidden');
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
let autoplayNext = true;

function showModal() { modal.classList.remove('hidden'); }
function hideModal() { modal.classList.add('hidden'); if (hls) { hls.destroy(); hls = null; } video.pause(); video.removeAttribute('src'); }
closeBtn.addEventListener('click', hideModal);

function refreshFavBtn() {
	if (!currentItem) return;
	const liked = isFav(currentItem);
	favBtn.classList.toggle('active', liked);
	favBtn.textContent = liked ? '★ 已收藏' : '☆ 收藏';
}

function renderAutoplayToggle() {
	const exists = document.getElementById('autoplayToggle');
	if (exists) { exists.textContent = autoplayNext ? '连播开' : '连播关'; return; }
	const btn = document.createElement('button');
	btn.id = 'autoplayToggle';
	btn.className = 'btn-fav';
	btn.style.marginLeft = '8px';
	btn.textContent = autoplayNext ? '连播开' : '连播关';
	btn.onclick = () => { autoplayNext = !autoplayNext; renderAutoplayToggle(); };
	document.querySelector('.player-head').appendChild(btn);
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

// 剧集分页渲染
const EP_PAGE_SIZE = 20;
let epAll = [];
let epPage = 1;
let epPageSize = EP_PAGE_SIZE;
let epAsc = true;
let currentGlobalIndex = -1;
function getAllOrdered() { return epAsc ? epAll.slice() : epAll.slice().reverse(); }
function renderEpisodePage(page, autoSelectIdx) {
	const all = getAllOrdered();
	const total = all.length;
	const pages = Math.max(1, Math.ceil(total / epPageSize));
	epPage = Math.min(Math.max(1, page), pages);
	episodeList.innerHTML = '';
	// 分页控制条（作为 li 放入 ul 内）
	const barLi = document.createElement('li');
	barLi.className = 'ep-pager-li';
	const bar = document.createElement('div');
	bar.className = 'ep-pager sticky';
	const info = document.createElement('span');
	info.textContent = `共 ${total} 集 · 第 ${epPage}/${pages} 页`;
	const prev = document.createElement('button'); prev.textContent = '上一页'; prev.disabled = epPage <= 1; prev.onclick = () => { renderEpisodePage(epPage - 1); episodeList.scrollTop = 0; };
	const next = document.createElement('button'); next.textContent = '下一页'; next.disabled = epPage >= pages; next.onclick = () => { renderEpisodePage(epPage + 1); episodeList.scrollTop = 0; };
	const jumpInput = document.createElement('input'); jumpInput.type = 'number'; jumpInput.min = 1; jumpInput.max = pages; jumpInput.value = epPage; jumpInput.className = 'ep-jump';
	const jumpBtn = document.createElement('button'); jumpBtn.textContent = '跳转'; jumpBtn.onclick = () => { const n = Number(jumpInput.value || 1); renderEpisodePage(n); episodeList.scrollTop = 0; };
	const sizeSel = document.createElement('select'); sizeSel.className = 'ep-size'; [20,30,60,90,120].forEach(n=>{ const o=document.createElement('option'); o.value=String(n); o.textContent=`每页${n}`; if(n===epPageSize) o.selected=true; sizeSel.appendChild(o); }); sizeSel.onchange=()=>{ epPageSize = Number(sizeSel.value); renderEpisodePage(1); episodeList.scrollTop = 0; };
	const orderBtn = document.createElement('button'); orderBtn.textContent = epAsc ? '倒序' : '正序'; orderBtn.onclick = ()=>{ epAsc = !epAsc; renderEpisodePage(1); episodeList.scrollTop = 0; };
	bar.appendChild(prev); bar.appendChild(info); bar.appendChild(next); bar.appendChild(jumpInput); bar.appendChild(jumpBtn); bar.appendChild(sizeSel); bar.appendChild(orderBtn);
	barLi.appendChild(bar);
	episodeList.appendChild(barLi);
	// 当前页列表
	const start = (epPage - 1) * epPageSize;
	const end = Math.min(start + epPageSize, total);
	for (let idx = start; idx < end; idx++) {
		const ep = all[idx];
		const li = document.createElement('li');
		li.className = 'fade-in';
		li.textContent = ep.name || `第${(idx+1)}集`;
		li.addEventListener('click', () => {
			Array.from(document.querySelectorAll('#episodeList li')).forEach(x => x.classList.remove('active'));
			li.classList.add('active');
			currentGlobalIndex = idx;
			playM3u8(ep.url);
			video.onended = () => {
				if (!autoplayNext) return;
				const nextIdx = currentGlobalIndex + 1;
				const totalNow = getAllOrdered().length;
				if (nextIdx < totalNow) {
					playEpisodeByGlobalIndex(nextIdx);
				}
			};
		});
		episodeList.appendChild(li);
		if (autoSelectIdx !== undefined && idx === autoSelectIdx) li.click();
	}
}
function playEpisodeByGlobalIndex(globalIdx) {
	const all = getAllOrdered();
	if (!all.length || globalIdx < 0 || globalIdx >= all.length) return;
	const targetPage = Math.floor(globalIdx / epPageSize) + 1;
	renderEpisodePage(targetPage, globalIdx);
}

async function openPlayer(item) {
	currentItem = item; refreshFavBtn();
	showModal();
	playerTitle.textContent = item.title || '播放';
	episodeList.innerHTML = '<li>加载中...</li>';
	try {
		const resp = await fetch(`/api/detail?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}`);
		const data = await resp.json();
		epAll = data.episodes || [];
		if (!epAll.length) { episodeList.innerHTML = '<li>未获得播放地址</li>'; return; }
		epAsc = true; epPageSize = EP_PAGE_SIZE; currentGlobalIndex = -1;
		renderAutoplayToggle();
		playEpisodeByGlobalIndex(0);
	} catch (e) {
		console.error(e);
		episodeList.innerHTML = '<li>加载失败</li>';
	}
} 