// Trimite o cerere pe canalele proprii (vendor) ale unui dispozitiv HID și ascultă TOATE canalele.
// Folosește:  node probe.js VID:PID OCTETI_HEX [lungime] [secunde_ascultare]
// Exemplu:    node probe.js 0951:1723 21ff05 20 8
const HID = require('node-hid');
const fs = require('fs');
const path = require('path');

const [target, hexBytes, lenArg, secArg] = process.argv.slice(2);
const m = /^([0-9a-f]{4}):([0-9a-f]{4})$/i.exec(target || '');
if (!m || !/^([0-9a-f]{2})+$/i.test(hexBytes || '')) {
  console.error('Folosește: node probe.js VID:PID OCTETI_HEX [lungime] [secunde]\nExemplu: node probe.js 0951:1723 21ff05 20 8');
  process.exit(1);
}
const vid = parseInt(m[1], 16), pid = parseInt(m[2], 16);
const len = Number(lenArg) || 20;
const listenMs = (Number(secArg) || 8) * 1000;
const frame = Buffer.alloc(len);
Buffer.from(hexBytes, 'hex').copy(frame);

const hex = (n) => (n == null ? '?' : '0x' + n.toString(16).padStart(4, '0'));
const fmt = (b) => Buffer.from(b).toString('hex').match(/../g).join(' ');
const logFile = path.join(__dirname, 'probe-log.txt');
const log = (s) => { console.log(s); fs.appendFileSync(logFile, s + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  log(`--- probă ${target}, cerere: ${fmt(frame)} (${new Date().toISOString()}) ---`);
  const infos = HID.devices().filter((d) => d.vendorId === vid && d.productId === pid && d.usagePage >= 0xff00);
  if (!infos.length) { log('Nu am găsit canale proprii pentru acest VID:PID.'); return; }

  // 1. deschide toate canalele și ascultă pe ele
  const open = [];
  for (const [i, d] of infos.entries()) {
    const tag = `[${i}] page ${hex(d.usagePage)} usage ${hex(d.usage)}`;
    try {
      const dev = new HID.HID(d.path);
      dev.on('data', (b) => log(`${new Date().toISOString().slice(11, 23)} ${tag}  <- (${b.length}): ${fmt(b)}`));
      dev.on('error', () => {});
      open.push({ dev, tag });
      log(`${tag}  deschis`);
    } catch (e) { log(`${tag}  nu se poate deschide: ${e.message}`); }
  }

  // 2. trimite cererea pe canalele care o acceptă
  for (const { dev, tag } of open) {
    try { dev.write([...frame]); log(`${tag}  cerere trimisă (write)`); } catch { /* canalul nu acceptă scriere */ }
  }

  // 3. ascultă; în acest timp mișcă rotița de volum sau apasă mute pe căști
  log(`Ascult ${listenMs / 1000} secunde... Mișcă rotița de volum sau apasă mute pe cască.`);
  await sleep(listenMs);
  open.forEach(({ dev }) => { try { dev.close(); } catch { /* ignorat */ } });
  log('--- gata ---');
})();