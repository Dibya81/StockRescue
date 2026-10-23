# StockRescue Frontend

Operator-facing interface for the StockRescue industrial disruption recovery platform. Built with React 19, TypeScript, Three.js (React Three Fiber / Drei), and Tailwind CSS v4.

---

## Stack

- **Runtime:** Node.js `>=24.0.0` (pinned via `.nvmrc`) and npm `>=10.0.0`
- **Framework:** React 19 + Vite 8
- **Language:** TypeScript 5.8 with strict type checking
- **Styling:** Tailwind CSS v4 + industrial dark mode design tokens
- **3D Warehouse:** Three.js 0.186, `@react-three/fiber` v9, `@react-three/drei` v10
- **State & Data Fetching:** TanStack React Query v5
- **Routing:** React Router v7 with route-level lazy loading
- **Auth:** Supabase Auth JS v2 with JWT session persistence
- **Icons:** `lucide-react`
- **Testing:** Vitest v5 + `@testing-library/react` + `@testing-library/jest-dom`

---

## Prerequisites & Setup

Ensure Node.js 24 LTS is active:

```bash
# Using nvm
nvm use 24

# Verify versions
node --version # v24.x.x
npm --version  # >=10.x.x
```

Install dependencies:

```bash
cd frontend
npm install
```

Configure environment:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:

```env
# FastAPI backend base URL
VITE_API_BASE_URL=http://localhost:8000

# Supabase Auth configuration (public anon key only)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> **Security Note:** Never place service-role keys, database passwords, or agent seeds in `VITE_*` variables. Only public anon keys belong in the client.

---

## Development Scripts

```bash
# Start Vite development server
npm run dev

# Start on a custom port
npm run dev -- --port 5190

# Typecheck with TypeScript
npm run typecheck

# Run unit and component test suite
npm test

# Run tests once with Vitest
npm run test:run

# Run ESLint
npm run lint

# Build production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## Architecture & Features

### 1. Application Shell & Routing (`src/router.tsx`)
- Lazy-loaded pages with code-splitting for minimal initial bundle size.
- `ProtectedRoute` component verifying Supabase JWT session and role claims (`procurement_approver` required for `/approvals`).
- Responsive, collapsible sidebar (with `Ctrl+B` keyboard shortcut) and topbar showing operator identity and connectivity status.

### 2. Interactive 3D Warehouse (`src/features/warehouse/`)
- Canvas rendering interactive industrial racks, shelves, and storage bins.
- Color and symbol encoding for stock status (`normal` ✓, `low` ⚠, `shortage` ✕, `unknown` ?).
- Hover highlighting, bin selection panel, and SKU search.
- **2D List Fallback:** automatic WebGL detection and manual toggle to accessible table view.

### 3. Core Pages
- **Dashboard (`/`):** Real-time shortage counts, affected jobs, recovery plan states, and quick actions.
- **Warehouse (`/warehouse`):** 3D visualization and bin management.
- **Inventory (`/inventory`):** Comprehensive stock table with shortage filters and SKU search.
- **Disruptions (`/disruptions` & `/disruptions/new`):** Disruption case tracker and dynamic intake form.
- **Suppliers (`/suppliers`):** Part compatibility badges and quote lead-time assessments.
- **Recovery Plans (`/recovery`):** Feasibility review, line item breakdown, and uncertainty surfacing.
- **Approval Centre (`/approvals`):** Human-in-the-loop review, max cost approval/revocation controls.
- **Vendor Comms (`/communications`):** Explicit `DRAFT — NOT SENT` labeling with copy-only controls.
- **Deliveries (`/deliveries`):** Verified tracking events with unknown-status handling.
- **Agent Operations (`/agents`):** Agentverse 8-identity mailbox map and capability assignments.
- **Settings (`/settings`):** System runtime check, connectivity status, and purchasing safety switch.

---

## Security Invariants

- **Purchasing Disabled:** Purchasing and external communication triggers are strictly disabled in the UI.
- **Server Authorization:** All role checks and plan approvals are enforced server-side.
- **No Secrets in Bundles:** Source maps and production builds are audited against secret leaks.
- **Fail-Closed Reporting:** Unknown or missing data is explicitly presented as `Unknown`, never fabricated.
