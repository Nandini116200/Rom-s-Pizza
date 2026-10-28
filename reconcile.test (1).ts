import { describe, expect, it } from 'vitest';
import { reconcile, orderTotal } from './reconcile';
import { buildSeed } from './seed';
import { Dataset, Order } from './types';

const NOW = new Date('2026-10-28T23:00:00');
const mk = (id: string, over: Partial<Order> = {}): Order => ({
  id, outletId: 'O', ts: '2026-10-28T12:00:00', shift: 'LUNCH', items: [{ pizza: 'M', qty: 2, unitPrice: 25000 }],
  discount: 0, tax: 2500, payment: 'COD', status: 'DELIVERED', ...over,
}); // total = 52500
const empty = (): Dataset => ({ orders: [], receipts: [], deliveries: [], collections: [], deposits: [], adjustments: [], production: [] });

function clean(id = 'A'): Dataset {
  const ds = empty();
  ds.orders.push(mk(id));
  ds.receipts.push({ id: 'R' + id, orderId: id, ts: '2026-10-28T12:01:00', amount: 52500 });
  ds.deliveries.push({ id: 'D' + id, orderId: id, personId: 'P1', status: 'DELIVERED' });
  ds.collections.push({ id: 'C' + id, orderId: id, deliveryId: 'D' + id, personId: 'P1', amount: 52500, ts: '2026-10-28T12:40:00' });
  ds.deposits.push({ id: 'X' + id, outletId: 'O', ref: 'REF', ts: '2026-10-28T16:00:00', declaredAmount: 52500, allocations: [{ collectionId: 'C' + id, amount: 52500 }] });
  return ds;
}
const types = (ds: Dataset) => reconcile(ds, NOW).discrepancies.map(d => d.type).sort();
const row = (ds: Dataset) => reconcile(ds, NOW).rows[0];

describe('reconcile', () => {
  it('fully reconciled order is MATCHED with no discrepancies', () => {
    const ds = clean();
    expect(orderTotal(ds.orders[0])).toBe(52500);
    expect(row(ds)).toMatchObject({ status: 'MATCHED', expected: 52500, collected: 52500, deposited: 52500, outstanding: 0, variance: 0 });
    expect(types(ds)).toEqual([]);
  });
  it('1. delivered COD with no collection', () => {
    const ds = clean(); ds.collections = []; ds.deposits = [];
    expect(row(ds).status).toBe('MISSING_COLLECTION');
    expect(types(ds)).toEqual(['DELIVERED_COD_NO_COLLECTION']);
  });
  it('2/3. under- and over-collection', () => {
    const a = clean(); a.collections[0].amount = 50000; a.deposits[0].allocations[0].amount = 50000; a.deposits[0].declaredAmount = 50000;
    expect(row(a)).toMatchObject({ status: 'AMOUNT_MISMATCH', outstanding: 2500 });
    const b = clean(); b.collections[0].amount = 55000; b.deposits[0].allocations[0].amount = 55000; b.deposits[0].declaredAmount = 55000;
    expect(reconcile(b, NOW).discrepancies[0].amount).toBe(2500);
  });
  it('4. collected not deposited: pending within deadline, flagged after', () => {
    const ds = clean(); ds.deposits = [];
    expect(reconcile(ds, new Date('2026-10-28T14:00:00')).rows[0].status).toBe('PENDING_DEPOSIT');
    expect(reconcile(ds, new Date('2026-10-28T14:00:00')).discrepancies).toHaveLength(0);
    expect(reconcile(ds, new Date('2026-10-29T06:00:00')).discrepancies.map(d => d.type)).toEqual(['COLLECTED_NOT_DEPOSITED']);
  });
  it('5. deposit declared ≠ allocated', () => {
    const ds = clean(); ds.deposits[0].declaredAmount = 50000;
    expect(types(ds)).toEqual(['DEPOSIT_ALLOCATION_MISMATCH']);
  });
  it('6. duplicate collection; does not hide as matched', () => {
    const ds = clean(); ds.collections.push({ ...ds.collections[0], id: 'CA2' });
    expect(row(ds).status).toBe('DUPLICATE_RECORD');
    expect(types(ds)).toContain('DUPLICATE_COLLECTION');
  });
  it('7. delivered but no bill', () => {
    const ds = clean(); ds.receipts = [];
    expect(row(ds).status).toBe('MISSING_BILL');
    expect(types(ds)).toEqual(['ORDER_WITHOUT_BILL']);
  });
  it('8. receipt amount ≠ order amount', () => {
    const ds = clean(); ds.receipts[0].amount = 50000;
    expect(types(ds)).toEqual(['RECEIPT_AMOUNT_MISMATCH']);
  });
  it('9. returned order with collection still recorded', () => {
    const ds = clean(); ds.deliveries[0].status = 'RETURNED'; ds.orders[0].status = 'DISPATCHED';
    expect(row(ds)).toMatchObject({ status: 'REQUIRES_REVIEW', expected: 0 });
    expect(types(ds)).toContain('CANCELLED_ORDER_INCONSISTENCY');
  });
  it('duplicate receipts never inflate billed sales', () => {
    const ds = clean(); ds.receipts.push({ ...ds.receipts[0], id: 'RA2' });
    expect(reconcile(ds, NOW).summary.billedSales).toBe(52500);
  });
  it('reversal removes a collection without deleting history', () => {
    const ds = clean(); ds.collections.push({ ...ds.collections[0], id: 'CA2' });
    ds.collections.push({ id: 'REV1', orderId: 'A', deliveryId: 'DA', personId: 'P1', amount: 0, ts: NOW.toISOString(), reversesId: 'CA2' });
    expect(row(ds).status).toBe('MATCHED');
    expect(ds.collections).toHaveLength(3);
  });
  it('adjustment (refund) reduces expected', () => {
    const ds = clean(); ds.adjustments.push({ id: 'J', orderId: 'A', amount: -2500, reason: 'late', approvedBy: 'M', ts: NOW.toISOString() });
    expect(row(ds).expected).toBe(50000);
  });
  it('collection allocated to two deposits is flagged', () => {
    const ds = clean(); ds.deposits.push({ ...ds.deposits[0], id: 'X2' });
    expect(types(ds)).toContain('COLLECTION_MULTI_ALLOCATED');
  });
  it('production: excess flagged, recorded wastage explains excess', () => {
    const ds = clean();
    ds.production.push({ id: 'P', outletId: 'O', ts: '2026-10-28T11:00:00', shift: 'LUNCH', pizza: 'M', qty: 5, staffId: 'K' });
    expect(types(ds)).toEqual(['PRODUCTION_WITHOUT_ORDER']);
    ds.production[0].wasted = 3;
    expect(types(ds)).toEqual([]);
  });
});

describe('seed dataset', () => {
  const anchor = new Date('2026-10-28T21:00:00');
  const ds = buildSeed(anchor);
  const res = reconcile(ds, anchor);
  it('is deterministic', () => expect(JSON.stringify(buildSeed(anchor))).toBe(JSON.stringify(ds)));
  it('IDs are unique', () => {
    for (const k of ['orders', 'receipts', 'deliveries', 'collections', 'deposits', 'production'] as const) {
      const ids = (ds[k] as { id: string }[]).map(x => x.id); expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('contains every scenario type', () => {
    const t = new Set(res.discrepancies.map(d => d.type));
    for (const x of ['ORDER_WITHOUT_BILL', 'DELIVERED_COD_NO_COLLECTION', 'CASH_AMOUNT_MISMATCH', 'COLLECTED_NOT_DEPOSITED',
      'DUPLICATE_BILL', 'RECEIPT_AMOUNT_MISMATCH', 'CANCELLED_ORDER_INCONSISTENCY', 'DEPOSIT_ALLOCATION_MISMATCH',
      'DUPLICATE_COLLECTION', 'PRODUCTION_WITHOUT_ORDER']) expect(t, x).toContain(x);
  });
  it('wastage batch does not raise a false positive', () =>
    expect(res.discrepancies.filter(d => d.type === 'PRODUCTION_WITHOUT_ORDER')).toHaveLength(1));
  it('most rows match (noise is not drowning signal)', () =>
    { const settled = res.rows.filter(r => !r.status.startsWith('PENDING'));
      expect(settled.filter(r => r.status === 'MATCHED').length / settled.length).toBeGreaterThan(0.8); });
  it('filtered summaries sum to the unfiltered total', () => {
    const days = [...new Set(ds.orders.map(o => o.ts.slice(0, 10)))];
    const parts = days.flatMap(day => (['LUNCH', 'DINNER'] as const).map(shift => reconcile(ds, anchor, undefined, { day, shift }).summary));
    expect(parts.reduce((s, p) => s + p.codExpected, 0)).toBe(res.summary.codExpected);
    expect(parts.reduce((s, p) => s + p.orders, 0)).toBe(res.summary.orders);
  });
});
