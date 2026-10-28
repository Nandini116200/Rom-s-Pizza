import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { orderTotal, CodStatus } from './reconcile';
import { STAFF } from './seed';
import { useStore, CaseStatus } from './store';
import { attempt, Badge, fmt, Modal, staffName, useRecon, useFilter as useFilterSafe } from './common';

/* ---------------- Dashboard ---------------- */
export function Dashboard() {
  const { summary: s, discrepancies, rows } = useRecon();
  const cases = useStore(x => x.cases);
  const open = discrepancies.filter(d => !['RESOLVED', 'DISMISSED'].includes(cases[d.key]?.status ?? 'OPEN'));
  const card = (label: string, value: string | number, to: string, tone = '') =>
    <Link to={to} className={`kpi ${tone}`}><span>{label}</span><b>{value}</b></Link>;
  return <div>
    <div className="kpis">
      {card('Pizzas produced', s.pizzasProduced, '/production')}
      {card('Pizzas in orders', s.pizzasOrdered, '/orders')}
      {card('Orders', s.orders, '/orders')}
      {card('Delivered', s.ordersFulfilled, '/orders?status=DELIVERED')}
      {card('Bills generated', s.billsGenerated, '/orders')}
      {card('Orders missing bill', s.ordersMissingBill, '/orders?bill=missing', s.ordersMissingBill ? 'r' : 'g')}
      {card('COD orders', s.codOrders, '/cod')}
      {card('Expected COD', fmt(s.codExpected), '/cod')}
      {card('Recorded COD', fmt(s.codCollected), '/cod')}
      {card('Cash deposited', fmt(s.codDeposited), '/cod?tab=deposit')}
      {card('Pending deposit', fmt(s.pendingDeposit), '/cod?status=PENDING_DEPOSIT', s.pendingDeposit ? 'a' : 'g')}
      {card('Open discrepancies', open.length, '/discrepancies', open.length ? 'r' : 'g')}
    </div>
    <div className="grid2">
      <section className="card"><h3>Production vs orders (pizzas)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={[{ n: 'Produced', v: s.pizzasProduced }, { n: 'In orders', v: s.pizzasOrdered }, { n: 'Dispatched', v: s.pizzasDispatched }, { n: 'Wasted', v: s.pizzasWasted }, { n: 'Cancelled', v: s.pizzasCancelled }]}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="n" fontSize={12} /><YAxis fontSize={12} allowDecimals={false} /><Tooltip />
            <Bar isAnimationActive={false} dataKey="v" name="Pizzas" fill="#c62828" radius={[4, 4, 0, 0]} /></BarChart>
        </ResponsiveContainer></section>
      <section className="card"><h3>COD money trail</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={[{ n: 'Expected', v: s.codExpected / 100 }, { n: 'Collected', v: s.codCollected / 100 }, { n: 'Deposited', v: s.codDeposited / 100 }]}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="n" fontSize={12} /><YAxis fontSize={12} /><Tooltip formatter={(v: number) => '₹' + v.toLocaleString('en-IN')} />
            <Legend /><Bar isAnimationActive={false} dataKey="v" name="₹" fill="#37474f" radius={[4, 4, 0, 0]} /></BarChart>
        </ResponsiveContainer>
        <p className="muted">{rows.filter(r => r.status !== 'MATCHED').length} of {rows.length} COD orders not yet matched · variance vs expected {fmt(s.cashVariance)}</p></section>
    </div>
    <section className="card"><h3>Open discrepancies</h3><DiscTable list={open.slice(0, 8)} /></section>
  </div>;
}

/* ---------------- Orders ---------------- */
export function Orders() {
  const [q] = useSearchParams();
  const data = useStore(s => s.data);
  const { f } = useFilterSafe();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(q.get('status') ?? '');
  const [bill, setBill] = useState(q.get('bill') ?? '');
  const recByOrder = useMemo(() => new Set(data.receipts.filter(r => !r.voided).map(r => r.orderId)), [data]);
  const list = data.orders.filter(o => (!f.day || o.ts.startsWith(f.day)) && (!f.shift || o.shift === f.shift)
    && (!search || o.id.toLowerCase().includes(search.toLowerCase())) && (!status || o.status === status)
    && (bill !== 'missing' || (!recByOrder.has(o.id) && ['READY', 'DISPATCHED', 'DELIVERED'].includes(o.status))));
  return <section className="card">
    <div className="toolbar">
      <input placeholder="Search order ID" value={search} onChange={e => setSearch(e.target.value)} />
      <select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>
        {['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].map(x => <option key={x}>{x}</option>)}</select>
      <select value={bill} onChange={e => setBill(e.target.value)}><option value="">All billing</option><option value="missing">Missing bill</option></select>
      <span className="muted">{list.length} orders</span>
    </div>
    <table><thead><tr><th>Order</th><th>Time</th><th>Shift</th><th>Items</th><th>Amount</th><th>Pay</th><th>Status</th><th>Bill</th></tr></thead>
      <tbody>{list.map(o => <tr key={o.id}>
        <td><Link to={`/orders/${o.id}`}>{o.id}</Link></td><td>{o.ts.slice(11, 16)}</td><td>{o.shift}</td>
        <td>{o.items.map(i => `${i.qty}× ${i.pizza}`).join(', ')}</td><td>{fmt(orderTotal(o))}</td><td>{o.payment}</td>
        <td><Badge v={o.status} /></td><td>{recByOrder.has(o.id) ? <Badge v="MATCHED" /> : o.status === 'CANCELLED' || !['READY', 'DISPATCHED', 'DELIVERED'].includes(o.status) ? '—' : <Badge v="MISSING_BILL" />}</td>
      </tr>)}{!list.length && <tr><td colSpan={8} className="empty">No orders match these filters.</td></tr>}</tbody></table>
  </section>;
}

export function OrderDetail() {
  const { id } = useParams();
  const { data, generateReceipt, recordCollection, setOrderStatus } = useStore();
  const all = useRecon({});
  const [collect, setCollect] = useState<string | null>(null);
  const o = data.orders.find(x => x.id === id);
  if (!o) return <section className="card empty">Order {id} not found.</section>;
  const rs = data.receipts.filter(r => r.orderId === o.id);
  const ds = data.deliveries.filter(d => d.orderId === o.id);
  const cs = data.collections.filter(c => c.orderId === o.id);
  const row = all.rows.find(r => r.orderId === o.id);
  const disc = all.discrepancies.filter(d => d.orderId === o.id || d.ref === o.id);
  return <div className="grid2">
    <section className="card"><h3>{o.id} <Badge v={o.status} /></h3>
      <dl className="kv"><dt>Time</dt><dd>{o.ts.replace('T', ' ')} · {o.shift}</dd><dt>Customer</dt><dd>{o.customerRef}</dd>
        <dt>Items</dt><dd>{o.items.map(i => `${i.qty}× ${i.pizza} @ ${fmt(i.unitPrice)}`).join(', ')}</dd>
        <dt>Discount / tax</dt><dd>−{fmt(o.discount)} / +{fmt(o.tax)}</dd><dt>Total</dt><dd><b>{fmt(orderTotal(o))}</b> · {o.payment}</dd></dl>
      <div className="row">
        <select value={o.status} onChange={e => setOrderStatus(o.id, e.target.value as never)}>
          {['RECEIVED', 'CONFIRMED', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].map(x => <option key={x}>{x}</option>)}</select>
        <button onClick={() => attempt(() => generateReceipt(o.id), 'Demo receipt generated')}>Generate receipt</button>
        {o.payment === 'COD' && <button onClick={() => setCollect(String((row?.outstanding ?? 0) / 100))}>Record COD collection</button>}
      </div>
    </section>
    <section className="card"><h3>Reconciliation {row && <Badge v={row.status} />}</h3>
      {row ? <dl className="kv"><dt>Expected</dt><dd>{fmt(row.expected)}</dd><dt>Collected</dt><dd>{fmt(row.collected)}</dd>
        <dt>Deposited</dt><dd>{fmt(row.deposited)}</dd><dt>Outstanding</dt><dd>{fmt(row.outstanding)}</dd><dt>Undeposited</dt><dd>{fmt(row.variance)}</dd></dl>
        : <p className="muted">Prepaid order — no cash trail.</p>}
      <h4>Receipts</h4>{rs.length ? rs.map(r => <div key={r.id}>{r.id} · {fmt(r.amount)} {r.voided && '(void)'}</div>) : <p className="muted">None</p>}
      <h4>Delivery</h4>{ds.map(d => <div key={d.id}>{d.id} · {staffName(d.personId)} · <Badge v={d.status} /></div>)}
      <h4>Collections</h4>{cs.length ? cs.map(c => <div key={c.id}>{c.id} · {c.reversesId ? `reverses ${c.reversesId}` : fmt(c.amount)} · {c.ts.slice(11, 16)}</div>) : <p className="muted">None</p>}
      <h4>Discrepancies</h4>{disc.length ? <DiscTable list={disc} /> : <p className="muted">None</p>}
    </section>
    {collect !== null && <Modal title={`Record COD collection — ${o.id}`} onClose={() => setCollect(null)}>
      <p className="demo-note">DEMO: simulated entry. No real cash moves.</p>
      <label>Amount (₹)<input type="number" value={collect} onChange={e => setCollect(e.target.value)} /></label>
      <button onClick={() => attempt(() => recordCollection(o.id, Math.round(Number(collect) * 100)), 'Collection recorded') && setCollect(null)}>Save</button>
    </Modal>}
  </div>;
}

/* ---------------- COD Reconciliation + Deposits ---------------- */
export function Cod() {
  const [q, setQ] = useSearchParams();
  const tab = q.get('tab') ?? 'recon';
  const status = q.get('status') ?? '';
  const [person, setPerson] = useState('');
  const { rows, summary: s } = useRecon();
  const list = rows.filter(r => (!status || r.status === status) && (!person || r.personId === person));
  return <div>
    <div className="kpis small">
      <div className="kpi"><span>Expected</span><b>{fmt(s.codExpected)}</b></div>
      <div className="kpi"><span>Collected</span><b>{fmt(s.codCollected)}</b></div>
      <div className="kpi"><span>Deposited</span><b>{fmt(s.codDeposited)}</b></div>
      <div className="kpi a"><span>Pending deposit</span><b>{fmt(s.pendingDeposit)}</b></div>
      <div className="kpi r"><span>Unresolved</span><b>{s.unresolvedCod}</b></div>
    </div>
    <div className="tabs"><button className={tab === 'recon' ? 'on' : ''} onClick={() => setQ({ tab: 'recon' })}>Reconciliation</button>
      <button className={tab === 'deposit' ? 'on' : ''} onClick={() => setQ({ tab: 'deposit' })}>Cash deposits</button></div>
    {tab === 'recon' ? <section className="card">
      <div className="toolbar">
        <select value={status} onChange={e => setQ(e.target.value ? { status: e.target.value } : {})}><option value="">All statuses</option>
          {(['MATCHED', 'PENDING_COLLECTION', 'PENDING_DEPOSIT', 'AMOUNT_MISMATCH', 'MISSING_BILL', 'MISSING_COLLECTION', 'DUPLICATE_RECORD', 'REQUIRES_REVIEW'] as CodStatus[]).map(x => <option key={x}>{x}</option>)}</select>
        <select value={person} onChange={e => setPerson(e.target.value)}><option value="">All riders</option>
          {STAFF.filter(x => x.role === 'DELIVERY').map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <span className="muted">{list.length} COD orders</span></div>
      <table><thead><tr><th>Order</th><th>Rider</th><th>Shift</th><th>Expected</th><th>Collected</th><th>Deposited</th><th>Outstanding</th><th>Undeposited</th><th>Status</th></tr></thead>
        <tbody>{list.map(r => <tr key={r.orderId}><td><Link to={`/orders/${r.orderId}`}>{r.orderId}</Link></td><td>{staffName(r.personId)}</td><td>{r.shift}</td>
          <td>{fmt(r.expected)}</td><td>{fmt(r.collected)}</td><td>{fmt(r.deposited)}</td>
          <td className={r.outstanding ? 'neg' : ''}>{fmt(r.outstanding)}</td><td className={r.variance ? 'warn' : ''}>{fmt(r.variance)}</td><td><Badge v={r.status} /></td></tr>)}
          {!list.length && <tr><td colSpan={9} className="empty">Nothing here.</td></tr>}</tbody></table>
    </section> : <Deposits />}
  </div>;
}

function Deposits() {
  const { data, createDeposit } = useStore();
  const allocated = new Set(data.deposits.flatMap(d => d.allocations.map(a => a.collectionId)));
  const reversed = new Set(data.collections.filter(c => c.reversesId).map(c => c.reversesId));
  const pending = data.collections.filter(c => !c.reversesId && !reversed.has(c.id) && !allocated.has(c.id));
  const [sel, setSel] = useState<string[]>([]);
  const [ref, setRef] = useState(''); const [declared, setDeclared] = useState('');
  const selSum = pending.filter(c => sel.includes(c.id)).reduce((s, c) => s + c.amount, 0);
  return <div className="grid2">
    <section className="card"><h3>Undeposited collections ({pending.length})</h3>
      <table><thead><tr><th></th><th>Collection</th><th>Order</th><th>Rider</th><th>Amount</th><th>Collected</th></tr></thead>
        <tbody>{pending.map(c => <tr key={c.id}><td><input type="checkbox" checked={sel.includes(c.id)} onChange={e => setSel(e.target.checked ? [...sel, c.id] : sel.filter(x => x !== c.id))} /></td>
          <td>{c.id}</td><td><Link to={`/orders/${c.orderId}`}>{c.orderId}</Link></td><td>{staffName(c.personId)}</td><td>{fmt(c.amount)}</td><td>{c.ts.replace('T', ' ').slice(0, 16)}</td></tr>)}
          {!pending.length && <tr><td colSpan={6} className="empty">All collections are deposited.</td></tr>}</tbody></table>
      <div className="form">
        <p>Selected: <b>{sel.length}</b> · allocated total <b>{fmt(selSum)}</b></p>
        <label>Deposit reference<input value={ref} onChange={e => setRef(e.target.value)} placeholder="e.g. CASH-DEMO-001" /></label>
        <label>Cash counted / declared (₹)<input type="number" value={declared} onChange={e => setDeclared(e.target.value)} placeholder={String(selSum / 100)} /></label>
        <button onClick={() => attempt(() => createDeposit(ref, Math.round(Number(declared || selSum / 100) * 100), sel), 'Deposit batch created') && (setSel([]), setRef(''), setDeclared(''))}>Create deposit batch</button>
        <p className="demo-note">DEMO: no bank integration. A declared amount different from the allocated total raises a discrepancy.</p>
      </div></section>
    <section className="card"><h3>Deposit batches</h3>
      <table><thead><tr><th>Ref</th><th>Time</th><th>Declared</th><th>Allocated</th><th>#</th></tr></thead>
        <tbody>{[...data.deposits].reverse().map(d => { const a = d.allocations.reduce((s, x) => s + x.amount, 0);
          return <tr key={d.id}><td>{d.ref}</td><td>{d.ts.replace('T', ' ').slice(0, 16)}</td><td>{fmt(d.declaredAmount)}</td>
            <td className={a !== d.declaredAmount ? 'neg' : ''}>{fmt(a)}</td><td>{d.allocations.length}</td></tr>; })}</tbody></table></section>
  </div>;
}

/* ---------------- Discrepancies ---------------- */
function DiscTable({ list }: { list: ReturnType<typeof useRecon>['discrepancies'] }) {
  const cases = useStore(s => s.cases);
  if (!list.length) return <p className="muted">No discrepancies.</p>;
  return <table><thead><tr><th>Type</th><th>Ref</th><th>Detail</th><th>Amount/Qty</th><th>Severity</th><th>Status</th></tr></thead>
    <tbody>{list.map(d => <tr key={d.key}><td><Link to={`/discrepancies/${encodeURIComponent(d.key)}`}>{d.type.replace(/_/g, ' ')}</Link></td>
      <td>{d.orderId ?? d.depositId ?? d.ref}</td><td>{d.detail}</td><td>{d.amount != null ? fmt(d.amount) : d.qty != null ? `${d.qty} pizzas` : '—'}</td>
      <td><Badge v={d.severity} /></td><td><Badge v={cases[d.key]?.status ?? 'OPEN'} /></td></tr>)}</tbody></table>;
}

export function Discrepancies() {
  const { discrepancies } = useRecon();
  const cases = useStore(s => s.cases);
  const [st, setSt] = useState('active');
  const list = discrepancies.filter(d => { const s = cases[d.key]?.status ?? 'OPEN'; return st === 'all' || (st === 'active' ? !['RESOLVED', 'DISMISSED'].includes(s) : s === st); });
  return <section className="card"><div className="toolbar"><select value={st} onChange={e => setSt(e.target.value)}>
    <option value="active">Active</option><option value="all">All</option>{['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE', 'RESOLVED', 'DISMISSED'].map(x => <option key={x}>{x}</option>)}</select>
    <span className="muted">Discrepancies are generated automatically from reconciliation rules. They indicate records that need review, not wrongdoing.</span></div>
    <DiscTable list={list} /></section>;
}

export function DiscrepancyDetail() {
  const key = decodeURIComponent(useParams().key ?? '');
  const all = useRecon({});
  const { cases, updateCase } = useStore();
  const nav = useNavigate();
  const [note, setNote] = useState('');
  const d = all.discrepancies.find(x => x.key === key);
  const c = cases[key] ?? { status: 'OPEN' as CaseStatus, notes: [] };
  if (!d) return <section className="card"><h3>No longer detected</h3><p>The underlying records now reconcile, so rule <code>{key}</code> no longer fires.
    {c.notes.length > 0 && ' Case history is preserved below.'}</p>{c.notes.map((n, i) => <div key={i} className="note">{n.ts} · {n.by}: {n.text}</div>)}
    <button onClick={() => nav('/discrepancies')}>Back</button></section>;
  return <div className="grid2">
    <section className="card"><h3>{d.type.replace(/_/g, ' ')} <Badge v={d.severity} /> <Badge v={c.status} /></h3>
      <p>{d.detail}</p>
      <dl className="kv"><dt>Order</dt><dd>{d.orderId ? <Link to={`/orders/${d.orderId}`}>{d.orderId}</Link> : '—'}</dd>
        <dt>Receipts</dt><dd>{d.receiptIds?.join(', ') ?? '—'}</dd><dt>Delivery</dt><dd>{d.deliveryId ?? '—'}</dd>
        <dt>Collections</dt><dd>{d.collectionIds?.join(', ') ?? '—'}</dd><dt>Deposit</dt><dd>{d.depositId ?? '—'}</dd>
        <dt>Rider</dt><dd>{staffName(d.personId)}</dd><dt>When</dt><dd>{d.ts.replace('T', ' ')} {d.shift}</dd></dl>
      <div className="cctv"><div className="cctv-label">DEMO CLIP — NOT REAL FOOTAGE</div>
        <p>Camera: {d.type.includes('PRODUCTION') ? 'Pizza Oven (CAM-02)' : d.type.includes('BILL') || d.type.includes('RECEIPT') ? 'Billing Counter (CAM-04)' : 'Delivery Handover (CAM-08)'}<br />
          Window: {d.ts.slice(11, 16)} ± 10 min</p><small>CCTV is supporting evidence only. Financial records remain primary.</small></div>
    </section>
    <section className="card"><h3>Investigation</h3>
      <div className="row">
        <select value={c.assignee ?? ''} onChange={e => updateCase(key, { assignee: e.target.value })}><option value="">Assign reviewer…</option>
          {STAFF.filter(s => ['OWNER', 'MANAGER', 'AUDITOR', 'CASHIER'].includes(s.role)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select value={c.status} onChange={e => updateCase(key, { status: e.target.value as CaseStatus })}>
          {['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'].map(x => <option key={x}>{x}</option>)}</select></div>
      <textarea rows={3} placeholder="Notes (required to resolve or dismiss)" value={note} onChange={e => setNote(e.target.value)} />
      <div className="row">
        <button className="ghost" disabled={!note.trim()} onClick={() => { updateCase(key, {}, note); setNote(''); }}>Add note</button>
        <button disabled={!note.trim()} onClick={() => { updateCase(key, { status: 'RESOLVED' }, note); setNote(''); }}>Resolve</button>
        <button className="ghost" disabled={!note.trim()} onClick={() => { updateCase(key, { status: 'DISMISSED' }, note); setNote(''); }}>Dismiss with reason</button></div>
      <p className="muted">Resolving a case records a decision; it does not change financial records. Fix the record (e.g. record the collection) and the rule stops firing.</p>
      {c.notes.map((n, i) => <div key={i} className="note">{n.ts.replace('T', ' ')} · {n.by}: {n.text}</div>)}
    </section>
  </div>;
}

/* ---------------- Production / Audit ---------------- */
export function Production() {
  const data = useStore(s => s.data); const { f } = useFilterSafe();
  const { discrepancies, summary } = useRecon();
  const prod = data.production.filter(p => (!f.day || p.ts.startsWith(f.day)) && (!f.shift || p.shift === f.shift));
  return <div><section className="card"><h3>Production — {summary.pizzasProduced} produced · {summary.pizzasOrdered} in orders · {summary.pizzasWasted} wasted</h3>
    <p className="muted">Counts come from kitchen entries, not CCTV. Camera-based counting is not implemented.</p>
    <DiscTable list={discrepancies.filter(d => d.type === 'PRODUCTION_WITHOUT_ORDER')} /></section>
    <section className="card"><table><thead><tr><th>Batch</th><th>Time</th><th>Shift</th><th>Pizza</th><th>Qty</th><th>Wasted</th><th>Staff</th><th>Notes</th></tr></thead>
      <tbody>{prod.map(p => <tr key={p.id}><td>{p.id}</td><td>{p.ts.slice(11, 16)}</td><td>{p.shift}</td><td>{p.pizza}</td><td>{p.qty}</td><td>{p.wasted ?? 0}</td><td>{staffName(p.staffId)}</td><td>{p.notes}</td></tr>)}</tbody></table></section></div>;
}

export function Audit() {
  const audit = useStore(s => s.audit);
  return <section className="card"><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Ref</th><th>Detail</th></tr></thead>
    <tbody>{audit.map(a => <tr key={a.id}><td>{a.ts.replace('T', ' ')}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.ref}</td><td>{a.detail}</td></tr>)}
      {!audit.length && <tr><td colSpan={5} className="empty">No actions yet.</td></tr>}</tbody></table></section>;
}
