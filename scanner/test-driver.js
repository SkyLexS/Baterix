// Testează un driver fără să pornești aplicația.
// Folosește (din folderul scanner):  node test-driver.js attackshark-r5-ultra
process.env.HID_DEBUG = '1';
const path = require('path');
const name = process.argv[2];
if (!name) { console.error('Spune numele driverului, de exemplu: node test-driver.js attackshark-r5-ultra'); process.exit(1); }
const driver = require(path.join(__dirname, '..', 'drivers', name));
(async () => {
  const r = await driver.read();
  console.log('Rezultat:', r);
  process.exit(0);
})();