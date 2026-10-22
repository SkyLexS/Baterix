let HID = null;
try { HID = require('node-hid'); } catch (e) { console.error('node-hid indisponibil:', e.message); }

// Caută un dispozitiv HID după VID/PID (și opțional usagePage/usage/interface).
function find({ vendorId, productId, usagePage, usage, interface: iface }) {
  if (!HID || vendorId == null || productId == null) return null;
  return HID.devices().find((d) =>
    d.vendorId === vendorId && d.productId === productId &&
    (usagePage == null || d.usagePage === usagePage) &&
    (usage == null || d.usage === usage) &&
    (iface == null || d.interface === iface)) || null;
}

function open(match) {
  const info = find(match);
  return info ? new HID.HID(info.path) : null;
}

module.exports = { find, open };
