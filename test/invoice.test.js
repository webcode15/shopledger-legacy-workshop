const test = require('node:test');
const assert = require('node:assert/strict');
const invoice = require('../lib/invoice');
const pricing = require('../lib/pricing');

// Only pure calculation modules are imported: no server, routes, or store.
// All orders are synthetic in-memory fixtures, never database records.
function line(price = 100, hsn = '1006', extra = {}) {
  return { id: 1, sku: 'TEST', name: 'Test item', price, qty: 1, hsn, ...extra };
}
function order(items, coupon = '', stored = {}) {
  return { id: 42, date: '01/01/2026', customer: 'Test customer',
    paymentMode: 'cash', status: 'completed', items, coupon, ...stored };
}
function figures(result) {
  const { subtotal, discount, tax, cgst, sgst, total } = result;
  return { subtotal, discount, tax, cgst, sgst, total };
}

test('empty invoice has zero figures and no rows', () => {
  assert.deepEqual(invoice.computeInvoiceFigures(order([])), {
    subtotal: 0, discount: 0, tax: 0, cgst: 0, sgst: 0, total: 0, rows: []
  });
});

test('explicit percentage GST rate produces invoice line details and split GST', () => {
  const result = invoice.computeInvoiceFigures(order([line(100, '1006', { qty: 2, gstRate: 12 })]));
  assert.deepEqual(figures(result), { subtotal: 200, discount: 0, tax: 24, cgst: 12, sgst: 12, total: 224 });
  assert.deepEqual(result.rows, [{ name: 'Test item', sku: 'TEST', hsn: '1006', qty: 2,
    price: 100, gstPercent: 12, line: 200, lineTax: 24 }]);
});

test('invoice uses the same mixed HSN slabs as billing', () => {
  const items = [line(100, '1006'), line(100, '0405', { id: 2 }), line(100, '0902', { id: 3 })];
  const billed = pricing.computeTotals(items, '');
  const printed = invoice.computeInvoiceFigures(order(items));
  assert.deepEqual(figures(billed), { subtotal: 300, discount: 0, tax: 35, cgst: 17.5, sgst: 17.5, total: 335 });
  assert.deepEqual(figures(printed), { subtotal: 300, discount: 0, tax: 35, cgst: 17.5, sgst: 17.5, total: 335 });
  assert.deepEqual(printed.rows.map(r => r.gstPercent), [5, 12, 18]);
});

test('CURRENT BEHAVIOUR: invoice ignores stored billed figures when recomputing totals', () => {
  const items = [line()];
  const stored = { subtotal: 999, discount: 20, tax: 1, total: 980, cgst: 0.5, sgst: 0.5 };
  assert.deepEqual(figures(invoice.computeInvoiceFigures(order(items, '', stored))),
    { subtotal: 100, discount: 0, tax: 5, cgst: 2.5, sgst: 2.5, total: 105 });
});

test('percentage coupon reduces taxable value before invoice GST', () => {
  const items = [line(1000, '0902')];
  assert.deepEqual(figures(pricing.computeTotals(items, 'SAVE10')),
    { subtotal: 1000, discount: 100, tax: 162, cgst: 81, sgst: 81, total: 1062 });
  assert.deepEqual(figures(invoice.computeInvoiceFigures(order(items, 'SAVE10'))),
    { subtotal: 1000, discount: 100, tax: 162, cgst: 81, sgst: 81, total: 1062 });
});

test('invoice respects percentage coupon maximum discount', () => {
  const items = [line(2000, '0902')];
  assert.deepEqual(figures(pricing.computeTotals(items, 'SAVE10')),
    { subtotal: 2000, discount: 150, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183 });
  assert.deepEqual(figures(invoice.computeInvoiceFigures(order(items, 'SAVE10'))),
    { subtotal: 2000, discount: 150, tax: 333, cgst: 166.5, sgst: 166.5, total: 2183 });
});

test('flat coupon reduces invoice taxable value', () => {
  const items = [line(500, '0902')];
  assert.deepEqual(figures(pricing.computeTotals(items, 'FLAT50')),
    { subtotal: 500, discount: 50, tax: 81, cgst: 40.5, sgst: 40.5, total: 531 });
  assert.deepEqual(figures(invoice.computeInvoiceFigures(order(items, 'FLAT50'))),
    { subtotal: 500, discount: 50, tax: 81, cgst: 40.5, sgst: 40.5, total: 531 });
});

test('invoice ignores coupon below minimum without producing negative total', () => {
  const items = [line(10, '0902')];
  assert.equal(pricing.computeTotals(items, 'FLAT50').discount, 0);
  assert.deepEqual(figures(invoice.computeInvoiceFigures(order(items, 'FLAT50'))),
    { subtotal: 10, discount: 0, tax: 1.8, cgst: 0.9, sgst: 0.9, total: 11.8 });
});

test('invoice ignores inactive coupon', () => {
  const items = [line(1000, '0902')];
  assert.equal(pricing.computeTotals(items, 'DIWALI20').discount, 0);
  assert.equal(invoice.computeInvoiceFigures(order(items, 'DIWALI20')).discount, 0);
});

test('invoice normalizes coupon case and whitespace and ignores unknown coupons', () => {
  const items = [line(1000, '0902')];
  assert.equal(pricing.computeTotals(items, ' save10 ').discount, 100);
  assert.equal(invoice.computeInvoiceFigures(order(items, ' save10 ')).discount, 100);
  assert.equal(invoice.computeInvoiceFigures(order(items, 'UNKNOWN')).discount, 0);
});

test('invoice preserves zero and decimal GST rates like billing', () => {
  const zero = [line(100, '1006', { gstRate: 0 })];
  assert.equal(pricing.computeTotals(zero, '').tax, 0);
  assert.equal(invoice.computeInvoiceFigures(order(zero)).tax, 0);
  const decimal = [line(100, '1006', { gstRate: 0.05 })];
  assert.equal(pricing.computeTotals(decimal, '').tax, 5);
  const printed = invoice.computeInvoiceFigures(order(decimal));
  assert.equal(printed.tax, 5);
  assert.equal(printed.rows[0].gstPercent, 5);
});

test('invoice sums rounded line taxes like billing', () => {
  const items = [line(0.03, '0902'), line(0.03, '0902', { id: 2 })];
  assert.equal(pricing.computeTotals(items, '').tax, 0.02);
  const printed = invoice.computeInvoiceFigures(order(items));
  assert.deepEqual(printed.rows.map(r => r.lineTax), [0.01, 0.01]);
  assert.deepEqual(figures(printed), { subtotal: 0.06, discount: 0, tax: 0.02, cgst: 0.01, sgst: 0.01, total: 0.08 });
});

test('rendered invoice still warns when stored order total conflicts with billing calculation', () => {
  const html = invoice.render(order([line()], '', { subtotal: 100, discount: 0, tax: 4, total: 104 }));
  assert.ok(html.includes('Invoice Total</td><td class="r">₹105.00'));
  assert.ok(html.includes('CGST + SGST (Total GST)</td><td class="r">₹5.00'));
  assert.ok(html.includes('Order Ledger recorded total (₹104.00) by +₹1.00.'));
  assert.ok(html.includes('Accountant Reconciliation Notice:'));
});

test('rendered coupon invoice matches billed GST as well as total without a mismatch notice', () => {
  const items = [line(1000, '0902')];
  const billed = pricing.computeTotals(items, 'SAVE10');
  assert.equal(billed.tax, 162);
  const html = invoice.render(order(items, 'SAVE10', billed));
  assert.ok(html.includes('CGST + SGST (Total GST)</td><td class="r">₹162.00'));
  assert.ok(!html.includes('Accountant Reconciliation Notice:'));
});
