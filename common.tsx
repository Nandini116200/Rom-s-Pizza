import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { reconcile, Filter, fmt } from './reconcile';
import { STAFF } from './seed';
import { useStore } from './store';

export { fmt };
export const staffName = (id?: string) => STAFF.find(s => s.id === id)?.name ?? id ?? '—';

const FilterCtx = createContext<{ f: Filter; setF: (f: Filter) => void }>({ f: {}, setF: () => {} });
export function FilterProvider({ children }: { children: ReactNode }) {
  const [f, setF] = useState<Filter>({ outletId: 'OUT-AND', day: new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10) });
  return <FilterCtx.Provider value={{ f, setF }}>{children}</FilterCtx.Provider>;
}
export const useFilter = () => useContext(FilterCtx);

/** The single source of truth for every derived number in the UI. */
export function useRecon(override?: Filter) {
  const data = useStore(s => s.data);
  const { f } = useFilter();
  const eff = override ?? f;
  return useMemo(() => reconcile(data, new Date(), undefined, eff), [data, JSON.stringify(eff)]);
}

const TONE: Record<string, string> = {
  MATCHED: 'g', RESOLVED: 'g', DELIVERED: 'g',
  PENDING_COLLECTION: 'a', PENDING_DEPOSIT: 'a', UNDER_REVIEW: 'a', AWAITING_EVIDENCE: 'a', MEDIUM: 'a', DISPATCHED: 'a', PREPARING: 'a',
  DISMISSED: 'n', CANCELLED: 'n', LOW: 'n',
};
export const Badge = ({ v }: { v: string }) => <span className={`badge ${TONE[v] ?? 'r'}`}>{v.replace(/_/g, ' ')}</span>;

let toastSet: ((t: { msg: string; err?: boolean } | null) => void) | null = null;
export function Toaster() {
  const [t, set] = useState<{ msg: string; err?: boolean } | null>(null);
  toastSet = set;
  return t ? <div className={`toast ${t.err ? 'err' : ''}`} onClick={() => set(null)}>{t.msg}</div> : null;
}
export const toast = (msg: string, err = false) => { toastSet?.({ msg, err }); setTimeout(() => toastSet?.(null), 3500); };
export const attempt = (fn: () => unknown, ok: string) => { try { fn(); toast(ok); return true; } catch (e) { toast((e as Error).message, true); return false; } };

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="overlay" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()}>
    <div className="modal-h"><h3>{title}</h3><button className="ghost" onClick={onClose}>✕</button></div>{children}</div></div>;
}
