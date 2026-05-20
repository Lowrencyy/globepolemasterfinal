# Delivery Status & Warehouse Management — System Plan

> **Project:** TelcoVantage PoleMaster  
> **Scope:** Full chain-of-custody from teardown collection → subcon staging → delivery → warehouse stock  
> **Date:** 2026-05-20  
> **Status:** Planning

---

## 1. System Overview

```
Field Staff                 Subcon PM / WH In-Charge        TelcoVantage / IT Dept
──────────                  ────────────────────────         ─────────────────────
Complete teardown           View collected items             View all deliveries
     │                      Create pickup request            Approve pickup requests
     │                      Capture received photo           Monitor warehouse stocks
     ▼                               │                               │
skycable_teardown_reports            │                               │
  (backend_approved)                 ▼                               ▼
     │                     POST /pickup-requests          GET /warehouses/:id/stocks
     └──────────────────►  POST /deliveries/:id/dispatch  PUT /deliveries/:id/accept
                           PUT /pickup-requests/:id/approve
```

---

## 2. Roles & Permissions

| Role | Can Do |
|------|--------|
| `field_staff` | View own teardowns, view delivery status |
| `subcon_pm` | Create pickup requests, view subcon deliveries |
| `warehouse_in_charge` | Accept deliveries (with photo), view stocks |
| `project_manager` | Approve pickup requests, view all deliveries |
| `admin` | Full access — all actions + stock adjustments |
| `executive` | Read-only dashboard across all warehouses |
| `it_department` | Track all deliveries, generate reports |

---

## 3. Database Tables

### 3.1 Existing Tables (already in backend)

```sql
-- skycable_teardown_reports (already exists)
id, span_id, team_id, lineman_id,
start_time, end_time, duration_minutes,
actual_cable,          -- meters collected
nodes_collected,
amplifiers_collected,
extenders_collected,
tsc_collected,
powersupply_collected, -- PSU units
ps_housing_collected,  -- PSU Cases
status,                -- pending | submitted | subcon_approved | backend_approved
subcon_reviewed_by, subcon_reviewed_at,
backend_approved_by, backend_approved_at

-- warehouses (already exists)
id, name, location, created_at, updated_at

-- warehouse_stocks (already exists)
id, warehouse_id, item_type, quantity, unit
-- item_type: node | amplifier | extender | tsc | cable | powersupply

-- pickup_requests (already exists)
id, from_warehouse_id, to_warehouse_id,
requested_by, approved_by, approved_at,
status,   -- pending | approved | cancelled
notes, created_at, updated_at

-- deliveries (already exists)
id, pickup_request_id,
from_warehouse_id, to_warehouse_id,
dispatched_by, dispatched_at,
arrived_at, accepted_by, accepted_at,
status,   -- in_transit | accepted
notes, created_at, updated_at

-- delivery_items (already exists)
id, delivery_id, item_type, quantity, unit
```

### 3.2 Tables That Need to Be Added / Modified

```sql
-- ① ADD: received_photo to deliveries
ALTER TABLE deliveries
  ADD COLUMN received_photo_url  VARCHAR(500) NULL,
  ADD COLUMN received_photo_path VARCHAR(500) NULL;

-- ② ADD: Teardown-to-Delivery linking table
-- (ties which teardown reports are included in a pickup request)
CREATE TABLE pickup_request_teardowns (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pickup_request_id   BIGINT UNSIGNED NOT NULL,
  teardown_report_id  BIGINT UNSIGNED NOT NULL,
  created_at          TIMESTAMP NULL,
  updated_at          TIMESTAMP NULL,
  FOREIGN KEY (pickup_request_id)  REFERENCES pickup_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (teardown_report_id) REFERENCES skycable_teardown_reports(id)
);

-- ③ ADD: Delivery tracking events (chain of custody log)
CREATE TABLE delivery_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  delivery_id     BIGINT UNSIGNED NOT NULL,
  event_type      ENUM('dispatched','in_transit','arrived','accepted','rejected') NOT NULL,
  location_name   VARCHAR(255) NULL,
  notes           TEXT NULL,
  photo_url       VARCHAR(500) NULL,
  performed_by    BIGINT UNSIGNED NULL,  -- FK to users
  performed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP NULL,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (performed_by) REFERENCES users(id)
);

-- ④ ADD: Stock movement log (audit trail for warehouse)
CREATE TABLE warehouse_stock_movements (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  warehouse_id    BIGINT UNSIGNED NOT NULL,
  delivery_id     BIGINT UNSIGNED NULL,   -- source delivery (if from delivery)
  item_type       ENUM('node','amplifier','extender','tsc','cable','powersupply') NOT NULL,
  quantity_change DECIMAL(10,2) NOT NULL, -- positive = in, negative = out
  balance_after   DECIMAL(10,2) NOT NULL,
  reason          ENUM('delivery_accepted','transfer_out','adjustment','pullout') NOT NULL,
  performed_by    BIGINT UNSIGNED NULL,
  notes           TEXT NULL,
  created_at      TIMESTAMP NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (delivery_id)  REFERENCES deliveries(id),
  FOREIGN KEY (performed_by) REFERENCES users(id)
);

-- ⑤ MODIFY: pickup_requests — add totals summary
ALTER TABLE pickup_requests
  ADD COLUMN total_cable          DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN total_nodes          INT           DEFAULT 0,
  ADD COLUMN total_amplifiers     INT           DEFAULT 0,
  ADD COLUMN total_extenders      INT           DEFAULT 0,
  ADD COLUMN total_tsc            INT           DEFAULT 0,
  ADD COLUMN total_powersupply    INT           DEFAULT 0,
  ADD COLUMN total_ps_housing     INT           DEFAULT 0,
  ADD COLUMN teardown_count       INT           DEFAULT 0,
  ADD COLUMN token                VARCHAR(50)   NULL UNIQUE; -- TDL-YYYYMMDD-XXXX

-- ⑥ ADD: Warehouse assignment for users (who is in-charge of which WH)
CREATE TABLE user_warehouse_assignments (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  warehouse_id BIGINT UNSIGNED NOT NULL,
  role         ENUM('in_charge','viewer') DEFAULT 'viewer',
  created_at   TIMESTAMP NULL,
  UNIQUE KEY uq_user_warehouse (user_id, warehouse_id),
  FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);
```

---

## 4. API Endpoints Needed

### 4.1 Teardown Reports (existing, minor additions)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/skycable/teardowns` | List all — filter by `status`, `team_id`, `date` |
| `GET` | `/skycable/teardowns/:id` | Single report detail |
| `GET` | `/skycable/teardowns/pending-pickup` | **NEW** — `backend_approved` not yet in a pickup request |

### 4.2 Pickup Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/skycable/pickup-requests` | List — filter by `status`, `from_warehouse_id` |
| `POST` | `/skycable/pickup-requests` | **Create** — body: `{ from_warehouse_id, to_warehouse_id, teardown_report_ids[], notes }` — auto-computes totals |
| `GET` | `/skycable/pickup-requests/:id` | Detail with teardown list + totals |
| `PUT` | `/skycable/pickup-requests/:id/approve` | Approve → PM/Admin only → enables dispatch |
| `PUT` | `/skycable/pickup-requests/:id/cancel` | Cancel → requester or PM |

### 4.3 Deliveries

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/skycable/deliveries` | List — filter by `status`, `from_warehouse_id`, `to_warehouse_id` |
| `GET` | `/skycable/deliveries/:id` | Detail with items + events chain |
| `POST` | `/skycable/deliveries/:pickup_request_id/dispatch` | **Dispatch** — decrements source warehouse stock |
| `PUT` | `/skycable/deliveries/:id/accept` | **Accept** — requires `received_photo` (multipart) — increments dest warehouse stock + logs movement |
| `GET` | `/skycable/deliveries/:id/events` | **NEW** — chain of custody events timeline |

### 4.4 Warehouses

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/skycable/warehouses` | List all warehouses |
| `GET` | `/skycable/warehouses/:id` | Single warehouse detail |
| `GET` | `/skycable/warehouses/:id/stocks` | Current inventory per item type |
| `GET` | `/skycable/warehouses/:id/movements` | **NEW** — stock movement audit log |
| `POST` | `/skycable/warehouses/:id/adjust` | **NEW** — manual stock adjustment (admin only) |

### 4.5 Dashboard / Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/skycable/dashboard/delivery-summary` | **NEW** — counts: pending, in_transit, accepted, total_value |
| `GET` | `/skycable/dashboard/stock-summary` | **NEW** — combined stock across all warehouses |
| `GET` | `/skycable/reports/delivery-history` | **NEW** — paginated delivery history with filters |

---

## 5. Mobile App Screens (Current + Needed)

### 5.1 Screens Already Built ✅

| Screen | File | Status |
|--------|------|--------|
| Delivery List | `app/delivery/index.tsx` | ✅ Done (mock data) |
| Delivery Detail | `app/delivery/[id].tsx` | ✅ Done + approve flow |
| Delivery Report List | `app/delivery/deliverylist.tsx` | ✅ Done |
| Pickup Request Form | `app/delivery/pickup-request.tsx` | ✅ Done |
| Warehouse Overview | `app/warehouse/index.tsx` | ✅ Done (mock data) |

### 5.2 Screens Still Needed ⬜

| Screen | File | Priority |
|--------|------|----------|
| Warehouse Detail | `app/warehouse/[id].tsx` | 🔴 High |
| Pending Teardowns for Pickup | `app/delivery/pending-teardowns.tsx` | 🔴 High |
| Pickup Request Detail | `app/delivery/pickup/[id].tsx` | 🟡 Medium |
| Stock Movement History | `app/warehouse/movements.tsx` | 🟡 Medium |
| Delivery Events Timeline | Built into `[id].tsx` | 🟡 Medium |
| Dashboard Summary Card | Update `app/(tabs)/index.tsx` | 🟡 Medium |

---

## 6. Full Delivery Flow (Step by Step)

```
STEP 1: Field staff completes teardown
  └─ POST /teardown-logs  → status: backend_approved
  └─ Items: actual_cable, nodes_collected, etc. recorded

STEP 2: Subcon PM/WH In-Charge creates pickup request
  └─ GET  /skycable/teardowns/pending-pickup   ← select which teardowns to group
  └─ POST /skycable/pickup-requests
        body: {
          from_warehouse_id: <subcon_wh>,
          to_warehouse_id:   <telcovantage_wh>,
          teardown_report_ids: [1, 2, 3],
          notes: "Batch May 20"
        }
  └─ Backend auto-computes totals from teardown reports
  └─ Generates token: TDL-20260520-XXXX
  └─ Status: pending

STEP 3: PM / Admin approves pickup request
  └─ PUT /skycable/pickup-requests/:id/approve
  └─ Status: approved
  └─ Mobile: Shows "Ready to Dispatch" on warehouse screen

STEP 4: Items dispatched (leave subcon warehouse)
  └─ POST /skycable/deliveries/:pickup_request_id/dispatch
  └─ Backend: Creates delivery, creates delivery_items from pickup totals
  └─ Backend: Decrements from_warehouse stock
  └─ Status: in_transit

STEP 5: WH In-Charge accepts delivery (with photo)
  └─ PUT /skycable/deliveries/:id/accept
        multipart: received_photo + notes
  └─ Backend: Saves photo, increments to_warehouse stock
  └─ Backend: Logs stock movement in warehouse_stock_movements
  └─ Status: accepted
  └─ Mobile: Photo shows in delivery detail

STEP 6: Stocks visible in warehouse
  └─ GET /skycable/warehouses/:id/stocks
  └─ Mobile warehouse screen: Cable 450m · Node 12 · etc.
```

---

## 7. Backend Implementation Checklist

### Phase 1 — DB Migrations (do first)
- [ ] Add `received_photo_url` to `deliveries`
- [ ] Create `pickup_request_teardowns` table
- [ ] Create `delivery_events` table
- [ ] Create `warehouse_stock_movements` table
- [ ] Add token + totals columns to `pickup_requests`
- [ ] Create `user_warehouse_assignments` table

### Phase 2 — API Controllers
- [ ] `PickupRequestController` — store, approve, cancel
  - [ ] Auto-compute totals from `teardown_report_ids`
  - [ ] Generate TDL token on create
  - [ ] Link teardowns via `pickup_request_teardowns`
- [ ] `DeliveryController` — dispatch, accept
  - [ ] `dispatch`: decrement `warehouse_stocks` on dispatch
  - [ ] `accept`: upload photo, increment `warehouse_stocks`, log movement
- [ ] `WarehouseController` — stocks, movements, adjust
- [ ] `DashboardController` — summary endpoints

### Phase 3 — File Upload (received photos)
- [ ] Use Laravel Storage for photo upload
- [ ] Store path in `deliveries.received_photo_url`
- [ ] Return public URL in API response

### Phase 4 — Auth Middleware
- [ ] `CanApprovePickup` — PM, Admin
- [ ] `CanAcceptDelivery` — WH In-Charge, PM, Admin
- [ ] `CanViewWarehouse` — role + warehouse assignment check

---

## 8. Mobile App Implementation Checklist

### Phase 1 — Wire to Real API (replace mock data)
- [ ] `delivery/index.tsx` — call `GET /skycable/pickup-requests` instead of mock
- [ ] `delivery/[id].tsx` — call `GET /skycable/deliveries/:id` with events
- [ ] `warehouse/index.tsx` — call real warehouse stocks + deliveries
- [ ] Remove `lib/mock-deliveries.ts` fallback when API is ready

### Phase 2 — New Screens
- [ ] `delivery/pending-teardowns.tsx` — list `backend_approved` teardowns, multi-select for pickup request
- [ ] `warehouse/movements.tsx` — stock movement history per warehouse
- [ ] Update `delivery/pickup-request.tsx` — add teardown selector step

### Phase 3 — Approval Flow
- [ ] Role check gate on Approve button (`canManageDelivery`)
- [ ] Photo upload with `multipart/form-data` on accept
- [ ] Optimistic UI update after approve/accept

---

## 9. Token Format

```
TDL - YYYYMMDD - XXXX
 │        │        │
 │        │        └── 4 random alphanumeric chars (uppercase)
 │        └─────────── Date in PHT (UTC+8)
 └──────────────────── Prefix: TDL = Teardown Delivery
```

**Example:** `TDL-20260520-A3F2`

---

## 10. Item Types Reference

| Code | Full Name | Unit |
|------|-----------|------|
| `cable` | Drop Cable | meters (m) |
| `node` | Node Equipment | pcs |
| `amplifier` | Line Amplifier | pcs |
| `extender` | Extender Unit | pcs |
| `tsc` | Tap/Splitter Cabinet | pcs |
| `powersupply` | Power Supply Unit (PSU) | pcs |
| `ps_housing` | PSU Housing/Case | pcs |

---

## 11. Status Flow Diagram

```
Teardown Report:
  pending → submitted → subcon_approved → backend_approved

Pickup Request:
  pending → approved → [dispatched via delivery]
          → cancelled

Delivery:
  [created on dispatch] → in_transit → accepted
```

---

## 12. Priority Order

| # | Task | Who | ETA |
|---|------|-----|-----|
| 1 | Run DB migrations (Phase 1) | Backend Dev | Day 1 |
| 2 | PickupRequestController with auto-totals | Backend Dev | Day 2 |
| 3 | DeliveryController accept with photo upload | Backend Dev | Day 3 |
| 4 | WarehouseController stocks + movements | Backend Dev | Day 3 |
| 5 | Wire delivery/index.tsx to real pickup-requests API | Mobile Dev | Day 4 |
| 6 | Wire warehouse/index.tsx to real stocks API | Mobile Dev | Day 4 |
| 7 | Pending teardowns selector for pickup request | Mobile Dev | Day 5 |
| 8 | Role-based approval gates + photo upload | Mobile Dev | Day 5 |
| 9 | Dashboard summary endpoints + mobile widget | Both | Day 6 |
| 10 | QA + end-to-end test full flow | Both | Day 7 |
