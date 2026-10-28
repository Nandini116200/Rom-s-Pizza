import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { buildSeed, STAFF } from './seed';
import { Dataset, OrderStatus, Paise } from './types';

export type CaseStatus = 'OPEN' | 'UNDER_REVIEW' | 'AWAITING_EVIDENCE' | 'RESOLVED' | 'DISMISSED';
export interface CaseState { status: CaseStatus; assignee?: string; notes: { ts: string; by: string; text: string }[] }
export interface AuditEvent { id: string; ts: string; actor: string; action: string; ref: string; detail: string }

interface State {
  data: Dataset;
  cases: Record<string, CaseState>; // keyed by Discrepancy.key
  audit: AuditEvent[];
  user: { id: string; name: string; role: string } | null;
  seq: number;
  login: (id: string) => void; logout: () => void;
  resetDemo: () => void;
  generateReceipt: (orderId: string) => string;
  setOrderStatus: (orderId: string, s: OrderStatus) => void;
  recordCollection: (orderId: string, amount: Paise) => string;
  reverseCollection: (collectionId: string, reason: string) => void;
  createDeposit: (ref: string, declared: Paise, collectionIds: string[]) => string;
  updateCase: (key: string, patch: Partial<Omit<CaseState, 'notes'>>, note?: string) => void;
}

const now = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19); };

export class RuleError extends Error {}

export const useStore = create<State>()(persist((set, get) => {
  const log = (action: string, ref: string, detail: string) => set(s => ({
    audit: [{ id: `AUD-${s.seq + 1}`, ts: now(), actor: s.user?.name ?? 'system', action, ref, detail }, ...s.audit], seq: s.seq + 1,
  }));
  const nextId = (p: string) => { const n = get().seq + 1; set({ seq: n }); return `${p}-D${String(n).padStart(4, '0')}`; };

  return {
    data: buildSeed(), cases: {}, audit: [], user: null, seq: 0,
    login: id => { const u = STAFF.find(x => x.id === id)!; set({ user: { id: u.id, name: u.name, role: u.role } }); log('LOGIN', u.id, `${u.name} signed in (demo)`); },
    logout: () => { log('LOGOUT', get().user?.id ?? '', 'Signed out'); set({ user: null }); },
    resetDemo: () => { set({ data: buildSeed(), cases: {}, audit: [], seq: 0 }); log('DEMO_RESET', '-', 'Demo data regenerated'); },

    generateReceipt: orderId => {
      const { data } = get();
      const o = data.orders.find(x => x.id === orderId); if (!o) throw new RuleError('Order not found');
      if (o.status === 'CANCELLED') throw new RuleError('Cannot bill a cancelled order');
      if (data.receipts.some(r => r.orderId === orderId && !r.voided)) throw new RuleError('Order already has an active receipt');
      const amount = o.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) - o.discount + o.tax;
      const id = nextId('RCP');
      set(s => ({ data: { ...s.data, receipts: [...s.data.receipts, { id, orderId, ts: now(), amount }] } }));
      log('RECEIPT_GENERATED', orderId, `${id} for ₹${amount / 100}`); return id;
    },
    setOrderStatus: (orderId, st) => {
      set(s => ({ data: { ...s.data, orders: s.data.orders.map(o => o.id === orderId ? { ...o, status: st } : o) } }));
      log('ORDER_STATUS', orderId, `→ ${st}`);
    },
    recordCollection: (orderId, amount) => {
      const { data, user } = get();
      if (!(amount > 0)) throw new RuleError('Amount must be positive');
      const d = [...data.deliveries].reverse().find(x => x.orderId === orderId);
      if (!d) throw new RuleError('No delivery record for this order');
      const id = nextId('COL');
      set(s => ({ data: { ...s.data, collections: [...s.data.collections, { id, orderId, deliveryId: d.id, personId: d.personId, amount, ts: now() }] } }));
      log('COLLECTION_RECORDED', orderId, `${id} ₹${amount / 100} (entered by ${user?.name})`); return id;
    },
    reverseCollection: (collectionId, reason) => {
      const { data } = get();
      const c = data.collections.find(x => x.id === collectionId); if (!c) throw new RuleError('Not found');
      if (data.collections.some(x => x.reversesId === collectionId)) throw new RuleError('Already reversed');
      if (data.deposits.some(d => d.allocations.some(a => a.collectionId === collectionId))) throw new RuleError('Collection is allocated to a deposit; reverse the deposit allocation first');
      const id = nextId('REV');
      set(s => ({ data: { ...s.data, collections: [...s.data.collections, { ...c, id, amount: 0, ts: now(), reversesId: collectionId }] } }));
      log('COLLECTION_REVERSED', c.orderId, `${id} reverses ${collectionId}: ${reason}`);
    },
    createDeposit: (ref, declared, collectionIds) => {
      const { data } = get();
      if (!ref.trim()) throw new RuleError('Deposit reference required');
      if (!collectionIds.length) throw new RuleError('Select at least one collection');
      if (data.deposits.some(d => d.ref === ref.trim())) throw new RuleError('Deposit reference already used');
      const allocated = new Set(data.deposits.flatMap(d => d.allocations.map(a => a.collectionId)));
      const clash = collectionIds.filter(c => allocated.has(c));
      if (clash.length) throw new RuleError(`Already allocated: ${clash.join(', ')}`);
      const allocations = collectionIds.map(cid => ({ collectionId: cid, amount: data.collections.find(c => c.id === cid)!.amount }));
      const id = nextId('DEP');
      set(s => ({ data: { ...s.data, deposits: [...s.data.deposits, { id, outletId: 'OUT-AND', ref: ref.trim(), ts: now(), declaredAmount: declared, allocations, verifiedBy: s.user?.id }] } }));
      log('DEPOSIT_CREATED', id, `${ref} declared ₹${declared / 100}, ${collectionIds.length} collection(s)`); return id;
    },
    updateCase: (key, patch, note) => {
      set(s => {
        const cur = s.cases[key] ?? { status: 'OPEN', notes: [] };
        const notes = note ? [...cur.notes, { ts: now(), by: s.user?.name ?? '?', text: note }] : cur.notes;
        return { cases: { ...s.cases, [key]: { ...cur, ...patch, notes } } };
      });
      log('CASE_UPDATED', key, [patch.status && `status→${patch.status}`, patch.assignee && `assignee→${patch.assignee}`, note].filter(Boolean).join('; '));
    },
  };
}, { name: 'roms-demo-v1', partialize: s => ({ data: s.data, cases: s.cases, audit: s.audit, seq: s.seq, user: s.user }) }));
