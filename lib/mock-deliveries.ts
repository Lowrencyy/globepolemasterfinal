export type MockDelivery = {
  id: number;
  token: string;
  date: string;
  status: string;  // submitted | in_transit | accepted | pending_pickup
  organization: string;
  delivered_by: string;
  approved_by: string;
  received_at: string;
  current_location: string;
  received_image_uri: string | null;
  total_cable: number;
  total_node: number;
  total_amplifier: number;
  total_extender: number;
  total_tsc: number;
  total_psu: number;
  total_psu_case: number;
  teardown_count: number;
  movements: {
    id: number;
    to_stage: string;
    location_name: string;
    notes: string | null;
    timestamp: string;
    moved_by: { name: string } | null;
  }[];
};

// ── Status helpers ─────────────────────────────────────────────────────────────
export const DELIVERY_DISPLAY: Record<string, { label: string; color: string }> = {
  submitted:       { label: "Pending",     color: "#f59e0b" },
  pending_pickup:  { label: "Pending Pickup", color: "#f97316" },
  in_transit:      { label: "In Transit",  color: "#3b82f6" },
  accepted:        { label: "Completed",   color: "#10b981" },
  // legacy statuses from old flow
  at_subcon_warehouse: { label: "At Subcon WH",   color: "#0b6cff" },
  at_warehouse:        { label: "At Warehouse",    color: "#8b5cf6" },
  processing:          { label: "Processing",      color: "#06b6d4" },
  final_warehouse:     { label: "Final Warehouse", color: "#059669" },
  sold:                { label: "Sold",             color: "#10b981" },
  pulled_out:          { label: "Pulled Out",       color: "#ef4444" },
};

// ── Mock data: ALL organizations, ALL statuses ────────────────────────────────
export const MOCK_DELIVERIES: MockDelivery[] = [

  // ── PENDING (submitted — awaiting pickup) ──────────────────────────────────
  {
    id: 4,
    token: "TDL-20260520-R2P1",
    date: "2026-05-20",
    status: "submitted",
    organization: "Subcon — Marikina Branch",
    delivered_by: "Roberto Santos",
    approved_by: "—",
    received_at: "2026-05-20T07:00:00",
    current_location: "Subcon Staging Area — Marikina",
    received_image_uri: null,
    total_cable: 280, total_node: 8, total_amplifier: 2,
    total_extender: 3, total_tsc: 1, total_psu: 2, total_psu_case: 2,
    teardown_count: 5,
    movements: [
      { id: 40, to_stage: "submitted", location_name: "Subcon Staging Area — Marikina", notes: "Collection complete, awaiting pickup request", timestamp: "2026-05-20T07:00:00", moved_by: { name: "Roberto Santos" } },
    ],
  },
  {
    id: 5,
    token: "TDL-20260520-S3Q2",
    date: "2026-05-20",
    status: "submitted",
    organization: "Subcon — Caloocan Branch",
    delivered_by: "Ana Reyes",
    approved_by: "—",
    received_at: "2026-05-20T08:30:00",
    current_location: "Subcon Yard — Caloocan",
    received_image_uri: null,
    total_cable: 190, total_node: 6, total_amplifier: 1,
    total_extender: 2, total_tsc: 1, total_psu: 1, total_psu_case: 1,
    teardown_count: 4,
    movements: [
      { id: 50, to_stage: "submitted", location_name: "Subcon Yard — Caloocan", notes: null, timestamp: "2026-05-20T08:30:00", moved_by: { name: "Ana Reyes" } },
    ],
  },

  // ── IN TRANSIT ─────────────────────────────────────────────────────────────
  {
    id: 6,
    token: "TDL-20260519-T4R3",
    date: "2026-05-19",
    status: "in_transit",
    organization: "Subcon → TelcoVantage Main WH",
    delivered_by: "Carlos Mendoza",
    approved_by: "IT Department",
    received_at: "2026-05-19T11:00:00",
    current_location: "En Route — EDSA Northbound",
    received_image_uri: null,
    total_cable: 520, total_node: 15, total_amplifier: 4,
    total_extender: 6, total_tsc: 2, total_psu: 5, total_psu_case: 5,
    teardown_count: 10,
    movements: [
      { id: 60, to_stage: "submitted",   location_name: "Subcon WH — QC",            notes: null,                    timestamp: "2026-05-19T08:00:00", moved_by: { name: "Carlos Mendoza" } },
      { id: 61, to_stage: "in_transit",  location_name: "En Route — EDSA Northbound", notes: "ETA 2 hours",           timestamp: "2026-05-19T11:00:00", moved_by: { name: "IT Department Tracker" } },
    ],
  },
  {
    id: 7,
    token: "TDL-20260518-U5S4",
    date: "2026-05-18",
    status: "in_transit",
    organization: "Subcon → TelcoVantage Pasig WH",
    delivered_by: "Miguel Torres",
    approved_by: "TelcoVantage PM",
    received_at: "2026-05-18T13:00:00",
    current_location: "En Route — C5 Road",
    received_image_uri: null,
    total_cable: 340, total_node: 10, total_amplifier: 3,
    total_extender: 4, total_tsc: 2, total_psu: 3, total_psu_case: 3,
    teardown_count: 7,
    movements: [
      { id: 70, to_stage: "submitted",  location_name: "Subcon WH — Marikina",   notes: null,             timestamp: "2026-05-18T09:00:00", moved_by: { name: "Miguel Torres"   } },
      { id: 71, to_stage: "in_transit", location_name: "En Route — C5 Road",     notes: "Truck no. 412",  timestamp: "2026-05-18T13:00:00", moved_by: { name: "Dispatch — IT"  } },
    ],
  },

  // ── COMPLETED / ACCEPTED → These contribute to warehouse stocks ───────────
  {
    id: 1,
    token: "TDL-20260519-A3F2",
    date: "2026-05-19",
    status: "accepted",
    organization: "TelcoVantage Main Warehouse",
    delivered_by: "Juan Dela Cruz",
    approved_by: "Maria Santos",
    received_at: "2026-05-19T10:30:00",
    current_location: "TelcoVantage Main WH — Quezon City",
    received_image_uri: "https://placehold.co/600x400/ecfdf5/0B7A5A/png?text=Received+QC",
    total_cable: 450, total_node: 12, total_amplifier: 3,
    total_extender: 5, total_tsc: 2, total_psu: 4, total_psu_case: 4,
    teardown_count: 8,
    movements: [
      { id: 10, to_stage: "submitted",  location_name: "Site — Caloocan",                  notes: null,                       timestamp: "2026-05-19T07:00:00", moved_by: { name: "Juan Dela Cruz" } },
      { id: 11, to_stage: "in_transit", location_name: "En Route — EDSA",                  notes: null,                       timestamp: "2026-05-19T08:30:00", moved_by: { name: "Pedro Reyes"    } },
      { id: 12, to_stage: "accepted",   location_name: "TelcoVantage Main WH — QC",        notes: "Received and checked in",  timestamp: "2026-05-19T10:30:00", moved_by: { name: "Maria Santos"   } },
    ],
  },
  {
    id: 2,
    token: "TDL-20260518-B7C1",
    date: "2026-05-18",
    status: "accepted",
    organization: "TelcoVantage — Pasig Processing",
    delivered_by: "Pedro Reyes",
    approved_by: "Jose Reyes",
    received_at: "2026-05-18T14:15:00",
    current_location: "TelcoVantage Processing — Pasig",
    received_image_uri: "https://placehold.co/600x400/ecfdf5/0B7A5A/png?text=Received+Pasig",
    total_cable: 620, total_node: 18, total_amplifier: 5,
    total_extender: 7, total_tsc: 3, total_psu: 6, total_psu_case: 6,
    teardown_count: 11,
    movements: [
      { id: 20, to_stage: "submitted",  location_name: "Site — Marikina",                  notes: null,                  timestamp: "2026-05-18T09:00:00", moved_by: { name: "Pedro Reyes"  } },
      { id: 21, to_stage: "in_transit", location_name: "En Route — C5",                    notes: null,                  timestamp: "2026-05-18T12:00:00", moved_by: { name: "Dispatch IT"  } },
      { id: 22, to_stage: "accepted",   location_name: "TelcoVantage Processing — Pasig",  notes: "Complete — verified", timestamp: "2026-05-18T14:15:00", moved_by: { name: "Jose Reyes"   } },
    ],
  },
  {
    id: 3,
    token: "TDL-20260517-D4E9",
    date: "2026-05-17",
    status: "accepted",
    organization: "IT Department — Mandaluyong Storage",
    delivered_by: "Carlos Mendoza",
    approved_by: "IT Dept. Head",
    received_at: "2026-05-17T14:00:00",
    current_location: "IT Dept. Storage — Mandaluyong",
    received_image_uri: null,
    total_cable: 310, total_node: 9, total_amplifier: 2,
    total_extender: 3, total_tsc: 1, total_psu: 3, total_psu_case: 3,
    teardown_count: 6,
    movements: [
      { id: 30, to_stage: "submitted",  location_name: "Site — Mandaluyong",              notes: null,                       timestamp: "2026-05-17T06:30:00", moved_by: { name: "Carlos Mendoza" } },
      { id: 31, to_stage: "in_transit", location_name: "En Route — Shaw Blvd",            notes: null,                       timestamp: "2026-05-17T08:10:00", moved_by: { name: "Carlos Mendoza" } },
      { id: 32, to_stage: "accepted",   location_name: "IT Dept. Storage — Mandaluyong", notes: "Logged in IT inventory",    timestamp: "2026-05-17T14:00:00", moved_by: { name: "IT Dept. Head"  } },
    ],
  },
  {
    id: 8,
    token: "TDL-20260516-E6H7",
    date: "2026-05-16",
    status: "accepted",
    organization: "TelcoVantage Final WH — Mandaluyong",
    delivered_by: "Jose Reyes",
    approved_by: "VP Operations",
    received_at: "2026-05-16T16:00:00",
    current_location: "TelcoVantage Final WH — Mandaluyong",
    received_image_uri: "https://placehold.co/600x400/ecfdf5/0B7A5A/png?text=Final+WH",
    total_cable: 380, total_node: 11, total_amplifier: 3,
    total_extender: 5, total_tsc: 2, total_psu: 4, total_psu_case: 4,
    teardown_count: 7,
    movements: [
      { id: 80, to_stage: "submitted",  location_name: "Subcon WH — Taguig",              notes: null,                     timestamp: "2026-05-16T08:00:00", moved_by: { name: "Jose Reyes"   } },
      { id: 81, to_stage: "in_transit", location_name: "En Route — SLEX",                 notes: null,                     timestamp: "2026-05-16T10:00:00", moved_by: { name: "Logistics IT" } },
      { id: 82, to_stage: "accepted",   location_name: "TelcoVantage Final WH",           notes: "Archived batch F-0516",  timestamp: "2026-05-16T16:00:00", moved_by: { name: "VP Operations"} },
    ],
  },
];

// ── Warehouse stocks derived from accepted deliveries ─────────────────────────
// Rule: accepted deliveries add to warehouse inventory

export type MockWarehouseStock = {
  warehouse: string;
  organization: string;
  cable: number;
  node: number;
  amplifier: number;
  extender: number;
  tsc: number;
  psu: number;
  psuCase: number;
};

function buildWarehouseStocks(): MockWarehouseStock[] {
  const accepted = MOCK_DELIVERIES.filter(d => d.status === "accepted");

  const map: Record<string, MockWarehouseStock> = {};
  for (const d of accepted) {
    const key = d.organization;
    if (!map[key]) {
      map[key] = { warehouse: key, organization: key, cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 };
    }
    map[key].cable     += d.total_cable;
    map[key].node      += d.total_node;
    map[key].amplifier += d.total_amplifier;
    map[key].extender  += d.total_extender;
    map[key].tsc       += d.total_tsc;
    map[key].psu       += d.total_psu;
    map[key].psuCase   += d.total_psu_case;
  }
  return Object.values(map);
}

export const MOCK_WAREHOUSE_STOCKS = buildWarehouseStocks();

// Combined totals across all warehouses (for the overview card)
export const MOCK_TOTAL_STOCKS = MOCK_WAREHOUSE_STOCKS.reduce(
  (acc, s) => ({
    cable:     acc.cable     + s.cable,
    node:      acc.node      + s.node,
    amplifier: acc.amplifier + s.amplifier,
    extender:  acc.extender  + s.extender,
    tsc:       acc.tsc       + s.tsc,
    psu:       acc.psu       + s.psu,
    psuCase:   acc.psuCase   + s.psuCase,
  }),
  { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 }
);

// Collected totals from all deliveries (pending + in_transit + accepted)
export const MOCK_COLLECTED_TOTALS = MOCK_DELIVERIES.reduce(
  (acc, d) => ({
    cable:     acc.cable     + d.total_cable,
    node:      acc.node      + d.total_node,
    amplifier: acc.amplifier + d.total_amplifier,
    extender:  acc.extender  + d.total_extender,
    tsc:       acc.tsc       + d.total_tsc,
    psu:       acc.psu       + d.total_psu,
    psuCase:   acc.psuCase   + d.total_psu_case,
  }),
  { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 }
);
