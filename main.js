const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const drivers = require('./drivers');
const discover = require('./drivers/discover');

if (!app.requestSingleInstanceLock()) app.quit();

const APP_NAME = 'Baterix';
// În dezvoltare folosim alt ID, ca să nu se încurce cu aplicația instalată
const APP_ID = app.isPackaged ? 'ro.periph.battery' : 'ro.periph.battery.dev';

const DEFAULTS = { demo: !app.isPackaged, intervalSec: 10, autostart: false, discoveryDone: false, thresholds: {} };
// Aceeași intrare de pornire pe care o scrie și instalatorul (HKCU\...\Run, valoarea ro.periph.battery)
const AUTOSTART = { name: APP_ID, args: ['--hidden'] };
let settings = { ...DEFAULTS };
let win, tray, timer;
let quitting = false;
let state = [];
let lastScan = null, lastRaw = null, lastHint = null, discovering = false;
const DISCOVERY_SECONDS = 20;
const alerted = {};
const demo = {};

/* ---------- setări ---------- */
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* prima rulare */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (e) { console.error(e.message); }
}
const thresholdOf = (id) => settings.thresholds[id] ?? 20;

/* ---------- date demo ---------- */
const DEMO_START = { headset: [64, 1], mouse: [27, 2], keyboard: [88, 1] };
function demoRead(id) {
  const [start, step] = DEMO_START[id] || [60, 1];
  const d = (demo[id] ||= { level: start, dir: -1, step });
  d.level += d.dir * (d.dir > 0 ? 4 : d.step);
  if (d.level <= 3) d.dir = 1;
  if (d.level >= 100) { d.level = 100; d.dir = -1; }
  d.level = Math.max(0, Math.min(100, d.level));
  return { level: d.level, charging: d.dir > 0 };
}

/* ---------- notificări ---------- */
const liveNotifications = new Set(); // ține referința până se închide notificarea

// Jurnal în %APPDATA%\<aplicația>\notify.log, ca să vedem ce se întâmplă și în versiunea instalată
function logLine(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'notify.log'), `${new Date().toISOString()} ${msg}\n`); } catch { /* ignorat */ }
}

function notify(title, body) {
  logLine(`notify("${title}") supported=${Notification.isSupported()} packaged=${app.isPackaged}`);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  liveNotifications.add(n);
  const release = () => liveNotifications.delete(n);
  n.on('show', () => logLine('eveniment: show (predată către Windows)'));
  n.on('click', () => { logLine('eveniment: click'); release(); showWindow(); });
  n.on('close', () => { logLine('eveniment: close'); release(); });
  n.on('failed', (_, err) => {
    logLine(`eveniment: failed ${err}`);
    release();
    if (tray && tray.displayBalloon) tray.displayBalloon({ title, content: body, iconType: 'info' }); // doar Windows
  });
  n.show();
  logLine('show() apelat');
}

function checkAlert(dev) {
  if (dev.level == null) return;
  if (dev.charging || dev.level > dev.threshold + 5) { alerted[dev.id] = false; return; }
  if (dev.level <= dev.threshold && !alerted[dev.id]) {
    alerted[dev.id] = true;
    notify(`${dev.name}: baterie ${dev.level}%`, `A scăzut sub pragul de ${dev.threshold}%. Pune-l la încărcat.`);
  }
}

/* ---------- citire periodică ---------- */
let ticking = false;
async function tick() {
  if (ticking) return; // sare peste dacă citirea anterioară încă rulează
  ticking = true;
  try { await readAll(); } finally { ticking = false; }
}
async function readAll() {
  const out = [];
  for (const d of drivers.list) {
    let r = null;
    try { r = settings.demo ? demoRead(d.id) : await d.read(); } catch (e) { console.error(d.id, e.message); }
    let present = true;
    if (!settings.demo) { try { present = d.present ? d.present() : true; } catch { present = false; } }
    const dev = { id: d.id, name: d.name, kind: d.kind, unsupported: !!d.unsupported, present, threshold: thresholdOf(d.id), level: null, charging: false, source: 'none' };
    if (r && typeof r.level === 'number') {
      Object.assign(dev, { level: r.level, charging: !!r.charging, source: settings.demo ? 'demo' : 'auto' });
    }
    checkAlert(dev);
    out.push(dev);
  }
  state = out;
  push();
}
function schedule() {
  clearInterval(timer);
  timer = setInterval(tick, settings.demo ? 4000 : settings.intervalSec * 1000);
  tick();
}
function push() {
  if (win && !win.isDestroyed()) win.webContents.send('devices', state);
  updateTray();
}

/* ---------- tray și fereastră ---------- */
function makeIcon() {
  const s = 16, b = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4;
    if (Math.hypot(x - 7.5, y - 7.5) <= 7) { b[i] = 0xb0; b[i + 1] = 0xe0; b[i + 2] = 0x5e; b[i + 3] = 255; } // BGRA
  }
  return nativeImage.createFromBitmap(b, { width: s, height: s });
}
function showWindow() { if (win) { win.show(); win.focus(); } }
function createTray() {
  tray = new Tray(makeIcon());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Deschide', click: showWindow },
    { label: 'Deschide folderul de date', click: () => shell.openPath(app.getPath('userData')) },
    { label: 'Ieșire', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}
function updateTray() {
  if (!tray) return;
  const known = state.filter((d) => d.level != null).sort((a, b) => a.level - b.level);
  tray.setToolTip(known.length ? `${APP_NAME}: ${known[0].name} ${known[0].level}%` : APP_NAME);
}
function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 660, minWidth: 560, minHeight: 520,
    backgroundColor: '#12151c', autoHideMenuBar: true, title: APP_NAME, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

/* ---------- descoperire periferice necunoscute (ascultare pasivă) ---------- */
function discoveryState() {
  return {
    running: discovering, seconds: DISCOVERY_SECONDS,
    unknownCount: lastScan ? lastScan.unknown.length : 0,
    result: lastRaw ? { at: lastRaw.at, seconds: lastRaw.seconds, channels: discover.analyze(lastRaw, lastHint) } : null,
  };
}
function pushDiscovery() { if (win && !win.isDestroyed()) win.webContents.send('discovery', discoveryState()); }
async function runDiscovery() {
  if (discovering) return;
  discovering = true;
  lastScan = drivers.scan();
  pushDiscovery();
  try { lastRaw = await discover.listen(drivers.unknownChannels(), { seconds: DISCOVERY_SECONDS }); }
  catch (e) { console.error('Ascultare eșuată:', e.message); }
  finally { discovering = false; pushDiscovery(); }
}

/* ---------- IPC ---------- */
ipcMain.handle('get', () => ({ settings, devices: state, discovery: discoveryState() }));
ipcMain.handle('discover:run', () => { runDiscovery(); });
ipcMain.handle('discover:analyze', (_, hint) => { lastHint = hint; return discoveryState(); });
ipcMain.handle('discover:save', (_, ci, ki) => {
  const ch = discoveryState().result?.channels[ci];
  const cand = ch && ch.candidates[ki];
  if (!cand) return { ok: false, error: 'candidat inexistent' };
  try {
    const desc = discover.skeleton(ch, cand);
    const dir = path.join(app.getPath('userData'), 'devices');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${desc.id}.json`), JSON.stringify(desc, null, 2));
    drivers.addDescriptor(desc);
    tick();
    return { ok: true, id: desc.id };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('clipboard:write', (_, text) => clipboard.writeText(String(text)));
ipcMain.handle('settings:set', (_, p) => {
  const prev = { ...settings };
  for (const k of ['demo', 'intervalSec', 'autostart']) if (k in p) settings[k] = p[k];
  settings.intervalSec = Math.min(1800, Math.max(5, Number(settings.intervalSec) || 10));
  saveSettings();
  if (settings.autostart !== prev.autostart) app.setLoginItemSettings({ openAtLogin: !!settings.autostart, ...AUTOSTART });
  if (settings.demo !== prev.demo) Object.keys(alerted).forEach((k) => delete alerted[k]);
  if (settings.demo !== prev.demo || settings.intervalSec !== prev.intervalSec) schedule();
  return settings;
});
ipcMain.handle('threshold:set', (_, id, v) => {
  settings.thresholds[id] = Math.min(95, Math.max(1, Number(v)));
  alerted[id] = false;
  saveSettings();
  const dev = state.find((d) => d.id === id);
  if (dev) { dev.threshold = settings.thresholds[id]; checkAlert(dev); push(); }
});
ipcMain.handle('notify:test', () => notify('Notificare de test', 'Așa vei fi anunțat când bateria scade sub prag.'));

/* ---------- pornire ---------- */
// Windows afișează în notificare numele și iconul scurtăturii din Start Menu care poartă acest ID.
// Versiunea instalată are scurtătura creată de instalator; în dezvoltare o creăm noi.
function ensureDevShortcut() {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME} (dev).lnk`);
  try {
    shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      args: `"${app.getAppPath()}"`,
      cwd: app.getAppPath(),
      description: APP_NAME,
      icon: path.join(__dirname, 'build', 'icon.ico'),
      iconIndex: 0,
      appUserModelId: APP_ID,
    });
  } catch (e) { console.error('Nu pot crea scurtătura de dezvoltare:', e.message); }
}
app.setAppUserModelId(APP_ID);
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* rămâne în tray */ });
app.whenReady().then(() => {
  loadSettings();
  drivers.loadUserDevices(path.join(app.getPath('userData'), 'devices')); // periferice adăugate ca .json
  const found = lastScan = drivers.scan(); // ce periferice sunt conectate și ce dispozitive necunoscute există
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'scan.json'), JSON.stringify(found, null, 2)); } catch { /* ignorat */ }
  console.log('Scan:', found.known.map((k) => `${k.id}=${k.present ? 'conectat' : 'absent'}`).join(', '), `| necunoscute: ${found.unknown.length}`);
  ensureDevShortcut();
  // starea reală a pornirii automate (instalatorul sau Setările Windows o pot fi schimbat)
  const login = app.getLoginItemSettings();
  settings.autostart = !!(login.executableWillLaunchAtLogin ?? login.openAtLogin);
  createWindow();
  createTray();
  schedule();
  if (!settings.discoveryDone) { // prima pornire: ascultă o dată; după aceea doar la apăsarea butonului
    settings.discoveryDone = true;
    saveSettings();
    win.webContents.once('did-finish-load', () => runDiscovery());
  }
});