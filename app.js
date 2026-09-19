/* ==========================================================================
   Seating planner – names are typed directly on the tables.
   State: { [tableId]: ["Name", "Name", ...] } – index = seat number.
   Autosaved to localStorage; import/export as .xlsx via SheetJS.
   ========================================================================== */

const STORAGE_KEY = 'svadba-planner-v1';

/* Plan is designed in fixed "plan units" and zoomed to fit the window. */
const PLAN_W = 1900;
const PLAN_H = 1240;

const TYPE_LABEL = { round: 'Round', rect: 'Rectangular', square: 'Square' };

/* Tables: position/width in plan units, `cols` = name columns, `seats` = capacity.
   Heights grow automatically with the number of names. */
const TABLES = [
  { id: 0,  type: 'rect',   x: 520,  y: 15,  w: 660, cols: 4, seats: 8  }, // top, head table
  { id: 1,  type: 'round',  x: 320,  y: 105, w: 300, cols: 2, seats: 10 }, // top-left
  { id: 2,  type: 'round',  x: 320,  y: 280, w: 300, cols: 2, seats: 10 }, // below 1
  { id: 3,  type: 'round',  x: 1080, y: 105, w: 300, cols: 2, seats: 10 }, // top-right
  { id: 4,  type: 'round',  x: 1080, y: 280, w: 300, cols: 2, seats: 10 }, // below 3
  { id: 5,  type: 'rect',   x: 15,   y: 520, w: 560, cols: 4, seats: 20 }, // lower section, left top
  { id: 6,  type: 'rect',   x: 15,   y: 860, w: 560, cols: 4, seats: 20 }, // lower section, left bottom
  { id: 7,  type: 'rect',   x: 1120,  y: 520, w: 560, cols: 4, seats: 20 }, // lower section, right top
  { id: 8,  type: 'rect',   x: 1120,  y: 860, w: 560, cols: 4, seats: 20 }, // lower section, right bottom
  { id: 9,  type: 'rect',   x: 1685, y: 500, w: 200, cols: 1, seats: 20 }, // far right, vertical
  { id: 10, type: 'square', x: 535,  y: 1075, w: 340, cols: 2, seats: 10 }, // very bottom, small
];

/* Walkable (light) floor area; everything else is wall. */
const FLOOR = [
  { x: 290, y: 0,    w: 1120, h: 455 }, // upper room
  { x: 610, y: 450,  w: 480,  h: 40 },  // passage
  { x: 0,   y: 480,  w: 1900, h: 580 }, // middle band
  { x: 530, y: 1060, w: 540,  h: 180 }, // bottom corridor
];

/* ------------------------------ State ------------------------------ */
let state = loadState();

function emptyState() {
  const s = {};
  TABLES.forEach(t => { s[t.id] = []; });
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    const s = emptyState();
    TABLES.forEach(t => {
      if (Array.isArray(parsed[t.id])) s[t.id] = parsed[t.id].map(v => String(v ?? ''));
    });
    return s;
  } catch {
    return emptyState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function capacityOf(t) { return t.seats; }
function guestsOf(id) { return state[id].filter(n => n.trim() !== ''); }
function totalGuests() { return TABLES.reduce((sum, t) => sum + guestsOf(t.id).length, 0); }

/* Drop trailing empty seats so arrays don't grow forever. */
function normalize(id) {
  const arr = state[id];
  while (arr.length && arr[arr.length - 1].trim() === '') arr.pop();
}

/* ------------------------------ DOM ------------------------------ */
const $ = sel => document.querySelector(sel);
const plan = $('#plan');
const planScale = $('#plan-scale');
const workspace = $('#workspace');
const guestCountEl = $('#guest-count');
const searchEl = $('#search');
const zoomEl = $('#zoom');

function el(tag, cls, attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/* ------------------------------ Plan ------------------------------ */
function buildPlan() {
  plan.style.width = PLAN_W + 'px';
  plan.style.height = PLAN_H + 'px';
  plan.innerHTML = '';

  FLOOR.forEach(f => {
    const d = el('div', 'floor');
    Object.assign(d.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
    plan.appendChild(d);
  });

  TABLES.forEach(t => {
    const d = el('div', `table ${t.type}`);
    d.dataset.id = t.id;
    Object.assign(d.style, { left: t.x + 'px', top: t.y + 'px', width: t.w + 'px' });
    d.style.gridTemplateColumns = `repeat(${t.cols}, 1fr)`;
    d.style.gridAutoFlow = 'column';
    d.title = `${TYPE_LABEL[t.type]} table · ${capacityOf(t)} seats`;

    const add = el('button', 'add-seat', { type: 'button', title: 'Add an extra seat' });
    add.textContent = '+';
    add.addEventListener('click', () => {
      const rows = Math.max(capacityOf(t), state[t.id].length);
      while (state[t.id].length < rows + 1) state[t.id].push('');
      renderTable(t, rows);
    });
    d.appendChild(add);

    // Click on empty table background → focus first empty seat
    d.addEventListener('click', e => {
      if (e.target !== d) return;
      const empty = [...d.querySelectorAll('input')].find(i => i.value.trim() === '');
      (empty || d.querySelector('input'))?.focus();
    });

    plan.appendChild(d);
    renderTable(t);
  });
  refreshCounts();
}

function renderTable(t, focusIndex = null) {
  const d = plan.querySelector(`.table[data-id="${t.id}"]`);
  d.querySelectorAll('.seat').forEach(s => s.remove());

  const cap = capacityOf(t);
  const names = state[t.id];
  const seats = Math.max(cap, names.length);
  const rows = Math.ceil(seats / t.cols);
  d.style.gridTemplateRows = `repeat(${rows}, auto)`;

  const addBtn = d.querySelector('.add-seat');
  for (let i = 0; i < seats; i++) {
    const seat = el('div', 'seat' + (i >= cap ? ' extra' : ''));
    const input = el('input', '', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    input.placeholder = i >= cap ? 'extra' : '';
    input.value = names[i] || '';
    input.dataset.index = i;
    if (input.value.trim()) input.classList.add('filled');

    input.addEventListener('input', () => {
      while (state[t.id].length <= i) state[t.id].push('');
      state[t.id][i] = input.value;
      input.classList.toggle('filled', input.value.trim() !== '');
      saveState();
      refreshCounts();
      applySearch();
    });
    input.addEventListener('blur', () => {
      // Remove trailing empty extra seats once the user leaves them
      if (i >= cap && state[t.id].length > cap) {
        const before = state[t.id].length;
        normalize(t.id);
        if (state[t.id].length !== before) { saveState(); renderTable(t); }
      }
    });
    input.addEventListener('keydown', e => {
      const go = idx => {
        const target = d.querySelector(`input[data-index="${idx}"]`);
        if (target) { e.preventDefault(); target.focus(); target.select(); return true; }
        return false;
      };
      if (e.key === 'Enter') {
        if (!go(i + 1)) { e.preventDefault(); addBtn.click(); }
      } else if (e.key === 'ArrowDown') {
        go(i + 1);
      } else if (e.key === 'ArrowUp') {
        go(i - 1);
      } else if (e.key === 'ArrowRight' && input.selectionStart === input.value.length) {
        go(i + rows);
      } else if (e.key === 'ArrowLeft' && input.selectionStart === 0) {
        go(i - rows);
      } else if (e.key === 'Escape') {
        input.blur();
      }
    });

    seat.appendChild(input);
    d.insertBefore(seat, addBtn);
  }

  d.classList.toggle('over', guestsOf(t.id).length > cap);

  if (focusIndex !== null) {
    d.querySelector(`input[data-index="${Math.min(focusIndex, seats - 1)}"]`)?.focus();
  }
  applySearch();
}

function refreshCounts() {
  guestCountEl.textContent = totalGuests();
  TABLES.forEach(t => {
    plan.querySelector(`.table[data-id="${t.id}"]`).classList.toggle('over', guestsOf(t.id).length > capacityOf(t));
  });
}

function applySearch() {
  const q = searchEl.value.trim().toLowerCase();
  plan.querySelectorAll('.seat input').forEach(inp => {
    inp.classList.toggle('match', q !== '' && inp.value.toLowerCase().includes(q));
  });
}

function renderAll() {
  TABLES.forEach(t => renderTable(t));
  refreshCounts();
}

/* ------------------------------ Zoom ------------------------------ */
function fitScale() {
  const w = workspace.clientWidth - 32;
  const h = workspace.clientHeight - 32;
  return Math.min(w / PLAN_W, h / PLAN_H);
}
function applyZoom() {
  const z = fitScale() * parseFloat(zoomEl.value);
  planScale.style.zoom = z;
}
zoomEl.addEventListener('input', applyZoom);
$('#zoom-fit').addEventListener('click', () => { zoomEl.value = 1; applyZoom(); });
window.addEventListener('resize', applyZoom);
workspace.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const v = Math.min(2, Math.max(0.5, parseFloat(zoomEl.value) - Math.sign(e.deltaY) * 0.05));
  zoomEl.value = v.toFixed(2);
  applyZoom();
}, { passive: false });

/* ------------------------------ Export / Import ------------------------------ */
function exportXlsx() {
  const rows = [['Table', 'Type', 'Seat', 'Name']];
  TABLES.forEach(t => {
    state[t.id].forEach((name, i) => {
      if (name.trim() !== '') rows.push([t.id, TYPE_LABEL[t.type], i + 1, name.trim()]);
    });
  });

  const summary = [['Table', 'Type', 'Capacity', 'Guests', 'Free']];
  TABLES.forEach(t => {
    const n = guestsOf(t.id).length;
    summary.push([t.id, TYPE_LABEL[t.type], capacityOf(t), n, capacityOf(t) - n]);
  });
  summary.push([]);
  summary.push(['Total', '', TABLES.reduce((s, t) => s + capacityOf(t), 0), totalGuests(), '']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 6 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Guests');
  const ws2 = XLSX.utils.aoa_to_sheet(summary);
  ws2['!cols'] = [{ wch: 8 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `seating-${stamp}.xlsx`);
  toast(`Exported ${rows.length - 1} guests`);
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const sheetName = wb.SheetNames.includes('Guests') ? 'Guests' : wb.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      const result = parseRows(data);
      if (!result) throw new Error('Could not find "Table" and "Name" columns in the first row.');

      const fresh = emptyState();
      let count = 0, skipped = 0;
      result.forEach(({ table, seat, name }) => {
        if (!(table in fresh)) { skipped++; return; }
        if (seat !== null && seat >= 1) {
          while (fresh[table].length < seat) fresh[table].push('');
          if (fresh[table][seat - 1].trim() === '') fresh[table][seat - 1] = name;
          else fresh[table].push(name);
        } else {
          fresh[table].push(name);
        }
        count++;
      });

      const proceed = totalGuests() === 0 ||
        confirm(`Replace the current ${totalGuests()} guests with ${count} guests from "${file.name}"?`);
      if (!proceed) return;

      state = fresh;
      saveState();
      renderAll();
      toast(`Imported ${count} guests` + (skipped ? ` (${skipped} rows skipped – unknown table)` : ''));
    } catch (err) {
      toast('Import failed: ' + err.message, true);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* Returns [{table, seat|null, name}] or null if headers can't be matched. */
function parseRows(data) {
  if (!data.length) return null;
  const header = data[0].map(h => String(h).trim().toLowerCase());
  const col = names => header.findIndex(h => names.includes(h));
  const iTable = col(['table', 'table number', 'table no', 'sto', 'stol']);
  const iName = col(['name', 'guest', 'guest name', 'full name', 'ime', 'gost']);
  const iSeat = col(['seat', 'seat number', 'mesto', 'mjesto']);
  if (iTable < 0 || iName < 0) return null;

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const name = String(row[iName] ?? '').trim();
    const table = parseInt(String(row[iTable]).trim(), 10);
    if (!name || Number.isNaN(table)) continue;
    const seat = iSeat >= 0 ? parseInt(String(row[iSeat]).trim(), 10) : NaN;
    out.push({ table, seat: Number.isNaN(seat) ? null : seat, name });
  }
  return out;
}

/* ------------------------------ Misc UI ------------------------------ */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2500);
}

$('#btn-export').addEventListener('click', exportXlsx);
$('#btn-import').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importFile(file);
  e.target.value = '';
});
$('#btn-clear').addEventListener('click', () => {
  const n = totalGuests();
  if (n && !confirm(`Remove all ${n} guests from every table?`)) return;
  state = emptyState();
  saveState();
  renderAll();
});
searchEl.addEventListener('input', applySearch);

buildPlan();
applyZoom();
