const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.classList = { toggle() {}, contains() { return false; }, remove() {}, add() {} };
    this.open = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener() {}
  querySelector() { return null; }
  getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0 }; }
  get childElementCount() { return this.children.length; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const ids = new Map();
const element = id => { if (!ids.has(id)) ids.set(id, new Element()); return ids.get(id); };

const products = [
  { id: 1, name: 'กระเป๋าสาน', price: 1290, category: 'คราฟต์', story: 'เรื่องเล่า', video_path: 'captures/videos/a.mp4' },
  { id: 2, name: 'ผ้าทอ', price: 850, origin: 'น่าน' },
];
const context = vm.createContext({
  document: { getElementById: element, createElement: tag => new Element(tag), addEventListener() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch: async () => ({ ok: true, json: async () => products }),
  Intl, console,
});
vm.runInContext(fs.readFileSync('frontend/static/js/spin-viewer.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('frontend/static/js/products.js', 'utf8'), context);

(async () => {
  await new Promise(r => setImmediate(r));
  const grid = element('showcaseGrid');
  assert.equal(grid.children.length, 2, 'one card per product');
  assert(grid.children[0].children.some(n => n.children?.some(c => c.textContent === '▶ วิดีโอ')),
    'a product with a video shows the video badge');

  // Tapping a card opens the detail popup with the product's fields.
  context.openDetail(products[0]);
  const popup = element('productPopup');
  assert.equal(popup.open, true, 'popup opens on card tap');
  const flat = element('popupContent').children.flatMap(n => [n, ...n.children]);
  assert(flat.some(n => n.textContent === 'กระเป๋าสาน'), 'popup shows the product name');
  assert(flat.some(n => n.tag === 'video'), 'popup embeds the product video');

  context.closeDetail();
  assert.equal(popup.open, false, 'popup closes');
  console.log('PASS: showcase grid, video badge, detail popup');
})().catch(e => { console.error(e); process.exitCode = 1; });
