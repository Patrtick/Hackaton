// app.js — обновлённый (заменяет старую версию)
// Ожидает: Chart.js подключён в index.html, DOM из вашего index.html (см. присланный).
// Backend: http://localhost:5000 (как было)

const BACKEND_URL = 'http://localhost:5000';

const openFileBtn = document.getElementById('openFileBtn');
const fileInput = document.getElementById('fileInput');
const reloadInput = document.getElementById('reloadInput');
const startScreen = document.getElementById('startScreen');
const appScreen = document.getElementById('appScreen');

const statusEl = document.getElementById('status');
const result = document.getElementById('result');
const summaryPanel = document.getElementById('summaryPanel');
const searchInput = document.getElementById('searchInput');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const markReadBtn = document.getElementById('markReadBtn');
const showReadBtn = document.getElementById('showReadBtn');

const advResourceType = document.getElementById('advResourceType');
const advStart = document.getElementById('advStart');
const advEnd = document.getElementById('advEnd');
const advFilterBtn = document.getElementById('advFilterBtn');
const advClearBtn = document.getElementById('advClearBtn');
const chainsList = document.getElementById('chainsList');

let lastParsed = null;
let lastRaw = '';
let fileHash = null;
let charts = {};
let showRead = false;

function setStatus(txt) { if (statusEl) statusEl.innerText = txt; }

// file open wiring
openFileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileChange);
reloadInput.addEventListener('change', handleFileChange);
document.getElementById('reloadLabel').addEventListener('click', () => reloadInput.click());

// unified change handler to avoid double triggers
function handleFileChange(e) {
  const inputEl = e.target;
  if (!inputEl.files || !inputEl.files[0]) return;
  uploadFile(inputEl);
}

// upload
function uploadFile(inputEl) {
  const f = inputEl.files[0];
  if (!f) return;
  setStatus(`Загрузка ${f.name}...`);
  const fd = new FormData();
  fd.append('file', f);
  fetch(BACKEND_URL + '/upload', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(j => {
      if (!j.ok) throw new Error(j.error || 'upload failed');
      lastParsed = j.parsed;
      lastRaw = j.raw || '';
      fileHash = simpleHash(lastRaw || (f.name + '::' + f.size + '::' + Date.now()));
      startScreen.style.display = 'none';
      appScreen.style.display = 'block';
      renderAll();
      setStatus('Файл обработан ✅');
    })
    .catch(e => { console.error(e); setStatus('Ошибка: ' + e.message); })
    .finally(() => { inputEl.value = ''; });
}

// tabs
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// main render
function renderAll() {
  if (!lastParsed) return;
  renderStats(lastParsed);
  renderLogs(lastParsed.lines || []);
  renderErrorsPanel(lastParsed.errors || []);
  renderChainsList(lastParsed.groups || {});
}

// ---------------- Logs Tab (kept compatible, slight cleanup) ----------------

function renderLogs(lines) {
  result.innerHTML = '';
  if (!lines || !lines.length) {
    result.innerHTML = '<div class="chip">Файл не содержит строк логов</div>';
    return;
  }
  const container = document.createElement('div');
  container.id = 'linesContainer';
  container.style.display = 'block';
  container.style.width = '100%';
  result.appendChild(container);

  lines.forEach((l, i) => {
    const el = document.createElement('div');
    el.className = 'line ' + (l.cls || l.level || 'normal') + (isRead(l) ? ' read' : '');
    el.dataset.idx = i;
    el.dataset.content = (l.raw || '') + ' ' + (l.text || '') + ' ' + (JSON.stringify(l.jsonFields || {}) || '');
    if (l.tf_req_id) el.dataset.tfReqId = l.tf_req_id;
    if (l.tf_resource_type) el.dataset.tfResourceType = l.tf_resource_type;
    if (l.timestamp) el.dataset.timestamp = l.timestamp;

    // checkbox col
    const cbCol = document.createElement('div');
    cbCol.className = 'checkbox-col';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'line-checkbox';
    chk.dataset.idx = i;
    cbCol.appendChild(chk);

    // header
    const header = document.createElement('div');
    header.className = 'line-header';
    header.style.flex = '1';

    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.innerText = l.timestamp ? `[${l.timestamp}]` : '';
    const lvl = document.createElement('span');
    lvl.className = 'lvl';
    lvl.innerText = (l.level || l.cls || '').toUpperCase();

    const badges = document.createElement('span');
    if (l.tf_req_id) {
      const b = document.createElement('span');
      b.className = 'tf-badge';
      b.innerText = `req:${l.tf_req_id}`;
      b.title = 'Показать цепочку';
      b.style.cursor = 'pointer';
      b.onclick = () => showChain(l.tf_req_id);
      badges.appendChild(b);
    }
    if (l.tf_resource_type) {
      const b2 = document.createElement('span');
      b2.className = 'tf-badge';
      b2.innerText = `res:${l.tf_resource_type}`;
      badges.appendChild(b2);
    }

    const msg = document.createElement('span');
    msg.className = 'msg';
    msg.innerText = ' ' + (l.text || (l.raw ? l.raw : '')).slice(0, 1000);

    header.appendChild(ts);
    header.appendChild(lvl);
    header.appendChild(badges);
    header.appendChild(msg);

    el.appendChild(cbCol);
    el.appendChild(header);

    // json fields toggle
    if (l.jsonFields) {
      Object.keys(l.jsonFields).forEach(k => {
        const block = l.jsonFields[k];
        const btn = document.createElement('button');
        btn.className = 'json-btn';
        btn.innerText = 'Показать ' + k;
        const pre = document.createElement('pre');
        pre.className = 'json-content';
        pre.style.display = 'none';
        pre.innerText = block.full || block.preview || '';
        btn.onclick = () => {
          const visible = pre.style.display === 'block';
          pre.style.display = visible ? 'none' : 'block';
          btn.innerText = (visible ? 'Показать ' : 'Скрыть ') + k;
        };
        el.appendChild(btn);
        el.appendChild(pre);
      });
    }

    container.appendChild(el);
  });

  attachFiltering();
}

// filtering and search — reuse existing UI controls
function filterButtons() { return Array.from(document.querySelectorAll('.filter-btn')).filter(b => b.dataset && b.dataset.level); }

function attachFiltering() {
  searchInput.oninput = doFilter;
  filterButtons().forEach(btn => {
    btn.onclick = () => { btn.classList.toggle('active'); doFilter(); };
  });
  markReadBtn.onclick = markSelectedAsRead;
  showReadBtn.onclick = () => { showRead = !showRead; renderLogs(lastParsed.lines || []); };
  doFilter();
}

function doFilter() {
  const q = searchInput.value.trim();
  let re = null;
  if (q) {
    try { re = new RegExp(q, 'i'); } catch(e) { re = q.toLowerCase(); }
  }
  const allowed = filterButtons().filter(b => b.classList.contains('active')).map(b => b.dataset.level);
  const container = document.getElementById('linesContainer');
  if (!container) return;
  const lines = container.querySelectorAll('.line');
  lines.forEach(line => {
    const idx = parseInt(line.dataset.idx, 10);
    const clsList = line.className.split(/\s+/);
    const level = ['error','warning','info','debug','normal','trace'].find(l => clsList.includes(l)) || 'normal';
    if (!allowed.includes(level)) { line.style.display = 'none'; return; }
    if (!showRead && line.classList.contains('read')) { line.style.display = 'none'; return; }
    if (q) {
      const hay = (line.dataset.content || '') + ' ' + (line.dataset.tfReqId || '') + ' ' + (line.dataset.tfResourceType || '');
      if (re) {
        try {
          if (!re.test(hay)) { line.style.display = 'none'; return; }
        } catch(e) {
          if (!hay.toLowerCase().includes(q.toLowerCase())) { line.style.display = 'none'; return; }
        }
      } else {
        if (!hay.toLowerCase().includes(q.toLowerCase())) { line.style.display = 'none'; return; }
      }
    }
    line.style.display = 'flex';
  });
}

function markSelectedAsRead() {
  const checks = Array.from(document.querySelectorAll('.line-checkbox')).filter(c => c.checked);
  if (!checks.length) return alert('Выберите строки для пометки как прочитанные');
  const ids = readIdsForFile();
  checks.forEach(c => {
    const idx = c.dataset.idx;
    const el = document.querySelector(`.line[data-idx="${idx}"]`);
    if (el) {
      const sig = lineSignatureByElement(el);
      if (!ids.includes(sig)) ids.push(sig);
      el.classList.add('read');
      c.checked = false;
    }
  });
  saveReadIdsForFile(ids);
  renderErrorsPanel(lastParsed.errors || []);
  doFilter();
}

function lineSignatureByElement(el) {
  const ts = el.dataset.timestamp || '';
  const content = (el.dataset.content || '').slice(0,200);
  return btoa(unescape(encodeURIComponent(ts + '||' + content)));
}
function isRead(line) {
  if (!fileHash) return false;
  try {
    const ids = readIdsForFile();
    const sig = btoa(unescape(encodeURIComponent((line.timestamp || '') + '||' + ((line.raw || line.text || '')).slice(0,200))));
    return ids.includes(sig);
  } catch(e){ return false; }
}
function isReadByIdx(idx) {
  const el = document.querySelector(`.line[data-idx="${idx}"]`);
  if (!el) return false;
  return isRead({ timestamp: el.dataset.timestamp, raw: el.dataset.content, text: '' });
}
function readIdsForFile() {
  try {
    const key = 'readIds_' + fileHash;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch(e){ return []; }
}
function saveReadIdsForFile(arr) {
  try {
    const key = 'readIds_' + fileHash;
    localStorage.setItem(key, JSON.stringify(arr));
  } catch(e){ /* ignore */ }
}

// ---------------- Errors panel ----------------
function renderErrorsPanel(errors) {
  const parent = summaryPanel;
  if (!errors || !errors.length) {
    parent.innerHTML = '<div class="chip">Ошибок: 0</div>';
    return;
  }
  const filtered = errors.filter(e => !isReadByIdx(e.idx));
  parent.innerHTML = '';
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.gap = '10px';

  const countChip = document.createElement('div');
  countChip.className = 'chip';
  countChip.innerText = `❌ Ошибок (непрочитанных): ${filtered.length}`;
  header.appendChild(countChip);

  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'filter-btn';
  jumpBtn.innerText = 'Показать только ошибки';
  jumpBtn.onclick = () => {
    filterButtons().forEach(b => {
      if (b.dataset.level === 'error') b.classList.add('active'); else b.classList.remove('active');
    });
    doFilter();
    document.querySelector('.tab-btn[data-tab="logsTab"]').click();
  };
  header.appendChild(jumpBtn);
  parent.appendChild(header);

  const list = document.createElement('div');
  list.style.maxHeight = '300px';
  list.style.overflow = 'auto';
  filtered.forEach(e => {
    const item = document.createElement('div');
    item.className = 'line error';
    item.innerText = e.text.slice(0, 200) + (e.text.length > 200 ? '...' : '');
    item.title = e.text;
    item.onclick = () => {
      document.querySelector('.tab-btn[data-tab="logsTab"]').click();
      const lineEl = document.querySelector(`.line[data-idx="${e.idx}"]`);
      if (lineEl) lineEl.scrollIntoView({ behavior: 'smooth' });
    };
    list.appendChild(item);
  });
  parent.appendChild(list);
}

// ---------------- Chains panel ----------------
function renderChainsList(groups) {
  chainsList.innerHTML = '';
  const keys = Object.keys(groups);
  if (!keys.length) {
    chainsList.innerHTML = '<div class="chip">Нет цепочек</div>';
    return;
  }
  keys.forEach(k => {
    const div = document.createElement('div');
    div.className = 'chain-item';
    div.innerText = `${k} (${groups[k].length} строк)`;
    div.onclick = () => showChain(k);
    chainsList.appendChild(div);
  });
}

function showChain(reqId) {
  if (!reqId) return;
  searchInput.value = reqId;
  doFilterFromSearch();
  document.querySelector('.tab-btn[data-tab="logsTab"]').click();
}

// ---------------- Stats Tab (completely redesigned) ----------------

function renderStats(parsed) {
  const statsTab = document.getElementById('statsTab');
  if (!statsTab) return;
  statsTab.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'charts-grid';
  statsTab.appendChild(grid);

  // Helper to create chart card
  function createChartCard(title, canvasId) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    const h3 = document.createElement('h3');
    h3.innerText = title;
    card.appendChild(h3);
    const canvas = document.createElement('canvas');
    canvas.id = canvasId || 'chart_' + Math.random().toString(36).slice(2);
    card.appendChild(canvas);
    grid.appendChild(card);
    return canvas;
  }

  // LEVELS doughnut
  const levelsCanvas = createChartCard('Распределение по уровням');
  const stats = parsed.stats || { levels: {} };
  const levelLabelsRaw = Object.keys(stats.levels);
  const levelLabels = levelLabelsRaw.map(l => l.toUpperCase() + ': ' + stats.levels[l]);
  const levelData = levelLabelsRaw.map(l => stats.levels[l]);
  charts.levels = new Chart(levelsCanvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels: levelLabels, datasets: [{ data: levelData, backgroundColor: levelLabelsRaw.map(l => colorForLevel(l)) }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}` } } },
      onClick: (evt, elems) => { if (elems.length) { const idx = elems[0].index; const level = levelLabelsRaw[idx]; filterByLevel(level); } }
    }
  });

  // TIMELINE line with errors
  const timelineCanvas = createChartCard('Активность по времени');
  const timelineBuckets = parsed.timeline || {};
  const timelineErrors = parsed.timelineErrors || {};
  const timeLabels = Object.keys(timelineBuckets).sort();
  const timeData = timeLabels.map(k => timelineBuckets[k]);
  const errorData = timeLabels.map(k => timelineErrors[k] || 0);
  charts.timeline = new Chart(timelineCanvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: timeLabels,
      datasets: [
        { label: 'События', data: timeData, fill: true, backgroundColor: 'rgba(96,165,250,0.08)', borderColor: '#60a5fa' },
        { label: 'Ошибки', data: errorData, fill: false, borderColor: '#f87171', pointBackgroundColor: '#f87171' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // RESOURCE TYPES bar (top 10)
  const resourceCanvas = createChartCard('Топ типов ресурсов');
  const resourceCounts = parsed.resourceCounts || {};
  const resKeys = Object.keys(resourceCounts).sort((a, b) => resourceCounts[b] - resourceCounts[a]).slice(0, 10);
  const resData = resKeys.map(k => resourceCounts[k]);
  charts.resources = new Chart(resourceCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels: resKeys, datasets: [{ data: resData, backgroundColor: '#34d399' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  // PROVIDERS doughnut
  const providerCanvas = createChartCard('Провайдеры');
  const providerCounts = parsed.providerCounts || {};
  const provKeys = Object.keys(providerCounts);
  const provData = provKeys.map(k => providerCounts[k]);
  charts.providers = new Chart(providerCanvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels: provKeys, datasets: [{ data: provData, backgroundColor: ['#fbbf24', '#60a5fa', '#a78bfa', '#34d399', '#f87171'] }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right' } }
    }
  });

  // PLAN SUMMARY doughnut
  const planSummary = parsed.planSummary || { adds: 0, changes: 0, destroys: 0 };
  if (planSummary.found) {
    const planCanvas = createChartCard('Итог плана');
    charts.planSummary = new Chart(planCanvas.getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Add', 'Change', 'Destroy'], datasets: [{ data: [planSummary.adds, planSummary.changes, planSummary.destroys], backgroundColor: ['#34d399', '#fbbf24', '#f87171'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  // GANTT full width
  const ganttCard = document.createElement('div');
  ganttCard.className = 'chart-card full-width';
  const h3g = document.createElement('h3');
  h3g.innerText = 'Диаграмма Ганта запросов (tf_req_id)';
  ganttCard.appendChild(h3g);
  const ganttWrap = document.createElement('div');
  ganttWrap.id = 'ganttWrap';
  ganttWrap.style.height = '400px';
  ganttWrap.style.overflowY = 'auto';
  ganttCard.appendChild(ganttWrap);
  grid.appendChild(ganttCard);
  renderGantt(parsed, ganttWrap);
}

// Build GANTT: groups -> compute start/end from parsed.lines timestamps
function renderGantt(parsed, selector) {
  const wrap = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!wrap) return;
  wrap.innerHTML = '';
  const groups = parsed.groups || {};
  const lines = parsed.lines || [];
  const keys = Object.keys(groups);
  if (!keys.length) {
    wrap.innerHTML = '<div class="chip">Нет данных для диаграммы Ганта</div>';
    return;
  }

  // compute per-group start/end and error flag & count
  const items = [];
  for (const k of keys) {
    const idxs = groups[k] || [];
    let minTs = null, maxTs = null, hasError = false, cnt = 0;
    idxs.forEach(idx => {
      const l = lines[idx];
      if (!l) return;
      cnt++;
      const t = l.timestamp ? new Date(l.timestamp) : null;
      if (t && !isNaN(t.getTime())) {
        if (!minTs || t < minTs) minTs = t;
        if (!maxTs || t > maxTs) maxTs = t;
      }
      const lvl = (l.level || l.cls || '').toLowerCase();
      if (lvl === 'error' || lvl === 'panic' || lvl === 'fatal') hasError = true;
    });
    // fallback: if timestamps missing, try to derive approximate using parsed.timestampIndex if present
    if (!minTs) {
      // skip groups without timestamps — they will still be shown with zero-length bar at top time
      continue;
    }
    items.push({ id: k, start: minTs, end: maxTs || minTs, hasError, count: cnt });
  }
  if (!items.length) { wrap.innerHTML = '<div class="chip">Нет валидных временных меток для Ганта</div>'; return; }

  // sort by start ascending, then duration descending
  items.sort((a,b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  // limits
  const minTime = new Date(Math.min(...items.map(i => i.start.getTime())));
  const maxTime = new Date(Math.max(...items.map(i => i.end.getTime())));
  const totalRange = Math.max( (maxTime - minTime), 1 );

  // create SVG
  const paddingLeft = 200; // label column
  const rowH = 28;
  const height = Math.min( Math.max( items.length * rowH + 40, 120 ), 540 ); // limit height so it fits on screen
  const width = wrap.clientWidth || 1000;
  const svgW = Math.max(width, 800);
  const svgH = height;

  // Build basic SVG element
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', svgH);
  svg.style.display = 'block';
  svg.style.background = 'transparent';

  // time axis ticks (5 ticks)
  const ticks = 5;
  for (let ti = 0; ti <= ticks; ti++) {
    const frac = ti / ticks;
    const x = paddingLeft + frac * (svgW - paddingLeft - 20);
    const tms = new Date(minTime.getTime() + frac * totalRange);
    // vertical grid line
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', 24); line.setAttribute('x2', x); line.setAttribute('y2', svgH - 10);
    line.setAttribute('stroke', 'rgba(255,255,255,0.03)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    // label
    const lbl = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('x', x + 4); lbl.setAttribute('y', 18);
    lbl.setAttribute('fill', '#cbd5e1');
    lbl.setAttribute('font-size', '11');
    lbl.textContent = tms.toISOString().replace('T',' ').slice(0,19);
    svg.appendChild(lbl);
  }

  // rows
  items.forEach((it, idx) => {
    const y = 28 + idx * rowH;
    // label area
    const lbl = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('x', 8);
    lbl.setAttribute('y', y + 14);
    lbl.setAttribute('fill', '#cbd5e1');
    lbl.setAttribute('font-size', '12');
    lbl.textContent = `${it.id.slice(0,28)}${it.id.length>28 ? '…':''} (${it.count})`;
    svg.appendChild(lbl);

    // compute bar positions
    const startFrac = (it.start.getTime() - minTime.getTime()) / totalRange;
    const endFrac = (it.end.getTime() - minTime.getTime()) / totalRange;
    const bx = paddingLeft + startFrac * (svgW - paddingLeft - 20);
    const bw = Math.max(3, (endFrac - startFrac) * (svgW - paddingLeft - 20));

    // bar rect
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', bx);
    rect.setAttribute('y', y + 4);
    rect.setAttribute('width', bw);
    rect.setAttribute('height', rowH - 10);
    rect.setAttribute('rx', 4);
    rect.setAttribute('ry', 4);
    rect.setAttribute('fill', it.hasError ? '#f87171' : '#60a5fa');
    rect.setAttribute('opacity', '0.9');
    rect.style.cursor = 'pointer';
    rect.onmouseover = (ev) => { showGanttTooltip(ev, it, minTime, totalRange); rect.setAttribute('opacity','1'); };
    rect.onmouseout = (ev) => { hideGanttTooltip(); rect.setAttribute('opacity','0.9'); };
    rect.onclick = () => { showChain(it.id); };
    svg.appendChild(rect);

    // small marker at start
    const startMark = document.createElementNS(svgNS, 'circle');
    startMark.setAttribute('cx', bx);
    startMark.setAttribute('cy', y + (rowH/2));
    startMark.setAttribute('r', 3);
    startMark.setAttribute('fill', '#fff');
    startMark.setAttribute('opacity', '0.6');
    svg.appendChild(startMark);
  });

  // append svg and tooltip element
  wrap.appendChild(svg);
  const tt = document.createElement('div');
  tt.id = 'ganttTooltip';
  tt.style.position = 'absolute';
  tt.style.pointerEvents = 'none';
  tt.style.background = '#021124';
  tt.style.border = '1px solid rgba(255,255,255,0.06)';
  tt.style.padding = '8px';
  tt.style.borderRadius = '6px';
  tt.style.color = '#cbd5e1';
  tt.style.fontSize = '12px';
  tt.style.display = 'none';
  tt.style.zIndex = '9999';
  wrap.style.position = 'relative';
  wrap.appendChild(tt);

  // responsive on window resize
  const onResize = () => {
    if (wrap._resizeTimer) clearTimeout(wrap._resizeTimer);
    wrap._resizeTimer = setTimeout(()=> renderGantt(parsed, wrap), 150);
  };
  window.addEventListener('resize', onResize);
  // store ref so caller can remove listener if needed
  wrap._ganttResizeHandler = onResize;
}

// tooltip helpers for gantt
function showGanttTooltip(ev, item, minTime, totalRange) {
  const tt = document.getElementById('ganttTooltip');
  if (!tt) return;
  const dur = (item.end.getTime() - item.start.getTime());
  const durStr = humanDuration(dur);
  tt.innerHTML = `<strong>${item.id}</strong><br>start: ${item.start.toISOString().replace('T',' ').slice(0,19)}<br>end: ${item.end.toISOString().replace('T',' ').slice(0,19)}<br>dur: ${durStr}<br><button class="filter-btn" onclick="(function(id){document.querySelector('.tab-btn[data-tab=\\'logsTab\\']').click(); setTimeout(()=>{ showChain(id); },200);} )('${item.id}')">Показать цепочку</button>`;
  tt.style.left = (ev.clientX + 8) + 'px';
  tt.style.top = (ev.clientY + 8) + 'px';
  tt.style.display = 'block';
}
function hideGanttTooltip() {
  const tt = document.getElementById('ganttTooltip');
  if (tt) tt.style.display = 'none';
}
function humanDuration(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms/1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return (hh ? hh+'h ' : '') + (mm ? mm+'m ' : '') + ss + 's';
}

// ---------------- misc helpers ----------------

function doFilterFromSearch() {
  const event = new Event('input');
  searchInput.dispatchEvent(event);
  doFilter();
}

function filterByLevel(level) {
  document.querySelectorAll('.filter-btn').forEach(b => {
    if (b.dataset && b.dataset.level) {
      if (b.dataset.level === level) b.classList.add('active');
      else b.classList.remove('active');
    }
  });
  doFilterFromSearch();
  document.querySelector('.tab-btn[data-tab="logsTab"]').click();
}

function colorForLevel(level) {
  switch((level||'').toLowerCase()) {
    case 'error': return '#f87171';
    case 'warning': return '#fbbf24';
    case 'info': return '#34d399';
    case 'debug': return '#60a5fa';
    case 'trace': return '#a78bfa';
    default: return '#94a3b8';
  }
}

// hashing helper
function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}