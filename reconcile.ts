import {
  Dataset, DEFAULT_POLICY, Order, Paise, ReconPolicy, Shift,
} from './types';

export const orderTotal = (o: Order): Paise =>
  o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) - o.discount + o.tax;

export const dayOf = (ts: string) => ts.slice(0, 10);

export type CodStatus =
  | 'MATCHED' | 'PENDING_COLLECTION' | 'PENDING_DEPOSIT' | 'AMOUNT_MISMATCH'
  | 'MISSING_BILL' | 'MISSING_COLLECTION' | 'DUPLICATE_RECORD' | 'REQUIRES_REVIEW';

export type DiscrepancyType =
  | 'PRODUCTION_WITHOUT_ORDER' | 'ORDER_WITHOUT_BILL' | 'DELIVERED_COD_NO_COLLECTION'
  | 'COLLECTED_NOT_DEPOSITED' | 'CASH_AMOUNT_MISMATCH' | 'DUPLICATE_BILL' | 'DUPLICATE_COLLECTION'
  | 'RECEIPT_AMOUNT_MISMATCH' | 'CANCELLED_ORDER_INCONSISTENCY' | 'MISSING_DELIVERY_RECORD'
  | 'DEPOSIT_ALLOCATION_MISMATCH' | 'COLLECTION_MULTI_ALLOCATED';

export interface Discrepancy {
  key: string; // deterministic: `${type}:${ref}` — workflow state is keyed on this
  type: DiscrepancyType; ref: string; ts: string; outletId: string; shift?: Shift;
  orderId?: string; receiptIds?: string[]; deliveryId?: string; collectionIds?: string[]; depositId?: string;
  personId?: string;
  amount?: Paise; qty?: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  detail: string;
}

export interface CodRow {
  orderId: string; outletId: string; shift: Shift; ts: string;
  deliveryId?: string; receiptIds: string[]; personId?: string;
  orderAmount: Paise; expected: Paise; collected: Paise; deposited: Paise;
  outstanding: Paise; variance: Paise;
  status: CodStatus; flags: DiscrepancyType[];
}

export interface Summary {
  pizzasProduced: number; pizzasWasted: number; pizzasOrdered: number; pizzasDispatched: number; pizzasCancelled: number;
  orders: number; ordersFulfilled: number; ordersCancelled: number;
  billsGenerated: number; ordersMissingBill: number; duplicateBills: number; billedSales: Paise;
  codOrders: number; codExpected: Paise; codCollected: Paise; codDeposited: Paise;
  pendingDeposit: Paise; cashVariance: Paise; unresolvedCod: number;
  depositsDeclared: Paise;
  discrepancies: number;
}

export interface ReconResult { rows: CodRow[]; discrepancies: Discrepancy[]; summary: Summary }

export interface Filter { outletId?: string; day?: string; shift?: Shift; personId?: string }

const DISPATCHED_STATES = new Set(['DISPATCHED', 'DELIVERED']);
const BILL_REQUIRED = new Set(['READY', 'DISPATCHED', 'DELIVERED']);

/**
 * Pure function: dataset in, reconciliation out. Every page derives from this,
 * so dashboard, tables and reports cannot disagree.
 */
export function reconcile(ds: Dataset, now: Date, policy: ReconPolicy = DEFAULT_POLICY, f: Filter = {}): ReconResult {
  const inScope = (outletId: string, ts: string, shift?: Shift) =>
    (!f.outletId || f.outletId === outletId) && (!f.day || dayOf(ts) === f.day) && (!f.shift || !shift || f.shift === shift);

  const orders = ds.orders.filter(o => inScope(o.outletId, o.ts, o.shift));
  const orderById = new Map(ds.orders.map(o => [o.id, o]));
  const tol = policy.amountTolerance;
  const differs = (a: number, b: number) => Math.abs(a - b) > tol;

  // --- index ---
  const receiptsBy = group(ds.receipts.filter(r => !r.voided), r => r.orderId);
  const deliveryBy = new Map<string, typeof ds.deliveries[number][]>();
  ds.deliveries.forEach(d => deliveryBy.set(d.orderId, [...(deliveryBy.get(d.orderId) ?? []), d]));

  const reversed = new Set(ds.collections.filter(c => c.reversesId).map(c => c.reversesId!));
  const activeColl = ds.collections.filter(c => !c.reversesId && !reversed.has(c.id));
  const collBy = group(activeColl, c => c.orderId);

  // allocation: collectionId -> [{depositId, amount}]
  const allocBy = new Map<string, { depositId: string; amount: Paise }[]>();
  ds.deposits.forEach(d => d.allocations.forEach(a =>
    allocBy.set(a.collectionId, [...(allocBy.get(a.collectionId) ?? []), { depositId: d.id, amount: a.amount }])));
  const adjBy = group(ds.adjustments, a => a.orderId);

  const disc: Discrepancy[] = [];
  const add = (d: Omit<Discrepancy, 'key'>) => disc.push({ ...d, key: `${d.type}:${d.ref}` });

  // --- billing (all payment methods) ---
  let billsGenerated = 0, ordersMissingBill = 0, duplicateBills = 0, billedSales = 0;
  for (const o of orders) {
    const rs = receiptsBy.get(o.id) ?? [];
    const total = orderTotal(o);
    billsGenerated += rs.length;
    if (o.status === 'CANCELLED') {
      if (rs.length) add({ type: 'CANCELLED_ORDER_INCONSISTENCY', ref: o.id, ts: o.ts, outletId: o.outletId, shift: o.shift,
        orderId: o.id, receiptIds: rs.map(r => r.id), amount: rs[0].amount, severity: 'MEDIUM',
        detail: `Cancelled order has ${rs.length} active receipt(s); void or reinstate.` });
      continue;
    }
    if (rs.length) billedSales += rs[0].amount; // count one receipt per order — duplicates never inflate sales
    if (!rs.length && BILL_REQUIRED.has(o.status)) {
      ordersMissingBill++;
      add({ type: 'ORDER_WITHOUT_BILL', ref: o.id, ts: o.ts, outletId: o.outletId, shift: o.shift, orderId: o.id,
        amount: total, severity: o.status === 'DELIVERED' ? 'HIGH' : 'MEDIUM',
        detail: `Order is ${o.status.toLowerCase()} but no receipt is recorded.` });
    }
    if (rs.length > 1) {
      duplicateBills += rs.length - 1;
      add({ type: 'DUPLICATE_BILL', ref: o.id, ts: o.ts, outletId: o.outletId, shift: o.shift, orderId: o.id,
        receiptIds: rs.map(r => r.id), amount: rs.slice(1).reduce((s, r) => s + r.amount, 0), severity: 'MEDIUM',
        detail: `${rs.length} active receipts for one order.` });
    }
    const bad = rs.find(r => differs(r.amount, total));
    if (bad) add({ type: 'RECEIPT_AMOUNT_MISMATCH', ref: o.id, ts: o.ts, outletId: o.outletId, shift: o.shift, orderId: o.id,
      receiptIds: [bad.id], amount: bad.amount - total, severity: 'MEDIUM',
      detail: `Receipt ${fmt(bad.amount)} vs order ${fmt(total)}.` });
    if (DISPATCHED_STATES.has(o.status) && !(deliveryBy.get(o.id)?.length))
      add({ type: 'MISSING_DELIVERY_RECORD', ref: o.id, ts: o.ts, outletId: o.outletId, shift: o.shift, orderId: o.id,
        severity: 'MEDIUM', detail: `Order marked ${o.status.toLowerCase()} with no delivery record.` });
  }

  // --- COD ---
  const rows: CodRow[] = [];
  for (const o of orders.filter(o => o.payment === 'COD')) {
    const dels = deliveryBy.get(o.id) ?? [];
    const del = dels[dels.length - 1];
    if (f.personId && del?.personId !== f.personId) continue;
    const rs = receiptsBy.get(o.id) ?? [];
    const cs = collBy.get(o.id) ?? [];
    const flags: DiscrepancyType[] = [];
    const total = orderTotal(o);
    const adj = (adjBy.get(o.id) ?? []).reduce((s, a) => s + a.amount, 0);
    const voidish = o.status === 'CANCELLED' || del?.status === 'RETURNED' || del?.status === 'FAILED' || del?.status === 'CANCELLED';
    const delivered = del?.status === 'DELIVERED' || o.status === 'DELIVERED';
    const expected = voidish ? 0 : Math.max(0, total + adj);
    const collected = cs.reduce((s, c) => s + c.amount, 0);
    const deposited = cs.reduce((s, c) => s + (allocBy.get(c.id) ?? []).reduce((a, x) => a + x.amount, 0), 0);
    const outstanding = expected - collected;
    const variance = collected - deposited;
    const base = { ts: o.ts, outletId: o.outletId, shift: o.shift, orderId: o.id, deliveryId: del?.id, personId: del?.personId };

    if (cs.length > 1) {
      flags.push('DUPLICATE_COLLECTION');
      add({ ...base, type: 'DUPLICATE_COLLECTION', ref: o.id, collectionIds: cs.map(c => c.id),
        amount: collected - cs[0].amount, severity: 'HIGH', detail: `${cs.length} collection entries for one order.` });
    }
    if (voidish && (collected > 0 || deposited > 0)) {
      flags.push('CANCELLED_ORDER_INCONSISTENCY');
      add({ ...base, type: 'CANCELLED_ORDER_INCONSISTENCY', ref: `${o.id}:cod`, collectionIds: cs.map(c => c.id),
        amount: collected, severity: 'HIGH', detail: `Order ${del?.status?.toLowerCase() ?? 'cancelled'} but ${fmt(collected)} recorded as collected.` });
    }
    if (delivered && expected > 0 && cs.length === 0) {
      flags.push('DELIVERED_COD_NO_COLLECTION');
      add({ ...base, type: 'DELIVERED_COD_NO_COLLECTION', ref: o.id, amount: expected, severity: 'HIGH',
        detail: `Delivered COD order with no collection entry. ${fmt(expected)} expected.` });
    } else if (!voidish && cs.length && differs(collected, expected) && cs.length === 1) {
      flags.push('CASH_AMOUNT_MISMATCH');
      add({ ...base, type: 'CASH_AMOUNT_MISMATCH', ref: o.id, collectionIds: cs.map(c => c.id),
        amount: collected - expected, severity: Math.abs(collected - expected) >= 20000 ? 'HIGH' : 'MEDIUM',
        detail: `Collected ${fmt(collected)} vs expected ${fmt(expected)} (${collected > expected ? 'over' : 'short'} by ${fmt(Math.abs(collected - expected))}).` });
    }
    if (variance > tol) {
      const oldest = cs.filter(c => !(allocBy.get(c.id)?.length)).map(c => c.ts).sort()[0] ?? cs[0]?.ts;
      const ageH = oldest ? (now.getTime() - new Date(oldest).getTime()) / 36e5 : 0;
      if (ageH > policy.depositDeadlineHours) {
        flags.push('COLLECTED_NOT_DEPOSITED');
        add({ ...base, type: 'COLLECTED_NOT_DEPOSITED', ref: o.id, collectionIds: cs.map(c => c.id), amount: variance,
          severity: 'HIGH', detail: `${fmt(variance)} collected ${Math.floor(ageH)}h ago, not deposited (deadline ${policy.depositDeadlineHours}h).` });
      }
    }
    if (delivered && rs.length === 0) flags.push('ORDER_WITHOUT_BILL');
    if (rs.length > 1) flags.push('DUPLICATE_BILL');

    let status: CodStatus;
    if (flags.includes('DUPLICATE_COLLECTION') || flags.includes('DUPLICATE_BILL')) status = 'DUPLICATE_RECORD';
    else if (flags.includes('CANCELLED_ORDER_INCONSISTENCY')) status = 'REQUIRES_REVIEW';
    else if (flags.includes('DELIVERED_COD_NO_COLLECTION')) status = 'MISSING_COLLECTION';
    else if (flags.includes('ORDER_WITHOUT_BILL')) status = 'MISSING_BILL';
    else if (flags.includes('CASH_AMOUNT_MISMATCH')) status = 'AMOUNT_MISMATCH';
    else if (voidish) status = 'MATCHED';
    else if (!delivered) status = 'PENDING_COLLECTION';
    else if (variance > tol) status = 'PENDING_DEPOSIT';
    else if (variance < -tol) status = 'REQUIRES_REVIEW'; // deposited more than collected
    else status = 'MATCHED';

    rows.push({ orderId: o.id, outletId: o.outletId, shift: o.shift, ts: o.ts, deliveryId: del?.id,
      receiptIds: rs.map(r => r.id), personId: del?.personId, orderAmount: total, expected, collected, deposited,
      outstanding, variance, status, flags });
  }

  // --- deposit integrity ---
  for (const d of ds.deposits.filter(d => inScope(d.outletId, d.ts))) {
    const alloc = d.allocations.reduce((s, a) => s + a.amount, 0);
    if (differs(alloc, d.declaredAmount)) add({ type: 'DEPOSIT_ALLOCATION_MISMATCH', ref: d.id, ts: d.ts, outletId: d.outletId,
      depositId: d.id, amount: d.declaredAmount - alloc, severity: 'HIGH',
      detail: `Deposit ${d.ref}: declared ${fmt(d.declaredAmount)}, allocated ${fmt(alloc)}.` });
  }
  for (const [cid, allocs] of allocBy) {
    const c = ds.collections.find(x => x.id === cid);
    const o = c && orderById.get(c.orderId);
    if (!c || !o || !inScope(o.outletId, o.ts, o.shift)) continue;
    const sum = allocs.reduce((s, a) => s + a.amount, 0);
    if (allocs.length > 1 || sum > c.amount + tol) add({ type: 'COLLECTION_MULTI_ALLOCATED', ref: cid, ts: c.ts, outletId: o.outletId,
      shift: o.shift, orderId: o.id, collectionIds: [cid], amount: sum - c.amount, severity: 'HIGH',
      detail: `Collection ${cid} allocated ${allocs.length}× (${fmt(sum)} of ${fmt(c.amount)}).` });
  }

  // --- production vs orders (per day / shift / pizza) ---
  const prod = ds.production.filter(p => inScope(p.outletId, p.ts, p.shift));
  const key = (outlet: string, ts: string, shift: Shift, pizza: string) => `${outlet}|${dayOf(ts)}|${shift}|${pizza}`;
  const produced = new Map<string, number>(), ordered = new Map<string, number>();
  prod.forEach(p => produced.set(key(p.outletId, p.ts, p.shift, p.pizza), (produced.get(key(p.outletId, p.ts, p.shift, p.pizza)) ?? 0) + p.qty));
  let pizzasOrdered = 0, pizzasDispatched = 0, pizzasCancelled = 0;
  for (const o of orders) for (const i of o.items) {
    if (o.status === 'CANCELLED') { pizzasCancelled += i.qty; continue; }
    pizzasOrdered += i.qty;
    if (DISPATCHED_STATES.has(o.status)) pizzasDispatched += i.qty;
    const k = key(o.outletId, o.ts, o.shift, i.pizza);
    ordered.set(k, (ordered.get(k) ?? 0) + i.qty);
  }
  const wastedBy = new Map<string, number>();
  prod.forEach(p => wastedBy.set(key(p.outletId, p.ts, p.shift, p.pizza), (wastedBy.get(key(p.outletId, p.ts, p.shift, p.pizza)) ?? 0) + (p.wasted ?? 0)));
  for (const [k, qty] of produced) {
    const ord = ordered.get(k) ?? 0, wasted = wastedBy.get(k) ?? 0;
    const allowed = Math.ceil(ord * (1 + policy.productionAllowancePct / 100)) + wasted;
    if (qty > allowed) {
      const [outletId, day, shift, pizza] = k.split('|');
      add({ type: 'PRODUCTION_WITHOUT_ORDER', ref: k, ts: `${day}T00:00:00`, outletId, shift: shift as Shift, qty: qty - allowed,
        severity: qty - allowed >= 3 ? 'HIGH' : 'MEDIUM',
        detail: `${pizza}: ${qty} produced vs ${ord} ordered (+${wasted} recorded wastage, ${policy.productionAllowancePct}% allowance).` });
    }
  }

  const cod = rows;
  const summary: Summary = {
    pizzasProduced: prod.reduce((s, p) => s + p.qty, 0), pizzasWasted: prod.reduce((s, p) => s + (p.wasted ?? 0), 0),
    pizzasOrdered, pizzasDispatched, pizzasCancelled,
    orders: orders.length, ordersFulfilled: orders.filter(o => o.status === 'DELIVERED').length,
    ordersCancelled: orders.filter(o => o.status === 'CANCELLED').length,
    billsGenerated, ordersMissingBill, duplicateBills, billedSales,
    codOrders: cod.length, codExpected: sum(cod, r => r.expected), codCollected: sum(cod, r => r.collected),
    codDeposited: sum(cod, r => r.deposited), pendingDeposit: sum(cod, r => Math.max(0, r.variance)),
    cashVariance: sum(cod, r => r.collected - r.expected), unresolvedCod: cod.filter(r => r.status !== 'MATCHED' && r.status !== 'PENDING_COLLECTION').length,
    depositsDeclared: ds.deposits.filter(d => inScope(d.outletId, d.ts)).reduce((s, d) => s + d.declaredAmount, 0),
    discrepancies: disc.length,
  };
  return { rows, discrepancies: disc.sort((a, b) => b.ts.localeCompare(a.ts)), summary };
}

function group<T>(xs: T[], k: (x: T) => string) {
  const m = new Map<string, T[]>(); xs.forEach(x => m.set(k(x), [...(m.get(k(x)) ?? []), x])); return m;
}
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
export const fmt = (p: Paise) => (p < 0 ? '−₹' : '₹') + (Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
