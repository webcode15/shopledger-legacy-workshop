const test = require('node:test');
const assert = require('node:assert/strict');
const invoice = require('../lib/invoice');

// Synthetic order with the same fields persisted by the billing route.
// No database or server imports; fixture is entirely in memory.
test('invoice total and GST breakdown match a billed mixed-rate SAVE10 order', () => {
  const order = {
    id: 43, date: '01/01/2026', customer: 'Regression fixture', coupon: 'SAVE10',
    subtotal: 1000, discount: 100, tax: 99, total: 999,
    items: [
      { id: 1, sku: 'TEST-RICE', name: 'Rice fixture', hsn: '1006', price: 400, qty: 1 },
      { id: 2, sku: 'TEST-BUTTER', name: 'Butter fixture', hsn: '0405', price: 300, qty: 1 },
      { id: 3, sku: 'TEST-TEA', name: 'Tea fixture', hsn: '0902', price: 300, qty: 1 }
    ]
  };
  const actual = invoice.computeInvoiceFigures(order);
  assert.deepEqual({ subtotal: actual.subtotal, discount: actual.discount, tax: actual.tax,
    cgst: actual.cgst, sgst: actual.sgst, total: actual.total },
    { subtotal: 1000, discount: 100, tax: 99, cgst: 49.5, sgst: 49.5, total: 999 });
  assert.deepEqual(actual.rows.map(r => [r.gstPercent, r.lineTax]), [[5, 18], [12, 32.4], [18, 48.6]]);
  const html = invoice.render(order);
  assert.ok(html.includes('Invoice Total</td><td class="r">₹999.00'));
  assert.ok(html.includes('CGST + SGST (Total GST)</td><td class="r">₹99.00'));
  assert.ok(!html.includes('Accountant Reconciliation Notice:'));
});
