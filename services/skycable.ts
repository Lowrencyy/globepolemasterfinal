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
  date_start?: string | null;
  due_date?: string | null;
  date_finished?: string | null;
  expected_cable?: number | null;
  actual_cable?: number | null;
  progress_percentage?: number | null;
  report_type?: "full_report" | "pole_report" | null;
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
  await api.request(
    `/skycable/nodes/${nodeId}`,
    { method: "PUT", body: JSON.stringify({ date_start: dateStart, status: "in_progress" }) },
    token,
  );
};

export const startPoleTeardown = async (nodeId: number, poleId: number, token: string, dateStart: string): Promise<void> => {
  await api.request(`/skycable/nodes/${nodeId}/poles/${poleId}`, { method: "PUT", body: JSON.stringify({ date_start: dateStart }) }, token);
};

// ─── Teardown Log types ───────────────────────────────────────────────────────
// Source of truth: GET /skycable/teardowns returns SkycableTeardownReport records.

export interface TeardownPhoto {
  id: number;
  photo_type: "before" | "after" | "pole_tag" | "bunching" | "supporting"
    | "from_before" | "from_after" | "from_pole_tag"
    | "to_before"   | "to_after"   | "to_pole_tag";
  image_path: string;
}

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
  notes?: string | null;
  team?: { id: number; name: string; subcontractor_id?: number | null; subcontractor?: { id: number; name: string } | null } | null;
  span?: {
    span_code?: string | null;
    node?: { id: number; name: string } | null;
    fromPole?: { pole?: { pole_code?: string; lat?: string | null; lng?: string | null } } | null;
    toPole?:   { pole?: { pole_code?: string; lat?: string | null; lng?: string | null } } | null;
  } | null;
  lineman?: { id: number; first_name: string; last_name: string } | null;
  photos?: TeardownPhoto[];
  subcontractor_id?: number | null;
  team_id?: number | null;
  captured_lat?: number | string | null;
  captured_lng?: number | string | null;
}

/** GET /skycable/teardowns — all teardown logs (filter by node_id, date etc.) */
export const getTeardownLogs = async (token: string): Promise<TeardownLog[]> => {
  const res = await api.request<TeardownLog[] | { data: TeardownLog[] }>(
    "/skycable/teardowns?per_page=500", {}, token
  );
  return Array.isArray(res) ? res : (res as any)?.data ?? [];
};

/** Filter teardown logs to a specific PHT date (yyyy-mm-dd) */
export function filterLogsByDate(logs: TeardownLog[], date: string): TeardownLog[] {
  return logs.filter(l => {
    const ts = l.end_time ?? l.start_time;
    if (!ts) return false;
    const pht = new Date(new Date(ts).getTime() + 8 * 3600 * 1000);
    return pht.toISOString().slice(0, 10) === date;
  });
}

// ─── Collected totals helpers ─────────────────────────────────────────────────

export interface CollectedTotals {
  cable: number;
  node: number;
  amplifier: number;
  extender: number;
  tsc: number;
  psu: number;
  psuCase: number;
}

// calcDeliveryTotals and sumTeardownLogs are identical — kept both names for compat
export function calcDeliveryTotals(logs: TeardownLog[]): CollectedTotals {
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

export const sumTeardownLogs = calcDeliveryTotals;

// ─── Warehouse types ──────────────────────────────────────────────────────────

export interface Warehouse {
  id: number;
  name: string;
  location?: string | null;
  type?: string | null;
  subcontractor_id?: number | null;
  lat?: number | null;
  lng?: number | null;
  subcontractor?: { id: number; name: string } | null;
  stocks?: WarehouseStock[];
}

export interface WarehouseStock {
  id: number;
  warehouse_id: number;
  item_type: "node" | "amplifier" | "extender" | "tsc" | "cable" | "powersupply";
  quantity: number;
  unit: string;
}

// ─── Warehouse Receipt types ──────────────────────────────────────────────────
// POST /skycable/warehouse-receipts — field staff submits collected items to a warehouse
// PUT  /skycable/warehouse-receipts/{id}/approve — warehouse in-charge approves → stocks++

export interface WarehouseReceiptItem {
  id: number;
  receipt_id: number;
  item_type: string;
  quantity: number;
  unit: string;
}

export interface WarehouseReceipt {
  id: number;
  warehouse_id: number;
  subcontractor_id?: number | null;
  node_id?: number | null;
  received_by?: number | null;
  receipt_date: string;            // yyyy-mm-dd
  status: "pending" | "arrived" | "approved" | "rejected";
  approved_by?: number | null;
  notes?: string | null;
  submitted_lat?: number | null;
  submitted_lng?: number | null;
  items?: WarehouseReceiptItem[];
  node?: { id: number; name: string } | null;
  warehouse?: Warehouse | null;
  receivedBy?: { id: number; name: string } | null;
  approvedBy?: { id: number; name: string } | null;
  created_at?: string;
  updated_at?: string;
}

/** Convert totals to receipt items array (skips zero quantities) */
export function totalsToReceiptItems(
  totals: CollectedTotals
): { item_type: string; quantity: number; unit: string }[] {
  return [
    { item_type: "cable",       quantity: totals.cable,     unit: "m"   },
    { item_type: "node",        quantity: totals.node,      unit: "pcs" },
    { item_type: "amplifier",   quantity: totals.amplifier, unit: "pcs" },
    { item_type: "extender",    quantity: totals.extender,  unit: "pcs" },
    { item_type: "tsc",         quantity: totals.tsc,       unit: "pcs" },
    { item_type: "powersupply", quantity: totals.psu,       unit: "pcs" },
  ].filter(i => i.quantity > 0);
}

/** POST /skycable/warehouse-receipts */
export const createWarehouseReceipt = async (
  token: string,
  payload: {
    warehouse_id: number;
    node_id?: number | null;
    subcontractor_id?: number | null;
    receipt_date: string;
    items: { item_type: string; quantity: number; unit: string }[];
    submitted_lat?: number | null;
    submitted_lng?: number | null;
  }
): Promise<WarehouseReceipt> => {
  return api.request<WarehouseReceipt>("/skycable/warehouse-receipts", {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
};

/** PUT /skycable/warehouse-receipts/{id}/approve */
export const approveWarehouseReceipt = async (
  token: string,
  receiptId: number,
  action: "approve" | "reject"
): Promise<WarehouseReceipt> => {
  return api.request<WarehouseReceipt>(`/skycable/warehouse-receipts/${receiptId}/approve`, {
    method: "PUT",
    body: JSON.stringify({ action }),
  }, token);
};

/** PUT /skycable/warehouse-receipts/{id}/arrive — mark receipt as arrived at warehouse */
export const markWarehouseReceiptArrived = async (
  token: string,
  receiptId: number
): Promise<WarehouseReceipt> => {
  return api.request<WarehouseReceipt>(`/skycable/warehouse-receipts/${receiptId}/arrive`, {
    method: "PUT",
  }, token);
};

/** GET /skycable/warehouse-receipts/{id} */
export const getWarehouseReceiptById = async (
  token: string,
  receiptId: number
): Promise<WarehouseReceipt> => {
  return api.request<WarehouseReceipt>(`/skycable/warehouse-receipts/${receiptId}`, {}, token);
};

/** POST /skycable/warehouse-receipts/{id}/verify — warehouse in-charge confirms quantities + attaches proof */
export const verifyWarehouseReceipt = async (
  token: string,
  receiptId: number,
  payload: {
    items: { item_type: string; quantity: number }[];
    notes?: string;
    proof_image?: { uri: string; name: string; type: string };
  }
): Promise<WarehouseReceipt> => {
  const form = new FormData();
  payload.items.forEach((it, i) => {
    form.append(`items[${i}][item_type]`, it.item_type);
    form.append(`items[${i}][quantity]`, String(it.quantity));
  });
  if (payload.notes) form.append("notes", payload.notes);
  if (payload.proof_image) {
    form.append("proof_image", payload.proof_image as unknown as Blob);
  }
  return api.request<WarehouseReceipt>(`/skycable/warehouse-receipts/${receiptId}/verify`, {
    method: "POST",
    body: form,
  }, token);
};

/** GET /skycable/warehouses/{warehouse}/receipts */
export const getWarehouseReceipts = async (
  token: string,
  warehouseId: number,
  status?: string
): Promise<WarehouseReceipt[]> => {
  const qs = status ? `?status=${status}&per_page=200` : "?per_page=200";
  try {
    const res = await api.request<WarehouseReceipt[] | { data: WarehouseReceipt[] }>(
      `/skycable/warehouses/${warehouseId}/receipts${qs}`, {}, token
    );
    return Array.isArray(res) ? res : (res as any)?.data ?? [];
  } catch { return []; }
};

/** PUT /skycable/warehouses/{id} — update warehouse (name, sqm, status, lat, lng) */
export const updateWarehouse = async (
  token: string,
  warehouseId: number,
  payload: { name?: string; sqm?: number | null; status?: "active" | "inactive"; lat?: number | null; lng?: number | null }
): Promise<Warehouse> => {
  return api.request<Warehouse>(`/skycable/warehouses/${warehouseId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }, token);
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

/** Convert WarehouseStock array → CollectedTotals for display */
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

// ─── Warehouse-to-Warehouse Delivery types (pickup request → dispatch → accept) ─
// These are INTERNAL warehouse transfers, not teardown submissions.

export interface DeliveryItem {
  id: number;
  delivery_id: number;
  item_type: "node" | "amplifier" | "extender" | "tsc" | "cable" | "powersupply";
  quantity: number;
  unit: string;
}

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

export interface PickupRequest {
  id: number;
  from_warehouse_id: number;
  to_warehouse_id: number;
  requested_by?: number | null;
  approved_by?: number | null;
  approved_at?: string | null;
  status: "pending" | "approved" | "dispatched" | "cancelled";
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** GET /skycable/deliveries — warehouse-to-warehouse transfers */
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

/** PUT /skycable/deliveries/{id}/accept — accept a warehouse-to-warehouse delivery */
export const acceptDelivery = async (token: string, deliveryId: number): Promise<BackendDelivery> => {
  return api.request<BackendDelivery>(`/skycable/deliveries/${deliveryId}/accept`, {
    method: "PUT",
  }, token);
};

/** POST /skycable/pickup-requests */
export const createPickupRequest = async (
  token: string,
  payload: { from_warehouse_id: number; to_warehouse_id: number; notes?: string }
): Promise<PickupRequest> => {
  return api.request<PickupRequest>("/skycable/pickup-requests", {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
};

/** PUT /skycable/pickup-requests/:id/approve */
export const approvePickupRequest = async (
  token: string,
  id: number,
  action: "approve" | "reject"
): Promise<PickupRequest> => {
  return api.request<PickupRequest>(`/skycable/pickup-requests/${id}/approve`, {
    method: "PUT",
    body: JSON.stringify({ action }),
  }, token);
};

// ─── Sitemap download ─────────────────────────────────────────────────────────

export const downloadSitemapData = async (token: string): Promise<boolean> => {
  try {
    const { cacheSet } = await import("@/lib/cache");
    const areas = await getAreas(token);
    await cacheSet("sitemap_areas", areas);

    for (const area of areas) {
      const nodesRes = await getNodes(area.id, token);
      const nodes = nodesRes.data;
      await cacheSet(`sitemap_nodes_${area.id}`, nodes);

      const chunkSize = 5;
      for (let i = 0; i < nodes.length; i += chunkSize) {
        const chunk = nodes.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (node) => {
            try {
              const poles = await getNodePoles(node.id, token);
              await cacheSet(`sitemap_poles_${node.id}`, poles);
            } catch {
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
