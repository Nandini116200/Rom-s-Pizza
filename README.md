# ROMS Pizza — Operations & Reconciliation Portal (Demo, Phase 1–2a)

All data is FICTIONAL. Nothing connects to real POS, CCTV, cash or bank systems.

## Run (Node 18+)
    npm install
    npm run dev        # http://localhost:5173
    npm test           # 20 engine tests
    npm run build

## Architecture
- `src/engine/types.ts`     domain model. Money is integer paise.
- `src/engine/reconcile.ts` PURE `reconcile(dataset, now, policy, filter)`. Every number in the UI comes from here.
- `src/engine/seed.ts`      deterministic 3-day dataset anchored to today, with 12 named scenarios.
- `src/store.ts`            Zustand store (localStorage, demo data only). Append-only financial writes + audit log.
- `src/ui/*`                React pages.

## Financial rules enforced
- Collections are never edited/deleted; corrections are reversal entries.
- A collection cannot be allocated to two deposits (blocked on write, and flagged by the engine).
- Duplicate receipts never inflate billed sales.
- Cancelled / returned / failed orders have expected COD = 0; cash recorded against them is flagged.
- Discrepancy IDs are deterministic (`TYPE:ref`). Fixing the record stops the rule firing; case notes are kept.

## Status
WORKS: demo login, dashboard (clickable KPIs, charts), production list + over-production rule,
orders list/detail, generate receipt, change order status, record COD collection, deposit batches,
COD reconciliation with filters, discrepancy list/detail (assign, notes, resolve, dismiss),
labelled demo CCTV placeholder, audit log, demo reset, logout.

NOT BUILT (Phase 3): live CCTV grid, camera management, delivery page, alerts centre, reports/export,
staff & shift close, outlets, settings, real auth, role permission enforcement, Connected Mode, global search.
