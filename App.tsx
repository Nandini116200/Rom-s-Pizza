import { useState } from 'react';
import { MemoryRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { STAFF } from './seed';
import { useStore } from './store';
import { FilterProvider, Modal, toast, Toaster, useFilter } from './common';
import { Audit, Cod, Dashboard, Discrepancies, DiscrepancyDetail, OrderDetail, Orders, Production } from './pages';

const NAV: [string, string, string][] = [
  ['OVERVIEW', '/', 'Dashboard'],
  ['OPERATIONS', '/production', 'Production Tracking'], ['OPERATIONS', '/orders', 'Orders & Billing'],
  ['FINANCIAL CONTROL', '/cod', 'COD & Deposits'], ['FINANCIAL CONTROL', '/discrepancies', 'Discrepancies'],
  ['SYSTEM', '/audit', 'Audit Log'],
];
const PHASE3 = ['Live CCTV', 'Delivery Management', 'Alerts', 'Reports', 'Staff & Shifts', 'Cameras', 'Outlets', 'Settings'];

function Login() {
  const login = useStore(s => s.login);
  const [who, setWho] = useState('U-OWN');
  return <div className="login"><div className="login-card">
    <div className="brand big">ROMS<span>Pizza</span></div>
    <h2>Operations & Reconciliation Portal</h2>
    <div className="demo-banner">DEMO MODE — SAMPLE DATA · fictional accounts, no passwords</div>
    <label>Sign in as<select value={who} onChange={e => setWho(e.target.value)}>
      {STAFF.filter(s => ['OWNER', 'MANAGER', 'CASHIER', 'AUDITOR'].includes(s.role)).map(s => <option key={s.id} value={s.id}>{s.name} — {s.role}</option>)}</select></label>
    <button onClick={() => login(who)}>Enter demo portal</button>
    <p className="muted">Real authentication is not implemented in this phase. Role-based permissions are not yet enforced.</p>
  </div></div>;
}

function Shell() {
  const { user, logout, resetDemo } = useStore();
  const { f, setF } = useFilter();
  const loc = useLocation();
  const [confirm, setConfirm] = useState(false);
  const title = NAV.find(n => n[1] === '/' + loc.pathname.split('/')[1])?.[2] ?? 'Detail';
  let lastGroup = '';
  return <div className="app">
    <aside><div className="brand">ROMS<span>Pizza</span></div>
      {NAV.map(([g, to, label]) => <div key={to}>{g !== lastGroup && (lastGroup = g) && <div className="group">{g}</div>}
        <NavLink to={to} end={to === '/'}>{label}</NavLink></div>)}
      <div className="group">NEXT PHASE</div>{PHASE3.map(p => <div key={p} className="disabled" title="Planned for Phase 3">{p}</div>)}
    </aside>
    <main>
      <div className="demo-banner">DEMO MODE — SAMPLE DATA. Nothing here is real CCTV, cash or POS data.</div>
      <header><h1>{title}</h1>
        <div className="row">
          <input type="date" value={f.day ?? ''} onChange={e => setF({ ...f, day: e.target.value || undefined })} />
          <select value={f.shift ?? ''} onChange={e => setF({ ...f, shift: (e.target.value || undefined) as never })}>
            <option value="">All shifts</option><option value="LUNCH">Lunch</option><option value="DINNER">Dinner</option></select>
          <button className="ghost" onClick={() => setF({ ...f, day: undefined })}>All days</button>
          <button className="ghost" onClick={() => setConfirm(true)}>Reset demo</button>
          <span className="user">{user!.name} · {user!.role}</span>
          <button className="ghost" onClick={logout}>Logout</button></div></header>
      <Routes>
        <Route path="/" element={<Dashboard />} /><Route path="/production" element={<Production />} />
        <Route path="/orders" element={<Orders />} /><Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/cod" element={<Cod />} /><Route path="/discrepancies" element={<Discrepancies />} />
        <Route path="/discrepancies/:key" element={<DiscrepancyDetail />} /><Route path="/audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </main>
    {confirm && <Modal title="Reset demo data?" onClose={() => setConfirm(false)}>
      <p>This regenerates the sample dataset and clears demo cases and audit entries in this browser. It cannot touch real records (there are none).</p>
      <div className="row"><button onClick={() => { resetDemo(); setConfirm(false); toast('Demo data reset'); }}>Reset</button>
        <button className="ghost" onClick={() => setConfirm(false)}>Cancel</button></div></Modal>}
  </div>;
}

export default function App() {
  const user = useStore(s => s.user);
  return <MemoryRouter><FilterProvider>{user ? <Shell /> : <Login />}<Toaster /></FilterProvider></MemoryRouter>;
}
