// Încarcă descrierile din drivers/devices/*.js (incluse) și, opțional, din fișiere .json ale utilizatorului.
const fs = require('fs');
const path = require('path');
const { createDriver, hidDevices } = require('./engine');

const list = [];

function add(driver) {
  const i = list.findIndex((x) => x.id === driver.id);
  if (i >= 0) list[i] = driver; else list.push(driver); // același id = înlocuiește
  list.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return driver;
}
const addDescriptor = (desc) => add(createDriver(desc));

function loadBuiltIn() {
  const dir = path.join(__dirname, 'devices');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js')).sort()) {
    try { add(createDriver(require(path.join(dir, f)))); } catch (e) { console.error(`Driver ${f}:`, e.message); }
  }
}

// Periferice adăugate de utilizator: fișiere .json într-un folder (ex. %APPDATA%\Baterix\devices)
function loadUserDevices(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort(); } catch { return []; }
  const loaded = [];
  for (const f of files) {
    try {
      const drv = addDescriptor(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      loaded.push(drv.id);
    } catch (e) { console.error(`Periferic ${f}:`, e.message); }
  }
  return loaded;
}

const hex = (n) => '0x' + n.toString(16).padStart(4, '0');
const sameDevice = (x, m) => x.vendorId === m.vendorId && x.productId === m.productId;
const isKnown = (x) => list.some((d) => d.match && sameDevice(x, d.match));
const isVendorChannel = (x) => (x.usagePage || 0) >= 0xff00;

// Canalele proprii ale dispozitivelor necunoscute (cu cale), pentru ascultare pasivă
const unknownChannels = (devs = hidDevices()) => devs.filter((x) => !isKnown(x) && isVendorChannel(x));

// Scan: ce periferice cunoscute sunt conectate și ce dispozitive necunoscute (cu canale proprii) există.
// Doar enumeră; nu deschide și nu trimite nimic către dispozitive.
function scan(devs = hidDevices()) {
  const known = list.map((d) => ({ id: d.id, name: d.name, present: !!d.match && devs.some((x) => sameDevice(x, d.match)) }));
  const groups = new Map();
  for (const x of unknownChannels(devs)) {
    const k = `${x.vendorId}:${x.productId}`;
    if (!groups.has(k)) groups.set(k, { vid: hex(x.vendorId), pid: hex(x.productId), name: [x.manufacturer, x.product].filter(Boolean).join(' '), channels: [] });
    groups.get(k).channels.push({ usagePage: hex(x.usagePage), usage: x.usage == null ? null : hex(x.usage), interface: x.interface });
  }
  return { at: new Date().toISOString(), known, unknown: [...groups.values()] };
}

loadBuiltIn();
module.exports = { list, loadUserDevices, add, addDescriptor, scan, unknownChannels };