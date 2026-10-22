// Ascultare pasivă a dispozitivelor necunoscute: deschide doar canalele proprii (usagePage >= 0xff00),
// colectează rapoartele de intrare și nu trimite nimic către dispozitive.
let nodeHid = null;
try { nodeHid = require('node-hid'); } catch { /* node-hid indisponibil */ }

const hex4 = (n) => (n == null ? null : '0x' + n.toString(16).padStart(4, '0'));
const MAX_UNIQUE = 300;

function listen(infos, { seconds = 20, hid = nodeHid } = {}) {
  return new Promise((resolve) => {
    const channels = infos.map((i) => ({
      vid: hex4(i.vendorId), pid: hex4(i.productId),
      name: [i.manufacturer, i.product].filter(Boolean).join(' '),
      usagePage: hex4(i.usagePage), usage: hex4(i.usage), interface: i.interface,
      path: i.path, total: 0, reports: new Map(), error: null, dev: null,
    }));
    for (const c of channels) {
      try {
        c.dev = new hid.HID(c.path);
        c.dev.on('data', (b) => {
          c.total++;
          const key = Buffer.from(b).toString('hex').slice(0, 128);
          if (c.reports.has(key) || c.reports.size < MAX_UNIQUE) c.reports.set(key, (c.reports.get(key) || 0) + 1);
        });
        c.dev.on('error', (e) => { c.error = /not valid/i.test(e.message) ? 'canal fără rapoarte de intrare' : e.message; });
      } catch (e) {
        c.error = e.message;
      }
    }
    const finish = () => {
      channels.forEach((c) => { try { c.dev && c.dev.close(); } catch { /* ignorat */ } });
      resolve({
        at: new Date().toISOString(), seconds,
        channels: channels.map((c) => ({
          vid: c.vid, pid: c.pid, name: c.name, usagePage: c.usagePage, usage: c.usage, interface: c.interface,
          total: c.total, error: c.error,
          reports: [...c.reports].map(([h, count]) => ({ hex: h, count })).sort((a, b) => b.count - a.count),
        })),
      });
    };
    if (!channels.length) return finish();
    setTimeout(finish, seconds * 1000);
  });
}

// Dacă știi cât are bateria (hint, în %), caută octeții care se potrivesc (direct sau scalat 0..255).
function analyze(result, hint) {
  const h = Number(hint);
  return result.channels.map((c) => {
    const candidates = [];
    if (Number.isFinite(h) && h > 0) {
      for (const r of c.reports) {
        const bytes = Buffer.from(r.hex, 'hex');
        bytes.forEach((v, i) => {
          if (i === 0) return; // primul octet e de obicei ID-ul raportului
          if (Math.abs(v - h) <= 2) candidates.push({ hex: r.hex, index: i, value: v, scale: 100, count: r.count });
          else if (v > 2 && Math.abs(Math.round((v / 255) * 100) - h) <= 2) candidates.push({ hex: r.hex, index: i, value: v, scale: 255, count: r.count });
        });
      }
      candidates.sort((a, b) => b.count - a.count);
    }
    return { ...c, candidates: candidates.slice(0, 8) };
  });
}

// Descriere pornită dintr-un candidat: strategie "push" care recunoaște raportul după primii octeți.
function skeleton(channel, cand) {
  const bytes = Buffer.from(cand.hex, 'hex');
  const match = [0, 1].filter((i) => i < cand.index).map((i) => ({ byte: i, equals: bytes[i] }));
  const level = { byte: cand.index };
  if (cand.scale === 255) level.rawMax = 255;
  const chan = { usagePage: channel.usagePage };
  if (channel.usage != null) chan.usage = channel.usage;
  return {
    id: `dev-${channel.vid.slice(2)}${channel.pid.slice(2)}`,
    name: channel.name || `Periferic ${channel.vid}:${channel.pid}`,
    kind: 'other',
    order: 90,
    match: { vendorId: channel.vid, productId: channel.pid },
    strategies: [{ type: 'push', channel: chan, decode: { match, level } }],
  };
}

module.exports = { listen, analyze, skeleton };