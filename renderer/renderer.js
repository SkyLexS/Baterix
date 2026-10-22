const SEG = 60;
const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v6"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
};
const STATUS = { demo: 'Date demo', auto: 'Citit automat', none: 'Se așteaptă citirea' };
const grid = document.getElementById('grid');
const cards = new Map();

function line(y1, y2, cls, i) {
  const l = document.createElementNS(NS, 'line');
  l.setAttribute('x1', 60); l.setAttribute('x2', 60);
  l.setAttribute('y1', y1); l.setAttribute('y2', y2);
  l.setAttribute('class', cls);
  if (i != null) {
    l.setAttribute('transform', `rotate(${(i / SEG) * 360} 60 60)`);
    l.style.setProperty('--i', i);
  }
  return l;
}

function buildCard(dev) {
  const card = document.createElement('article');
  card.className = 'card boot';
  card.innerHTML = `
    <div class="gauge">
      <svg viewBox="0 0 120 120" aria-hidden="true"></svg>
      <div class="readout">
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${ICONS[dev.kind] || ''}</svg>
        <div class="pct"><span class="num">–</span><small>%</small></div>
      </div>
    </div>
    <div class="id"><div class="name"></div><div class="status"></div></div>
    <label class="ctl thr"><span class="row"><span>Notifică sub</span><output></output></span>
      <input type="range" min="5" max="50" step="5"></label>`;

  const svg = card.querySelector('.gauge > svg');
  const segs = [];
  for (let i = 0; i < SEG; i++) { const s = line(6, 16, 'seg', i); svg.appendChild(s); segs.push(s); }
  const notch = line(2, 20, 'notch');
  svg.appendChild(notch);

  const thr = card.querySelector('.thr input');
  const thrOut = card.querySelector('.thr output');
  thr.addEventListener('input', () => { thrOut.textContent = thr.value + '%'; });
  thr.addEventListener('change', () => window.api.setThreshold(dev.id, Number(thr.value)));

  setTimeout(() => card.classList.remove('boot'), 1600);
  const entry = { card, segs, notch, thr, thrOut };
  cards.set(dev.id, entry);
  grid.appendChild(card);
  return entry;
}

function stateOf(dev) {
  if (dev.level == null) return 'none';
  if (dev.level <= dev.threshold) return 'low';
  if (dev.level <= dev.threshold + 15) return 'warn';
  return 'ok';
}

function statusText(dev) {
  if (dev.charging) return 'Se încarcă';
  if (dev.level != null) return STATUS[dev.source];
  if (!dev.present) return 'Dongle neconectat';
  return dev.unsupported ? 'Nu se poate citi automat' : 'Fără răspuns (oprit sau adormit?)';
}

function updateCard(dev) {
  const c = cards.get(dev.id) || buildCard(dev);
  const lit = dev.level == null ? 0 : Math.round((dev.level / 100) * SEG);
  c.segs.forEach((s, i) => s.classList.toggle('on', i < lit));
  c.notch.setAttribute('transform', `rotate(${(dev.threshold / 100) * 360} 60 60)`);
  c.card.dataset.state = stateOf(dev);
  c.card.querySelector('.num').textContent = dev.level == null ? '–' : dev.level;
  c.card.querySelector('.name').textContent = dev.name;
  c.card.querySelector('.status').textContent = statusText(dev);

  if (document.activeElement !== c.thr) c.thr.value = dev.threshold;
  c.thrOut.textContent = dev.threshold + '%';

  c.thr.closest('.ctl').hidden = dev.unsupported && dev.level == null;
}

function render(devices) {
  devices.forEach(updateCard);
  const known = devices.filter((d) => d.level != null).sort((a, b) => a.level - b.level);
  const low = devices.filter((d) => d.level != null && d.level <= d.threshold && !d.charging).length;
  const summary = document.getElementById('summary');
  if (!known.length) summary.textContent = 'Niciun periferic citit încă. Pornește perifericele sau activează datele demo.';
  else if (low) summary.textContent = `${low} ${low === 1 ? 'periferic' : 'periferice'} sub prag. Cel mai scăzut: ${known[0].name}, ${known[0].level}%.`;
  else summary.textContent = `Totul în regulă. Cel mai scăzut: ${known[0].name}, ${known[0].level}%.`;
}

function applySettings(s) {
  document.getElementById('demo').checked = s.demo;
  document.getElementById('autostart').checked = s.autostart;
  const sel = document.getElementById('interval');
  sel.value = String(s.intervalSec);
  sel.disabled = s.demo;
}

/* ---------- descoperire periferice necunoscute ---------- */
const disc = {
  details: document.getElementById('discover'), count: document.getElementById('discoverCount'),
  hint: document.getElementById('hint'), listen: document.getElementById('listen'),
  copy: document.getElementById('copyDiscovery'), out: document.getElementById('discoverOut'),
};
let discState = null;
let countdown = null;

function h(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
}

function renderDiscovery(state) {
  if (!state) return;
  discState = state;
  disc.count.textContent = `(${state.unknownCount})`;
  disc.listen.disabled = state.running;
  clearInterval(countdown);
  if (state.running) {
    disc.details.open = true;
    let left = state.seconds;
    disc.listen.textContent = `Ascult… ${left} s`;
    countdown = setInterval(() => { left = Math.max(0, left - 1); disc.listen.textContent = `Ascult… ${left} s`; }, 1000);
  } else {
    disc.listen.textContent = `Ascultă ${state.seconds} s`;
  }
  disc.copy.hidden = !state.result;
  disc.out.replaceChildren();
  if (!state.result) {
    disc.out.append(h('p', { className: 'muted', textContent: state.unknownCount ? 'Încă nu ai ascultat.' : 'Nu am găsit dispozitive necunoscute cu canale proprii.' }));
    return;
  }
  const active = state.result.channels.map((c, ci) => ({ c, ci })).filter(({ c }) => c.total > 0);
  const silent = state.result.channels.length - active.length;
  if (!active.length) disc.out.append(h('p', { className: 'muted', textContent: 'Niciun raport primit. Încearcă din nou și pornește/oprește perifericul în timpul ascultării.' }));
  for (const { c, ci } of active) {
    const box = h('div', { className: 'chan' },
      h('div', { className: 'chan-title', textContent: `${c.name || 'Dispozitiv'} · ${c.vid}:${c.pid} · ${c.usagePage}/${c.usage ?? '-'} · ${c.total} rapoarte` }),
      c.reports.slice(0, 4).map((r) => h('div', { className: 'mono', textContent: `${r.hex.match(/../g).join(' ')}  ×${r.count}` })));
    c.candidates.forEach((k, ki) => {
      const btn = h('button', { type: 'button', textContent: 'Adaugă' });
      btn.addEventListener('click', async () => {
        const r = await window.api.discoverSave(ci, ki);
        btn.textContent = r.ok ? 'Adăugat ✓' : `Eroare: ${r.error}`;
        btn.disabled = true;
      });
      box.append(h('div', { className: 'cand' },
        h('span', { textContent: `Posibil nivel: octetul ${k.index} = ${k.value}${k.scale === 255 ? ' (scală 0–255)' : ''} în ${k.hex.match(/../g).slice(0, 4).join(' ')}…  ` }), btn));
    });
    disc.out.append(box);
  }
  if (silent) disc.out.append(h('p', { className: 'muted', textContent: `${silent} canale fără activitate.` }));
}

function initDiscovery(state) {
  disc.listen.addEventListener('click', () => window.api.discoverRun());
  disc.hint.addEventListener('change', async () => renderDiscovery(await window.api.discoverAnalyze(disc.hint.value ? Number(disc.hint.value) : null)));
  disc.copy.addEventListener('click', () => {
    if (!discState || !discState.result) return;
    const text = JSON.stringify(discState.result.channels.filter((c) => c.total > 0).map(({ name, vid, pid, usagePage, usage, total, reports, candidates }) => ({ name, vid, pid, usagePage, usage, total, reports: reports.slice(0, 20), candidates })), null, 2);
    window.api.copyText(text);
    disc.copy.textContent = 'Copiat ✓';
    setTimeout(() => { disc.copy.textContent = 'Copiază rezultatul'; }, 1500);
  });
  window.api.onDiscovery(renderDiscovery);
  renderDiscovery(state);
}

/* ---------- pornire ---------- */
(async () => {
  const { settings, devices, discovery } = await window.api.get();
  applySettings(settings);
  render(devices);
  window.api.onDevices(render);
  initDiscovery(discovery);

  const save = async (p) => applySettings(await window.api.setSettings(p));
  document.getElementById('demo').addEventListener('change', (e) => save({ demo: e.target.checked }));
  document.getElementById('autostart').addEventListener('change', (e) => save({ autostart: e.target.checked }));
  document.getElementById('interval').addEventListener('change', (e) => save({ intervalSec: Number(e.target.value) }));
  document.getElementById('test').addEventListener('click', () => window.api.testNotification());
})();