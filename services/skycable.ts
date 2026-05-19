import api from "./api";

export interface SkycableArea {
  id: number;
  name: string;
  nodes_count: number;
  pending_count: number;
  in_progress_count: number;
  completed_count: number;
}

export interface SkycableNode {
  id: number;
  site_id: number;
  area_id: number;
  name: string;
  status: "pending" | "in_progress" | "completed";
  poles_count?: number;
  expected_cable_meters?: number;
  city?: string;
  barangay_name?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  team_id?: number | null;
  subcontractor_id?: number | null;
  team?: { id: number; name: string } | null;
  subcontractor?: { id: number; name: string } | null;
  // Teardown session fields
  date_start?: string | null;
  due_date?: string | null;
  date_finished?: string | null;
  expected_cable?: number | null;
  actual_cable?: number | null;
  progress_percentage?: number | null;
  report_type?: string | null;
}

export interface SkycablePole {
  id: number;
  node_id: number;
  pole_id: number;
  sequence: number;
  date_start?: string | null;
  cleared_at?: string | null;
  pole: {
    id: number;
    pole_code: string;
    lat: string;
    lng: string;
    skycable_status: "pending" | "in_progress" | "cleared";
    cableSlots: {
      slot_label: string;
      occupied_by: string;
    }[];
  };
}

export const getAreas = async (token: string, teamId?: number | null): Promise<SkycableArea[]> => {
  const qs = teamId ? `?team_id=${teamId}` : '';
  return api.request<SkycableArea[]>(`/skycable/areas${qs}`, {}, token);
};

export const getNodes = async (areaId: number, token: string, teamId?: number | null): Promise<{ data: SkycableNode[] }> => {
  const qs = teamId ? `&team_id=${teamId}` : '';
  return api.request<{ data: SkycableNode[] }>(`/skycable/nodes?area_id=${areaId}${qs}&per_page=200`, {}, token);
};

export const getNodePoles = async (nodeId: number, token: string): Promise<SkycablePole[]> => {
  return api.request<SkycablePole[]>(`/skycable/nodes/${nodeId}/poles`, {}, token);
};

export const getNodeDetail = async (nodeId: number, token: string): Promise<SkycableNode> => {
  const res = await api.request<{ data: SkycableNode } | SkycableNode>(`/skycable/nodes/${nodeId}`, {}, token);
  return (res as any)?.data ?? res;
};

export const startNodeTeardown = async (nodeId: number, token: string, dateStart: string): Promise<void> => {
  await api.request(`/skycable/nodes/${nodeId}`, { method: "PUT", body: JSON.stringify({ date_start: dateStart }) }, token);
};

export const startPoleTeardown = async (nodeId: number, poleId: number, token: string, dateStart: string): Promise<void> => {
  await api.request(`/skycable/nodes/${nodeId}/poles/${poleId}`, { method: "PUT", body: JSON.stringify({ date_start: dateStart }) }, token);
};

// ─── Delivery / Warehouse types ──────────────────────────────────────────────
// Source of truth: GET /skycable/teardowns returns TeardownLog records.
// Each completed teardown has the actual collected quantities already recorded.

export interface TeardownLog {
  id: number;
  status: string;
  actual_cable: number | null;
  expected_cable: number | null;
  nodes_collected: number;
  amplifiers_collected: number;
  extenders_collected: number;
  tsc_collected: number;
  powersupply_collected: number;
  ps_housing_collected: number;
  start_time: string;
  end_time: string | null;
  team?: { id: number; name: string } | null;
  span?: { span_code?: string | null; node?: { id: number; name: string } | null } | null;
}

// Warehouse staging flow:
// submitted → at_subcon_warehouse → in_transit → at_warehouse → processing → final_warehouse → sold | pulled_out
export type DeliveryStatus =
  | "submitted"
  | "at_subcon_warehouse"
  | "in_transit"
  | "at_warehouse"
  | "processing"
  | "final_warehouse"
  | "sold"
  | "pulled_out";

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  submitted:           "Submitted",
  at_subcon_warehouse: "At Subcon Warehouse",
  in_transit:          "In Transit",
  at_warehouse:        "At Warehouse",
  processing:          "Processing",
  final_warehouse:     "Final Warehouse",
  sold:                "Sold",
  pulled_out:          "Pulled Out",
};

export const DELIVERY_STATUS_COLORS: Record<DeliveryStatus, string> = {
  submitted:           "#64748b",
  at_subcon_warehouse: "#0b6cff",
  in_transit:          "#f59e0b",
  at_warehouse:        "#8b5cf6",
  processing:          "#06b6d4",
  final_warehouse:     "#059669",
  sold:                "#10b981",
  pulled_out:          "#ef4444",
};

// One entry per movement in the chain of custody
export interface DeliveryMovement {
  id: number;
  delivery_id: number;
  from_stage: string | null;
  to_stage: string;
  location_name: string;
  notes?: string | null;
  moved_by?: { id: number; name: string } | null;
  timestamp: string;
}

export interface TeardownDelivery {
  id: number;
  token: string;           // e.g. TDL-20260519-A3F2
  date: string;
  status: DeliveryStatus;
  current_location?: string | null;
  total_cable: number;
  total_node: number;
  total_amplifier: number;
  total_extender: number;
  total_tsc: number;
  total_psu: number;
  total_psu_case: number;
  teardown_count: number;
  notes?: string | null;
  team?: { id: number; name: string } | null;
  submitted_by?: { id: number; name: string } | null;
  movements?: DeliveryMovement[];
  created_at?: string;
  updated_at?: string;
}

export interface DeliveryTotals {
  cable: number;
  node: number;
  amplifier: number;
  extender: number;
  tsc: number;
  psu: number;
  psuCase: number;
}

/** Aggregate actual collected quantities from teardown logs for a given date */
export function calcDeliveryTotals(logs: TeardownLog[]): DeliveryTotals {
  return logs.reduce(
    (acc, l) => {
      acc.cable     += l.actual_cable          ?? 0;
      acc.node      += l.nodes_collected       ?? 0;
      acc.amplifier += l.amplifiers_collected  ?? 0;
      acc.extender  += l.extenders_collected   ?? 0;
      acc.tsc       += l.tsc_collected         ?? 0;
      acc.psu       += l.powersupply_collected ?? 0;
      acc.psuCase   += l.ps_housing_collected  ?? 0;
      return acc;
    },
    { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 }
  );
}

/** Filter teardown logs to a specific PHT date (yyyy-mm-dd) */
export function filterLogsByDate(logs: TeardownLog[], date: string): TeardownLog[] {
  return logs.filter(l => {
    const ts = l.end_time ?? l.start_time;
    if (!ts) return false;
    // Convert UTC ISO to PHT (UTC+8) date
    const pht = new Date(new Date(ts).getTime() + 8 * 3600 * 1000);
    return pht.toISOString().slice(0, 10) === date;
  });
}

/** GET /skycable/teardowns — all teardown logs (filter by date client-side) */
export const getTeardownLogs = async (token: string): Promise<TeardownLog[]> => {
  const res = await api.request<TeardownLog[] | { data: TeardownLog[] }>(
    "/skycable/teardowns?per_page=500", {}, token
  );
  return Array.isArray(res) ? res : (res as any)?.data ?? [];
};

// ─── Backend-native delivery / warehouse types ───────────────────────────────

/** One line-item inside a dispatched delivery */
export interface DeliveryItem {
  id: number;
  delivery_id: number;
  item_type: "node" | "amplifier" | "extender" | "tsc" | "cable" | "powersupply";
  quantity: number;
  unit: string;
}

/** A dispatched delivery as the backend actually returns it */
export interface BackendDelivery {
  id: number;
  pickup_request_id: number;
  from_warehouse_id: number;
  to_warehouse_id: number;
  dispatched_by?: number | null;
  dispatched_at?: string | null;
  arrived_at?: string | null;
  accepted_by?: number | null;
  accepted_at?: string | null;
  status: "in_transit" | "accepted";
  notes?: string | null;
  items?: DeliveryItem[];
  created_at?: string;
  updated_at?: string;
}

/** A pickup request */
export interface PickupRequest {
  id: number;
  from_warehouse_id: number;
  to_warehouse_id: number;
  requested_by?: number | null;
  approved_by?: number | null;
  approved_at?: string | null;
  status: "pending" | "approved" | "cancelled";
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Current inventory for one item type in a warehouse */
export interface WarehouseStock {
  id: number;
  warehouse_id: number;
  item_type: "node" | "amplifier" | "extender" | "tsc" | "cable" | "powersupply";
  quantity: number;
  unit: string;
}

export interface Warehouse {
  id: number;
  name: string;
  location?: string | null;
}

// ─── Summable totals derived from TeardownLog records ────────────────────────
export interface CollectedTotals {
  cable: number;      // actual_cable (meters)
  node: number;       // nodes_collected
  amplifier: number;  // amplifiers_collected
  extender: number;   // extenders_collected
  tsc: number;        // tsc_collected
  psu: number;        // powersupply_collected
  psuCase: number;    // ps_housing_collected
}

export function sumTeardownLogs(logs: TeardownLog[]): CollectedTotals {
  return logs.reduce(
    (acc, l) => {
      acc.cable     += Number(l.actual_cable          ?? 0);
      acc.node      += Number(l.nodes_collected       ?? 0);
      acc.amplifier += Number(l.amplifiers_collected  ?? 0);
      acc.extender  += Number(l.extenders_collected   ?? 0);
      acc.tsc       += Number(l.tsc_collected         ?? 0);
      acc.psu       += Number(l.powersupply_collected ?? 0);
      acc.psuCase   += Number(l.ps_housing_collected  ?? 0);
      return acc;
    },
    { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 }
  );
}

// Convert a WarehouseStock array → CollectedTotals for display
export function stocksToTotals(stocks: WarehouseStock[]): CollectedTotals {
  const t: CollectedTotals = { cable: 0, node: 0, amplifier: 0, extender: 0, tsc: 0, psu: 0, psuCase: 0 };
  for (const s of stocks) {
    if (s.item_type === "cable")      t.cable     += Number(s.quantity ?? 0);
    if (s.item_type === "node")       t.node      += Number(s.quantity ?? 0);
    if (s.item_type === "amplifier")  t.amplifier += Number(s.quantity ?? 0);
    if (s.item_type === "extender")   t.extender  += Number(s.quantity ?? 0);
    if (s.item_type === "tsc")        t.tsc       += Number(s.quantity ?? 0);
    if (s.item_type === "powersupply")t.psu       += Number(s.quantity ?? 0);
  }
  return t;
}

/** GET /skycable/deliveries — backend-native dispatched deliveries */
export const getBackendDeliveries = async (token: string, status?: string): Promise<BackendDelivery[]> => {
  const qs = status ? `?status=${status}&per_page=500` : "?per_page=500";
  try {
    const res = await api.request<BackendDelivery[] | { data: BackendDelivery[] }>(
      `/skycable/deliveries${qs}`, {}, token
    );
    return Array.isArray(res) ? res : (res as any)?.data ?? [];
  } catch { return []; }
};

/** GET /skycable/pickup-requests */
export const getPickupRequests = async (token: string, status?: string): Promise<PickupRequest[]> => {
  const qs = status ? `?status=${status}&per_page=500` : "?per_page=500";
  try {
    const res = await api.request<PickupRequest[] | { data: PickupRequest[] }>(
      `/skycable/pickup-requests${qs}`, {}, token
    );
    return Array.isArray(res) ? res : (res as any)?.data ?? [];
  } catch { return []; }
};

/** GET /skycable/warehouses */
export const getWarehouses = async (token: string): Promise<Warehouse[]> => {
  try {
    const res = await api.request<Warehouse[] | { data: Warehouse[] }>("/skycable/warehouses", {}, token);
    return Array.isArray(res) ? res : (res as any)?.data ?? [];
  } catch { return []; }
};

/** GET /skycable/warehouses/:id/stocks */
export const getWarehouseStocks = async (token: string, warehouseId: number): Promise<WarehouseStock[]> => {
  try {
    const res = await api.request<WarehouseStock[] | { data: WarehouseStock[] }>(
      `/skycable/warehouses/${warehouseId}/stocks`, {}, token
    );
    return Array.isArray(res) ? res : (res as any)?.data ?? [];
  } catch { return []; }
};

/** PUT /skycable/deliveries/:id/accept — receive delivery at destination warehouse (photo required) */
export const acceptDelivery = async (
  token: string,
  deliveryId: number,
  photoUri: string,
  notes?: string
): Promise<void> => {
  const form = new FormData();
  form.append("notes", notes ?? "");
  form.append("received_photo", { uri: photoUri, type: "image/jpeg", name: "received_photo.jpg" } as any);
  await api.request(`/skycable/deliveries/${deliveryId}/accept`, {
    method: "PUT",
    body: form,
    headers: { "Content-Type": "multipart/form-data" },
  }, token);
};

/** POST /skycable/pickup-requests — request transfer of items to another warehouse */
export const createPickupRequest = async (
  token: string,
  payload: { from_warehouse_id: number; to_warehouse_id: number; notes?: string }
): Promise<PickupRequest> => {
  return api.request<PickupRequest>("/skycable/pickup-requests", {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
};

/** PUT /skycable/pickup-requests/:id/approve — approve a pickup request */
export const approvePickupRequest = async (token: string, id: number): Promise<void> => {
  await api.request(`/skycable/pickup-requests/${id}/approve`, { method: "PUT" }, token);
};

/** GET /skycable/deliveries — legacy alias (kept for delivery/index.tsx) */
export const getDeliveries = async (token: string, date?: string): Promise<TeardownDelivery[]> => {
  const qs = date ? `?date=${date}` : "";
  try {
    const res = await api.request<TeardownDelivery[] | { data: TeardownDelivery[] }>(
      `/skycable/deliveries${qs}`, {}, token
    );
    return Array.isArray(res) ? res : (res as any)?.data ?? [];
  } catch {
    return [];
  }
};

/** Generate a unique human-readable tracking token for a delivery batch */
export function generateDeliveryToken(date: string): string {
  const compact = date.replace(/-/g, "");                              // 20260519
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();  // A3F2
  return `TDL-${compact}-${rand}`;
}

/** POST /skycable/deliveries — submit today's teardown as a warehouse delivery */
export const submitDelivery = async (
  token: string,
  payload: {
    token: string;
    date: string;
    teardown_log_ids: number[];
    totals: DeliveryTotals;
    notes?: string | null;
  }
): Promise<TeardownDelivery> => {
  return api.request<TeardownDelivery>("/skycable/deliveries", {
    method: "POST",
    body: JSON.stringify({
      token:               payload.token,
      date:                payload.date,
      teardown_log_ids:    payload.teardown_log_ids,
      total_cable:         payload.totals.cable,
      total_node:          payload.totals.node,
      total_amplifier:     payload.totals.amplifier,
      total_extender:      payload.totals.extender,
      total_tsc:           payload.totals.tsc,
      total_psu:           payload.totals.psu,
      total_psu_case:      payload.totals.psuCase,
      notes:               payload.notes ?? null,
    }),
  }, token);
};

/**
 * POST /skycable/deliveries/:id/move
 * Advance a delivery to the next warehouse/stage in the chain.
 */
export const moveDelivery = async (
  token: string,
  deliveryId: number,
  payload: { to_stage: DeliveryStatus; location_name: string; notes?: string | null }
): Promise<TeardownDelivery> => {
  return api.request<TeardownDelivery>(`/skycable/deliveries/${deliveryId}/move`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
};

/**
 * POST /skycable/deliveries/:id/sold
 * Mark delivery as sold/distributed at final stage.
 */
export const markDeliverySold = async (token: string, deliveryId: number, notes?: string): Promise<void> => {
  await api.request(`/skycable/deliveries/${deliveryId}/sold`, {
    method: "POST",
    body: JSON.stringify({ notes: notes ?? null }),
  }, token);
};

/**
 * POST /skycable/deliveries/:id/pullout
 * Mark delivery as pulled out / returned.
 */
export const markDeliveryPullout = async (token: string, deliveryId: number, notes?: string): Promise<void> => {
  await api.request(`/skycable/deliveries/${deliveryId}/pullout`, {
    method: "POST",
    body: JSON.stringify({ notes: notes ?? null }),
  }, token);
};

/** POST /skycable/deliveries/:id/approve — warehouse in-charge receives delivery at subcon warehouse */
export const approveDelivery = async (token: string, deliveryId: number): Promise<void> => {
  await api.request(`/skycable/deliveries/${deliveryId}/approve`, { method: "POST" }, token);
};

export const downloadSitemapData = async (token: string): Promise<boolean> => {
  try {
    const { cacheSet } = await import("@/lib/cache");
    const areas = await getAreas(token);
    await cacheSet("sitemap_areas", areas);

    for (const area of areas) {
      const nodesRes = await getNodes(area.id, token);
      const nodes = nodesRes.data;
      await cacheSet(`sitemap_nodes_${area.id}`, nodes);

      // Download poles in small chunks to avoid overwhelming the network
      const chunkSize = 5;
      for (let i = 0; i < nodes.length; i += chunkSize) {
        const chunk = nodes.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (node) => {
            try {
              const poles = await getNodePoles(node.id, token);
              await cacheSet(`sitemap_poles_${node.id}`, poles);
            } catch (e) {
              console.warn(`Failed to cache poles for node ${node.id}`);
            }
          })
        );
      }
    }
    return true;
  } catch (err) {
    console.error("Sitemap download failed:", err);
    throw err;
  }
};

