import { Collection, Dataset, Deposit, Delivery, Order, ProductionBatch, Shift } from './types';

// FICTIONAL DEMO DATA. Deterministic for a given anchor date.
export const MENU: { pizza: string; price: number }[] = [
  { pizza: 'Margherita', price: 24900 }, { pizza: 'Farmhouse', price: 34900 },
  { pizza: 'Peppy Paneer', price: 37900 }, { pizza: 'Chicken Tikka', price: 42900 },
  { pizza: 'Veggie Supreme', price: 39900 }, { pizza: 'Pepperoni', price: 44900 },
];

export interface Staff { id: string; name: string; role: Role; outletId: string; active: boolean }
export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN' | 'DELIVERY_SUP' | 'DELIVERY' | 'AUDITOR';

export const OUTLETS = [{ id: 'OUT-AND', name: 'ROMS Pizza — Andheri West (Demo)' }];

export const STAFF: Staff[] = [
  { id: 'U-OWN', name: 'Demo Owner', role: 'OWNER', outletId: 'OUT-AND', active: true },
  { id: 'U-MGR', name: 'Ravi Menon', role: 'MANAGER', outletId: 'OUT-AND', active: true },
  { id: 'U-CSH', name: 'Pooja Shah', role: 'CASHIER', outletId: 'OUT-AND', active: true },
  { id: 'U-KIT', name: 'Imran Qureshi', role: 'KITCHEN', outletId: 'OUT-AND', active: true },
  { id: 'U-DS', name: 'Sunil Patil', role: 'DELIVERY_SUP', outletId: 'OUT-AND', active: true },
  { id: 'R-01', name: 'Amit K.', role: 'DELIVERY', outletId: 'OUT-AND', active: true },
  { id: 'R-02', name: 'Farhan S.', role: 'DELIVERY', outletId: 'OUT-AND', active: true },
  { id: 'R-03', name: 'Deepak M.', role: 'DELIVERY', outletId: 'OUT-AND', active: true },
  { id: 'U-AUD', name: 'Neha Iyer', role: 'AUDITOR', outletId: 'OUT-AND', active: true },
];
const RIDERS = ['R-01', 'R-02', 'R-03'];

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pad = (n: number, w = 3) => String(n).padStart(w, '0');
const isoLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19);

/** Builds 3 days (anchor = today) of data. Named scenarios are on fixed order slots. */
export function buildSeed(anchor: Date = new Date()): Dataset {
  const r = rng(42);
  const ds: Dataset = { orders: [], receipts: [], deliveries: [], collections: [], deposits: [], adjustments: [], production: [] };
  const today = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());

  for (let back = 2; back >= 0; back--) {
    const day = new Date(today.getTime() - back * 864e5);
    const ymd = isoLocal(day).slice(2, 10).replace(/-/g, '');
    let n = 0;
    for (const shift of ['LUNCH', 'DINNER'] as Shift[]) {
      const startH = shift === 'LUNCH' ? 11 : 18;
      const isLive = back === 0 && shift === 'DINNER'; // today's dinner still running
      const shiftOrders: Order[] = [];
      const count = 14 + Math.floor(r() * 5);
      for (let k = 0; k < count; k++) {
        n++;
        const ts = new Date(day.getTime() + (startH * 60 + k * 12 + Math.floor(r() * 8)) * 6e4);
        const items = Array.from({ length: 1 + Math.floor(r() * 2) }, () => {
          const m = MENU[Math.floor(r() * MENU.length)]; return { pizza: m.pizza, qty: 1 + Math.floor(r() * 2), unitPrice: m.price };
        });
        const sub = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
        const discount = r() < 0.2 ? Math.round(sub * 0.1 / 100) * 100 : 0;
        const tax = Math.round((sub - discount) * 0.05 / 100) * 100;
        const payment = r() < 0.6 ? 'COD' : 'ONLINE';
        const status = isLive && k > count - 5 ? (k > count - 3 ? 'PREPARING' : 'DISPATCHED') : 'DELIVERED';
        const o: Order = { id: `ORD-${ymd}-${pad(n)}`, outletId: 'OUT-AND', ts: isoLocal(ts), shift, items, discount, tax, payment, status,
          customerRef: `CUST-${pad(Math.floor(r() * 900) + 100)}` };
        shiftOrders.push(o); ds.orders.push(o);
      }
      // receipts, deliveries, collections
      const shiftColl: Collection[] = [];
      for (const o of shiftOrders) {
        const total = o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) - o.discount + o.tax;
        const t = new Date(o.ts);
        if (o.status !== 'PREPARING') ds.receipts.push({ id: o.id.replace('ORD', 'RCP'), orderId: o.id, ts: isoLocal(new Date(t.getTime() + 2 * 6e4)), amount: total });
        if (o.status === 'PREPARING') continue;
        const rider = RIDERS[Math.floor(r() * RIDERS.length)];
        const d: Delivery = { id: o.id.replace('ORD', 'DLV'), orderId: o.id, personId: rider, status: o.status === 'DELIVERED' ? 'DELIVERED' : 'DISPATCHED',
          dispatchTs: isoLocal(new Date(t.getTime() + 20 * 6e4)), closedTs: o.status === 'DELIVERED' ? isoLocal(new Date(t.getTime() + 45 * 6e4)) : undefined };
        ds.deliveries.push(d);
        if (o.payment === 'COD' && d.status === 'DELIVERED') {
          const c: Collection = { id: o.id.replace('ORD', 'COL'), orderId: o.id, deliveryId: d.id, personId: rider, amount: total, ts: d.closedTs! };
          ds.collections.push(c); shiftColl.push(c);
        }
      }
      // production matches orders
      const byPizza = new Map<string, number>();
      shiftOrders.forEach(o => o.items.forEach(i => byPizza.set(i.pizza, (byPizza.get(i.pizza) ?? 0) + i.qty)));
      let b = 0;
      for (const [pizza, qty] of byPizza) ds.production.push({ id: `PRD-${ymd}-${shift[0]}${pad(++b, 2)}`, outletId: 'OUT-AND',
        ts: isoLocal(new Date(day.getTime() + startH * 36e5 + b * 6e4)), shift, pizza, qty, staffId: 'U-KIT' } as ProductionBatch);
      // deposits: one per rider per shift, after shift ends (not for live shift)
      if (!isLive) for (const rider of RIDERS) {
        const cs = shiftColl.filter(c => c.personId === rider);
        if (!cs.length) continue;
        const amt = cs.reduce((s, c) => s + c.amount, 0);
        ds.deposits.push({ id: `DEP-${ymd}-${shift[0]}-${rider}`, outletId: 'OUT-AND', ref: `CASH-${ymd}-${shift[0]}${rider.slice(2)}`,
          ts: isoLocal(new Date(day.getTime() + (startH + 4) * 36e5)), declaredAmount: amt,
          allocations: cs.map(c => ({ collectionId: c.id, amount: c.amount })), verifiedBy: 'U-CSH' } as Deposit);
      }
    }
  }
  injectScenarios(ds, isoLocal(today).slice(2, 10).replace(/-/g, ''), isoLocal(new Date(today.getTime() - 864e5)).slice(2, 10).replace(/-/g, ''));
  return ds;
}

/** Each named scenario maps to a demo-journey step. Kept explicit so it's auditable. */
function injectScenarios(ds: Dataset, t: string, y: string) {
  const o = (id: string) => ds.orders.find(x => x.id === id)!;
  const codOrders = (pre: string) => ds.orders.filter(x => x.id.startsWith(`ORD-${pre}`) && x.payment === 'COD' && x.status === 'DELIVERED');
  const dropColl = (oid: string) => {
    const c = ds.collections.find(x => x.orderId === oid); if (!c) return;
    ds.collections = ds.collections.filter(x => x !== c);
    ds.deposits.forEach(d => {
      const a = d.allocations.find(x => x.collectionId === c.id);
      if (a) { d.allocations = d.allocations.filter(x => x !== a); d.declaredAmount -= a.amount; }
    });
  };
  const tc = codOrders(t), yc = codOrders(y);

  // S1 (steps 4): delivered order without receipt — today, COD
  ds.receipts = ds.receipts.filter(r => r.orderId !== tc[0].id);
  // S2 (steps 5–11): delivered COD, no collection entry — today
  dropColl(tc[1].id);
  // S3: short collection — today
  const s3 = ds.collections.find(c => c.orderId === tc[2].id)!; const short = 10000;
  s3.amount -= short; ds.deposits.forEach(d => d.allocations.forEach(a => { if (a.collectionId === s3.id) { a.amount -= short; d.declaredAmount -= short; } }));
  // S4: collected yesterday, never deposited (overdue)
  const s4 = ds.collections.find(c => c.orderId === yc[0].id)!;
  ds.deposits.forEach(d => { const a = d.allocations.find(x => x.collectionId === s4.id); if (a) { d.allocations = d.allocations.filter(x => x !== a); d.declaredAmount -= a.amount; } });
  // S5: duplicate receipt — yesterday
  const r5 = ds.receipts.find(r => r.orderId === yc[1].id)!;
  ds.receipts.push({ ...r5, id: r5.id + '-B', ts: r5.ts.replace(/:\d\d$/, ':59') });
  // S6: receipt amount mismatch — yesterday
  const r6 = ds.receipts.find(r => r.orderId === yc[2].id)!; r6.amount -= 5000;
  // S7: cancelled order still has a receipt — today
  const c7 = ds.orders.find(x => x.id.startsWith(`ORD-${t}`) && x.payment === 'ONLINE' && x.status === 'DELIVERED')!;
  c7.status = 'CANCELLED'; ds.deliveries = ds.deliveries.filter(d => d.orderId !== c7.id);
  // S8: returned COD order with collection still recorded — yesterday
  const d8 = ds.deliveries.find(d => d.orderId === yc[3].id)!; d8.status = 'RETURNED'; o(yc[3].id).status = 'DISPATCHED';
  // S9: deposit declared less than allocated — yesterday (cash short at counting)
  const dep9 = ds.deposits.find(d => d.id.startsWith(`DEP-${y}-L`))!; dep9.declaredAmount -= 20000;
  // S10: duplicate collection entry — today
  const c10 = ds.collections.find(c => c.orderId === tc[3].id)!;
  ds.collections.push({ ...c10, id: c10.id + '-DUP' });
  // S11: over-production — today lunch, 4 extra Margherita not tied to orders
  ds.production.push({ id: `PRD-${t}-L99`, outletId: 'OUT-AND', ts: ds.production.find(p => p.id.startsWith(`PRD-${t}-L`))!.ts,
    shift: 'LUNCH', pizza: 'Margherita', qty: 4, staffId: 'U-KIT', notes: 'Unlinked batch' });
  // S12: recorded wastage — explained over-production, should NOT flag
  ds.production.push({ id: `PRD-${y}-D98`, outletId: 'OUT-AND', ts: ds.production.find(p => p.id.startsWith(`PRD-${y}-D`))!.ts,
    shift: 'DINNER', pizza: 'Farmhouse', qty: 2, wasted: 2, staffId: 'U-KIT', notes: 'Dropped during packing' });
}

