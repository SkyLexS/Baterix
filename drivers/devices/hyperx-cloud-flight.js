// HyperX Cloud Flight Wireless (dongle 0951:1723)
// Cerere: 21 ff 05 pe canalul 0xff90 / 0x0303. Răspuns: 21 ff 05 <stare> <valoare> ...
// ATENȚIE: decodarea procentului e PROVIZORIE (tabel dintr-un proiect comunitar, verificat pe un singur nivel):
//   stare 0x10: valoare 200 = plină, 199 = se încarcă
//   stare 0x0f: valoare 130..0   -> aprox. 100%..70%
//   stare 0x0e: valoare 250..90  -> aprox. 65%..10%
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

module.exports = {
  id: 'headset',
  name: 'HyperX Cloud Flight',
  kind: 'headset',
  order: 10,
  match: { vendorId: 0x0951, productId: 0x1723 },
  strategies: [{
    type: 'request',
    channel: { usagePage: 0xff90, usage: 0x0303 },
    request: [0x21, 0xff, 0x05],
    length: 20,
    responsePrefix: [0x21, 0xff, 0x05],
    timeoutMs: 1500,
    decode(b, ctx) {
      const state = b[3], v = b[4];
      if (state === 0x10) {
        if (v === 199) return ctx.lastLevel == null ? null : { level: ctx.lastLevel, charging: true }; // la încărcare nu raportează procentul
        return { level: 100, charging: false };
      }
      if (state === 0x0f) return { level: clamp(70 + (v / 130) * 30), charging: false };
      if (state === 0x0e) return { level: clamp(10 + ((v - 90) / 160) * 55), charging: false };
      return null; // stare necunoscută: nu inventăm o valoare
    },
  }],
};