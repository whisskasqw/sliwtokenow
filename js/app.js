import { CATEGORIES, CATEGORY_BY_ID } from './categories.js';
import { loadModels, classify } from './classifier.js';
import { db, setErrorHandler } from './db.js';

const $ = sel => document.querySelector(sel);
const ico = n => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const state = {
  photos: [],          // { id, name, type, size, lastModified, addedAt, blob, thumb, category, manual, confidence, tags, w, h }
  active: 'all',
  search: '',
  sort: 'added-desc',
  queue: [],
  processing: false,
  done: 0,
  total: 0,
  lightboxId: null,
};
const urls = new Map(); // id -> objectURL миниатюры

// ---------- утилиты ----------
const fmtSize = b => b < 1024 * 1024 ? `${Math.round(b / 1024)} КБ` : `${(b / 1024 / 1024).toFixed(1)} МБ`;
const fmtDate = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n, [one, few, many]) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const photoWord = n => `${n} ${plural(n, ['фото', 'фото', 'фото'])}`;
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function thumbUrl(p) {
  if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.thumb || p.blob));
  return urls.get(p.id);
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

async function makeThumb(bitmap) {
  const max = 480;
  const s = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * s);
  c.height = Math.round(bitmap.height * s);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
}

// ---------- добавление файлов ----------
function addFiles(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
  const skipped = fileList.length - files.length;
  let added = 0;
  for (const file of files) {
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    if (state.photos.some(p => p.id === id) || state.queue.some(q => q.id === id)) continue;
    const photo = {
      id, name: file.name, type: file.type, size: file.size,
      lastModified: file.lastModified, addedAt: Date.now(),
      blob: file, thumb: null, category: null, manual: false, confidence: 0, tags: [],
    };
    state.photos.push(photo);
    state.queue.push(photo);
    added++;
  }
  if (skipped > 0) toast(`Пропущено файлов (не изображения): ${skipped}`);
  if (added === 0 && files.length) toast('Эти фото уже добавлены');
  state.total += added;
  render();
  processQueue();
}

async function processQueue() {
  if (state.processing) return;
  state.processing = true;
  renderProgress();
  try {
    await loadModels(msg => renderProgress(msg));
  } catch (e) {
    console.error(e);
    toast('Не удалось загрузить модели распознавания. Фото попадут в «Другое».');
  }
  while (state.queue.length) {
    const photo = state.queue.shift();
    renderProgress();
    try {
      const bitmap = await createImageBitmap(photo.blob, { imageOrientation: 'from-image' });
      photo.w = bitmap.width; photo.h = bitmap.height;
      photo.thumb = await makeThumb(bitmap);
      let res = { category: 'other', confidence: 0, tags: [] };
      try { res = await classify(bitmap, photo.blob); } catch (e) { console.warn('classify', e); }
      bitmap.close?.();
      Object.assign(photo, { category: res.category, confidence: res.confidence, tags: res.tags });
      if (urls.has(photo.id)) { URL.revokeObjectURL(urls.get(photo.id)); urls.delete(photo.id); }
    } catch (e) {
      console.warn('Не удалось прочитать', photo.name, e);
      photo.category = 'other';
      photo.broken = true;
    }
    await db.put(photo);
    state.done++;
    render();
    await new Promise(r => setTimeout(r, 0));
  }
  state.processing = false;
  if (state.total) toast(`Готово: отсортировано ${photoWord(state.done)}`);
  state.done = 0; state.total = 0;
  renderProgress();
}

// ---------- действия ----------
async function setCategory(id, category) {
  const p = state.photos.find(x => x.id === id);
  if (!p || p.category === category) return;
  p.category = category;
  p.manual = true;
  await db.put(p);
  render();
  toast(`Перемещено в «${CATEGORY_BY_ID[category].name}»`);
}

async function removePhoto(id) {
  const i = state.photos.findIndex(x => x.id === id);
  if (i < 0) return;
  state.photos.splice(i, 1);
  state.queue = state.queue.filter(q => q.id !== id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  await db.remove(id);
  render();
}

async function clearAll() {
  if (!state.photos.length) return;
  const btn = $('#clearAll');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = `Точно удалить ${photoWord(state.photos.length)}?`;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'Очистить'; }, 4000);
    return;
  }
  delete btn.dataset.armed;
  btn.textContent = 'Очистить';
  state.queue = [];
  state.photos = [];
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  await db.clear();
  render();
}

async function downloadZip(onlyActive) {
  const list = onlyActive ? visiblePhotos() : state.photos.filter(p => p.category);
  if (!list.length) return toast('Нет фото для скачивания');
  const btn = onlyActive ? $('#zipActive') : $('#zipAll');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Упаковка…';
  try {
    const zip = new window.JSZip();
    const used = new Set();
    for (const p of list) {
      const folder = CATEGORY_BY_ID[p.category]?.name || 'Другое';
      let path = `${folder}/${p.name}`;
      for (let n = 2; used.has(path); n++) path = `${folder}/${p.name.replace(/(\.[^.]*)?$/, `_${n}$1`)}`;
      used.add(path);
      zip.file(path, p.blob, { date: new Date(p.lastModified) });
    }
    const blob = await zip.generateAsync({ type: 'blob' }, m => { btn.textContent = `Упаковка ${Math.round(m.percent)}%`; });
    const name = onlyActive && state.active !== 'all' ? CATEGORY_BY_ID[state.active].name : 'Фото по категориям';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}.zip` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------- выборка ----------
function visiblePhotos() {
  const q = state.search.trim().toLowerCase();
  let list = state.photos.filter(p => state.active === 'all' || p.category === state.active);
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q)));
  const [key, dir] = state.sort.split('-');
  const val = p => key === 'name' ? p.name.toLowerCase() : key === 'date' ? p.lastModified : key === 'size' ? p.size : p.addedAt;
  list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  return list;
}

// ---------- отрисовка ----------
function renderSidebar() {
  const counts = {};
  for (const p of state.photos) if (p.category) counts[p.category] = (counts[p.category] || 0) + 1;
  const items = [{ id: 'all', name: 'Все фото', icon: 'grid', color: 'var(--accent)' }, ...CATEGORIES];
  $('#cats').innerHTML = items.map(c => {
    const n = c.id === 'all' ? state.photos.length : counts[c.id] || 0;
    return `<li><button class="cat ${state.active === c.id ? 'active' : ''} ${n ? '' : 'is-empty'}" data-cat="${c.id}" style="--c:${c.color}">
      <span class="cat-icon">${ico(c.icon)}</span><span class="cat-name">${c.name}</span><span class="cat-count">${n}</span>
    </button></li>`;
  }).join('');
}

function renderGrid() {
  const list = visiblePhotos();
  const grid = $('#grid');
  const has = state.photos.length > 0;
  $('#empty').hidden = has;
  $('#workspace').hidden = !has;
  if (!has) return;

  const cat = state.active === 'all' ? null : CATEGORY_BY_ID[state.active];
  $('#viewTitle').textContent = cat ? cat.name : 'Все фото';
  $('#viewCount').textContent = photoWord(list.length);
  $('#zipActive').hidden = !cat;

  if (!list.length) {
    grid.innerHTML = `<p class="grid-empty">${state.search ? 'Ничего не найдено' : 'Пока пусто'}</p>`;
    return;
  }
  grid.innerHTML = list.map(p => {
    const c = p.category ? CATEGORY_BY_ID[p.category] : null;
    const pending = !p.category;
    return `<figure class="card ${pending ? 'pending' : ''}" data-id="${escapeHtml(p.id)}" draggable="${!pending}" tabindex="0">
      ${p.thumb ? `<img src="${thumbUrl(p)}" alt="${escapeHtml(p.name)}" loading="lazy">` : '<div class="ph"></div>'}
      ${pending ? '<div class="spinner" aria-label="Обработка"></div>' : ''}
      ${c && state.active === 'all' ? `<span class="badge" style="--c:${c.color}" title="${c.name}"></span>` : ''}
      ${p.manual ? `<span class="manual" title="Категория выбрана вручную">${ico('pencil')}</span>` : ''}
      <figcaption>${escapeHtml(p.name)}</figcaption>
    </figure>`;
  }).join('');
}

function renderProgress(msg) {
  const bar = $('#progress');
  if (!state.processing) { bar.hidden = true; return; }
  bar.hidden = false;
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
  $('#progressText').textContent = msg || `Сортировка: ${state.done} из ${state.total}`;
  $('#progressFill').style.width = `${pct}%`;
}

function render() {
  renderSidebar();
  renderGrid();
  if (state.lightboxId) renderLightbox();
}

// ---------- просмотр ----------
let fullUrl = null;
function openLightbox(id) {
  state.lightboxId = id;
  renderLightbox();
  $('#lightbox').showModal();
}

function renderLightbox() {
  const p = state.photos.find(x => x.id === state.lightboxId);
  if (!p) { $('#lightbox').close(); return; }
  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = URL.createObjectURL(p.blob);
  $('#lbImg').src = fullUrl;
  $('#lbImg').alt = p.name;
  $('#lbName').textContent = p.name;
  $('#lbMeta').innerHTML = [
    p.w ? `${p.w}×${p.h}` : null, fmtSize(p.size), fmtDate(p.lastModified),
  ].filter(Boolean).map(escapeHtml).join(' · ');
  $('#lbTags').innerHTML = p.tags.length
    ? p.tags.map(t => `<button class="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')
    : '<span class="muted">нет меток</span>';
  $('#lbConf').textContent = p.manual ? 'выбрано вручную' : p.category ? `${Math.round(p.confidence * 100)}%` : 'обрабатывается';
  $('#lbCats').innerHTML = CATEGORIES.map(c =>
    `<button class="chip ${p.category === c.id ? 'on' : ''}" data-set="${c.id}" style="--c:${c.color}" ${p.category ? '' : 'disabled'}><i class="dot"></i>${c.name}</button>`
  ).join('');
}

function stepLightbox(dir) {
  const list = visiblePhotos();
  const i = list.findIndex(p => p.id === state.lightboxId);
  if (i < 0 || !list.length) return;
  state.lightboxId = list[(i + dir + list.length) % list.length].id;
  renderLightbox();
}

// ---------- события ----------
function bind() {
  const input = $('#fileInput'), folder = $('#folderInput');
  document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => (b.dataset.pick === 'folder' ? folder : input).click()));
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  folder.addEventListener('change', () => { addFiles(folder.files); folder.value = ''; });

  // перетаскивание файлов с диска на всю страницу
  let depth = 0;
  const isFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (isFiles(e)) { depth++; document.body.classList.add('dropping'); } });
  window.addEventListener('dragleave', e => { if (isFiles(e) && --depth <= 0) { depth = 0; document.body.classList.remove('dropping'); } });
  window.addEventListener('dragover', e => { if (isFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    addFiles(e.dataTransfer.files);
  });
  window.addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files);
  });

  // категории
  $('#cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.active = b.dataset.cat;
    try { localStorage.setItem('ps-active', state.active); } catch {}
    document.body.classList.remove('menu-open');
    render();
  });
  // перетаскивание фото в категорию
  $('#cats').addEventListener('dragover', e => {
    const b = e.target.closest('[data-cat]');
    if (!b || b.dataset.cat === 'all' || !e.dataTransfer.types.includes('text/photo-id')) return;
    e.preventDefault();
    document.querySelectorAll('.cat.over').forEach(x => x !== b && x.classList.remove('over'));
    b.classList.add('over');
  });
  $('#cats').addEventListener('dragleave', e => e.target.closest('[data-cat]')?.classList.remove('over'));
  $('#cats').addEventListener('drop', e => {
    const b = e.target.closest('[data-cat]');
    const id = e.dataTransfer.getData('text/photo-id');
    document.querySelectorAll('.cat.over').forEach(x => x.classList.remove('over'));
    if (!b || !id || b.dataset.cat === 'all') return;
    e.preventDefault();
    e.stopPropagation();
    setCategory(id, b.dataset.cat);
  });

  const grid = $('#grid');
  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.dataTransfer.setData('text/photo-id', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('dragging-photo');
  });
  grid.addEventListener('dragend', () => document.body.classList.remove('dragging-photo'));
  grid.addEventListener('click', e => { const c = e.target.closest('.card'); if (c) openLightbox(c.dataset.id); });
  grid.addEventListener('keydown', e => { const c = e.target.closest('.card'); if (c && e.key === 'Enter') openLightbox(c.dataset.id); });

  $('#search').addEventListener('input', e => { state.search = e.target.value; renderGrid(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; renderGrid(); });
  $('#zipActive').addEventListener('click', () => downloadZip(true));
  $('#zipAll').addEventListener('click', () => downloadZip(false));
  $('#clearAll').addEventListener('click', clearAll);
  $('#menuBtn').addEventListener('click', e => { e.stopPropagation(); document.body.classList.toggle('menu-open'); });
  $('.main').addEventListener('click', () => document.body.classList.remove('menu-open'));

  // окно просмотра
  const lb = $('#lightbox');
  lb.addEventListener('close', () => { state.lightboxId = null; if (fullUrl) { URL.revokeObjectURL(fullUrl); fullUrl = null; } });
  lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });
  $('#lbClose').addEventListener('click', () => lb.close());
  $('#lbPrev').addEventListener('click', () => stepLightbox(-1));
  $('#lbNext').addEventListener('click', () => stepLightbox(1));
  $('#lbCats').addEventListener('click', e => { const b = e.target.closest('[data-set]'); if (b) setCategory(state.lightboxId, b.dataset.set); });
  $('#lbTags').addEventListener('click', e => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    state.search = b.dataset.tag;
    state.active = 'all';
    $('#search').value = state.search;
    lb.close();
    render();
  });
  $('#lbDelete').addEventListener('click', async () => {
    const id = state.lightboxId;
    stepLightbox(1);
    if (state.lightboxId === id) lb.close();
    await removePhoto(id);
  });
  lb.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
    const n = Number(e.key);
    if (n >= 1 && n <= CATEGORIES.length && state.lightboxId) setCategory(state.lightboxId, CATEGORIES[n - 1].id);
  });
}

async function init() {
  try { state.active = localStorage.getItem('ps-active') || 'all'; } catch {}
  if (state.active !== 'all' && !CATEGORY_BY_ID[state.active]) state.active = 'all';
  let warned = false;
  setErrorHandler(e => {
    if (warned) return;
    warned = true;
    toast(e?.name === 'QuotaExceededError'
      ? 'Не хватает места в браузере: часть фото не сохранится после перезагрузки'
      : 'Сохранение в браузере недоступно: фото пропадут после перезагрузки');
  });
  bind();
  const saved = await db.all();
  state.photos = saved.filter(p => p.category);
  render();
  // Модели грузим заранее, чтобы первая сортировка шла быстрее.
  setTimeout(() => loadModels().catch(() => {}), 300);
}

init();
