// Redragon Ucal Pro (dongle Compx 3554:fa09)
// INCOMPATIBIL cu citirea bateriei prin dongle: dongle-ul raportează doar starea legăturii
// (pornit/oprit), iar software-ul Redragon nu afișează bateria.
module.exports = {
  id: 'keyboard',
  name: 'Redragon Ucal Pro',
  kind: 'keyboard',
  order: 30,
  unsupported: true,
  match: { vendorId: 0x3554, productId: 0xfa09 },
  strategies: [],
};