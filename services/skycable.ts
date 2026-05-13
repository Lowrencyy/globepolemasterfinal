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

