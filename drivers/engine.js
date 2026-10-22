// Motor comun pentru drivere. Un periferic = o descriere (obiect JS sau fișier JSON).
// Motorul găsește canalul HID, trimite cererea, așteaptă răspunsul, decodează și ține minte ultimul nivel.
//
// Descriere:
//   { id, name, kind, order?, unsupported?, match: { vendorId, productId }, strategies: [ ... ] }
// Strategii (se încearcă în ordine; prima care dă un rezultat câștigă):
//   { type: 'request', channel, request, length?, responsePrefix?, timeoutMs?, decode }
//       scrie `request` pe canal și așteaptă un raport de intrare (ex. HyperX)
//   { type: 'feature', channel, request, length, reportId?, tries?, delayMs?, decode }
//       trimite un feature report și citește răspunsul (ex. Attack Shark)
//   { type: 'push', channel, decode }
//       ascultă rapoartele trimise singure de periferic; read() întoarce ultimul nivel primit
// channel: { usagePage?, usage? } sau { vendor: true } (toate canalele cu usagePage >= 0xff00)
// decode: funcție (buf, ctx) => { level, charging } | null, sau obiect declarativ:
//   { match: [{ byte: 0, equals: 4 }], level: { byte: 2, rawMax: 100 }, charging: { byte: 3, equals: 1 } }
// Numerele pot fi scrise ca "0x373e" în JSON; octeții cererii ca șir hex ("21 ff 05").

let nodeHid = null;
try { nodeHid = require('node-hid'); } catch { /* node-hid indisponibil */ }

const TYPES = ['request', 'feature', 'push'];
const debug = (...a) => { if (process.env.HID_DEBUG) console.log('[driver]', ...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const num = (v) => (typeof v === 'string' ? Number(v) : v);
function toBytes(v) {
  if (v == null) return [];
  if (typeof v === 'string') return [...Buffer.from(v.replace(/0x|[\s,]/gi, ''), 'hex')];
  return [...v];
}
function pad(bytes, length) {
  const out = new Array(Math.max(length ?? bytes.length, bytes.length)).fill(0);
  bytes.forEach((b, i) => { out[i] = b; });
  return out;
}

function compileDecode(spec) {
  if (typeof spec === 'function') return spec;
  if (!spec || typeof spec !== 'object' || !spec.level || typeof spec.level.byte !== 'number') {
    throw new Error('"decode" trebuie să fie o funcție sau un obiect cu "level": { byte }');
  }
  const matches = spec.match || [];
  const rawMax = spec.level.rawMax ?? 100;
  return (buf) => {
    for (const m of matches) if (buf[m.byte] !== m.equals) return null;
    const raw = buf[spec.level.byte];
    if (raw === undefined || raw > rawMax) return null;
    return {
      level: Math.round((raw / rawMax) * 100),
      charging: spec.charging ? buf[spec.charging.byte] === spec.charging.equals : false,
    };
  };
}

function validate(raw, source = 'descriere') {
  const fail = (m) => { throw new Error(`${source}: ${m}`); };
  for (const k of ['id', 'name', 'kind']) if (!raw[k]) fail(`lipsește "${k}"`);
  const match = { vendorId: num(raw.match && raw.match.vendorId), productId: num(raw.match && raw.match.productId) };
  if (!Number.isInteger(match.vendorId) || !Number.isInteger(match.productId)) fail('"match" cere vendorId și productId');

  const strategies = (raw.strategies || []).map((s, i) => {
    if (!TYPES.includes(s.type)) fail(`strategia ${i}: tip necunoscut "${s.type}" (valide: ${TYPES.join(', ')})`);
    const channel = { ...(s.channel || {}) };
    if ('usagePage' in channel) channel.usagePage = num(channel.usagePage);
    if ('usage' in channel) channel.usage = num(channel.usage);
    let decodeFn;
    try { decodeFn = compileDecode(s.decode); } catch (e) { fail(`strategia ${i}: ${e.message}`); }
    const out = { ...s, channel, key: `${s.type}-${i}`, decodeFn };
    if (s.type !== 'push') {
      out.requestBytes = toBytes(s.request);
      if (!out.requestBytes.length) fail(`strategia ${i}: lipsește "request"`);
    }
    if (s.type === 'request') out.prefix = toBytes(s.responsePrefix);
    return out;
  });
  return { ...raw, match, strategies };
}

function createDriver(raw, opts = {}) {
  const hid = opts.hid ?? nodeHid;
  const d = validate(raw, raw && raw.id ? `driver "${raw.id}"` : 'descriere');
  const st = { lastLevel: null, workingPath: {}, push: {} };

  const find = (ch) => {
    if (!hid) return [];
    return hid.devices().filter((x) =>
      x.vendorId === d.match.vendorId && x.productId === d.match.productId &&
      (ch.vendor ? (x.usagePage || 0) >= 0xff00 : (ch.usagePage == null || x.usagePage === ch.usagePage)) &&
      (ch.usage == null || x.usage === ch.usage));
  };

  const ensurePush = (s) => {
    if (st.push[s.key] || !hid) return;
    const info = find(s.channel)[0];
    if (!info) return;
    const slot = { dev: null, value: null };
    try {
      slot.dev = new hid.HID(info.path);
      slot.dev.on('data', (b) => { const r = s.decodeFn(b, st); if (r) slot.value = r; });
      slot.dev.on('error', () => { try { slot.dev.close(); } catch { /* ignorat */ } st.push[s.key] = null; });
      st.push[s.key] = slot;
    } catch (e) { debug(`${d.id}: nu pot asculta canalul`, e.message); }
  };

  const runners = {
    request: (s) => new Promise((resolve) => {
      const info = find(s.channel)[0];
      if (!info) return resolve(null);
      let dev;
      let finished = false;
      const finish = (r) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { dev && dev.close(); } catch { /* ignorat */ }
        resolve(r);
      };
      const timer = setTimeout(() => finish(null), s.timeoutMs ?? 1500);
      try { dev = new hid.HID(info.path); } catch (e) { debug(`${d.id}: nu pot deschide`, e.message); return finish(null); }
      dev.on('error', () => finish(null));
      dev.on('data', (b) => {
        if (!s.prefix.every((x, i) => b[i] === x)) return;
        finish(s.decodeFn(b, st));
      });
      try { dev.write(pad(s.requestBytes, s.length)); } catch (e) { debug(`${d.id}: write eșuat`, e.message); finish(null); }
    }),

    feature: async (s) => {
      const frame = pad(s.requestBytes, s.length);
      const preferred = st.workingPath[s.key];
      const candidates = find(s.channel).sort((a, b) => (b.path === preferred) - (a.path === preferred));
      for (const info of candidates) {
        let dev;
        try {
          dev = new hid.HID(info.path);
          for (let i = 0; i < (s.tries ?? 3); i++) {
            dev.sendFeatureReport(frame);
            await sleep(s.delayMs ?? 50);
            const r = Buffer.from(dev.getFeatureReport(s.reportId ?? frame[0], frame.length));
            debug(`${d.id}: răspuns`, r.toString('hex').slice(0, 40));
            const parsed = s.decodeFn(r, st);
            if (parsed) { st.workingPath[s.key] = info.path; return parsed; }
            await sleep(s.delayMs ?? 50);
          }
        } catch (e) {
          debug(`${d.id}: canal respins:`, e.message);
        } finally {
          try { dev && dev.close(); } catch { /* ignorat */ }
        }
      }
      st.workingPath[s.key] = null;
      return null;
    },

    push: async (s) => (st.push[s.key] && st.push[s.key].value) || null,
  };

  return {
    id: d.id, name: d.name, kind: d.kind, order: d.order, match: d.match,
    unsupported: !!d.unsupported,
    // Dongle-ul (VID/PID) e conectat? Nu spune dacă periferice e pornit.
    present() { return find({}).length > 0; },
    async read() {
      if (d.unsupported) return null;
      d.strategies.filter((s) => s.type === 'push').forEach(ensurePush); // ascultarea pornește mereu, ca rezervă
      for (const s of d.strategies) {
        let r = null;
        try { r = await runners[s.type](s); } catch (e) { debug(`${d.id}: ${s.type} a eșuat`, e.message); }
        if (r && typeof r.level === 'number') {
          if (!r.charging) st.lastLevel = r.level;
          return r;
        }
      }
      return null;
    },
    close() {
      Object.values(st.push).forEach((slot) => { try { slot && slot.dev && slot.dev.close(); } catch { /* ignorat */ } });
      st.push = {};
    },
  };
}

const hidDevices = () => (nodeHid ? nodeHid.devices() : []);

module.exports = { createDriver, validate, compileDecode, hidDevices };