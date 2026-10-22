// Attack Shark R5 Ultra, dongle 2.4G (373e:0047)
// 1) Cerere activă (citire): feature report de 65 de octeți cu 02 02 00 83 după report ID. Răspuns: marcaj 0xA1,
//    apoi procent și stare de încărcare. Protocol preluat din utilitarul comunitar attack-shark-r6-cli
//    (testat de autor doar pe R6; pe R5 Ultra a funcționat la tine).
// 2) Rezervă: mouse-ul își trimite singur 04 03 <procent> la trezire (canal 0xffa0).
//    Rapoartele 04 06 xx sunt altă stare (conexiune/somn) și se ignoră.

// Unele firmware-uri returnează (procent, încărcare), altele (încărcare, procent).
function normalize(a, b) {
  if ((a === 0 || a === 1) && b >= 0 && b <= 100) return { level: b, charging: a === 1 };
  if ((b === 0 || b === 1) && a >= 0 && a <= 100) return { level: a, charging: b === 1 };
  if (a >= 0 && a <= 100) return { level: a, charging: !!b };
  if (b >= 0 && b <= 100) return { level: b, charging: !!a };
  return null;
}

module.exports = {
  id: 'mouse',
  name: 'Attack Shark R5 Ultra',
  kind: 'mouse',
  order: 20,
  match: { vendorId: 0x373e, productId: 0x0047 },
  strategies: [
    {
      type: 'feature',
      channel: { vendor: true },
      request: [0x00, 0x00, 0x00, 0x02, 0x02, 0x00, 0x83],
      length: 65,
      reportId: 0,
      tries: 3,
      delayMs: 50,
      decode(r) {
        if (r[1] === 0xa1 && r[4] === 2 && r[6] === 131) return normalize(r[7], r[8]);
        if (r[0] === 0xa1 && r[3] === 2 && r[5] === 131) return normalize(r[6], r[7]);
        return null;
      },
    },
    {
      type: 'push',
      channel: { usagePage: 0xffa0, usage: 0x0001 },
      decode: { match: [{ byte: 0, equals: 0x04 }, { byte: 1, equals: 0x03 }], level: { byte: 2 } },
    },
  ],
};