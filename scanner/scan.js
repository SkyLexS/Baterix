// Utilitar de descoperire pentru periferice HID.
//   npm run scan                      -> listează toate dispozitivele HID
//   npm run scan -- listen 0951:1723  -> afișează rapoartele primite de la un dispozitiv (VID:PID în hex)
const HID = require('node-hid');
const fs = require('fs');
const path = require('path');

const hex = (n, w = 4) => (n == null ? 'necunoscut' : '0x' + n.toString(16).padStart(w, '0'));
const [cmd, target] = process.argv.slice(2);

if (cmd === 'listen') listen(target); else list();

function list() {
  const devs = HID.devices();
  const groups = new Map();
  for (const d of devs) {
    const k = `${hex(d.vendorId)}:${hex(d.productId)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  for (const [k, items] of groups) {
    console.log(`\n${k}  ${items[0].manufacturer || ''} ${items[0].product || ''}`.trimEnd());
    for (const d of items) {
      const vendor = d.usagePage >= 0xff00 ? '   <- canal propriu al producătorului' : '';
      console.log(`   usagePage ${hex(d.usagePage)}  usage ${hex(d.usage)}  interfața ${d.interface}${vendor}`);
    }
  }
  const out = path.join(__dirname, 'scan-output.json');
  fs.writeFileSync(out, JSON.stringify(devs, null, 2));
  console.log(`\nAm salvat lista completă în ${out}`);
}

function listen(target) {
  const m = /^([0-9a-f]{4}):([0-9a-f]{4})$/i.exec(target || '');
  if (!m) { console.error('Folosește: npm run scan -- listen VID:PID   (exemplu: 0951:1723)'); process.exit(1); }
  const vid = parseInt(m[1], 16), pid = parseInt(m[2], 16);
  const found = HID.devices().filter((d) => d.vendorId === vid && d.productId === pid);
  if (!found.length) { console.error('Nu am găsit niciun dispozitiv cu acest VID:PID.'); process.exit(1); }

  const logFile = path.join(__dirname, 'listen-log.txt');
  const log = (line) => { console.log(line); fs.appendFileSync(logFile, line + '\n'); };
  log(`--- ascult ${target} (${new Date().toISOString()}) ---`);

  found.forEach((d, i) => {
    const tag = `[${i}] page ${hex(d.usagePage)} usage ${hex(d.usage)} if${d.interface}`;
    try {
      const dev = new HID.HID(d.path);
      dev.on('data', (buf) => log(`${new Date().toISOString().slice(11, 23)} ${tag}  len=${buf.length}  ${buf.toString('hex').match(/../g).join(' ')}`));
      dev.on('error', (e) => log(`${tag} eroare: ${e.message}`));
      log(`${tag}  deschis`);
    } catch (e) {
      log(`${tag}  nu se poate deschide (${e.message}). Windows blochează de obicei canalele standard de tastatură/mouse.`);
    }
  });
  log('Schimbă ceva pe dispozitiv (încarcă-l, oprește-l, schimbă volumul/DPI) și urmărește rapoartele. Ctrl+C pentru oprire.');
}
