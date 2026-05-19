/**
 * Sitemap prefetch — downloads areas → nodes → poles → spans and caches all.
 * Called as part of every sync so the full teardown flow works offline.
 */
import { cacheGet, cacheSet } from "./cache";
import { getAreas, getNodes, getNodePoles } from "@/services/skycable";
import api from "./api";

async function fetchAndCacheSpans(nodeId: number): Promise<void> {
  try {
    const { data } = await api.get(`/skycable/spans?node_id=${nodeId}`);
    const all: any[] = Array.isArray(data) ? data : (data?.data ?? []);
    if (!all.length) return;

    // Group spans by pole id (each span can appear for both from_pole and to_pole)
    const byPole: Record<string, any[]> = {};
    for (const span of all) {
      const fromId = String(span.from_pole?.pole?.id ?? "");
      const toId   = String(span.to_pole?.pole?.id   ?? "");
      if (fromId) {
        (byPole[fromId] ??= []).push(span);
      }
      if (toId && toId !== fromId) {
        (byPole[toId] ??= []).push(span);
      }
    }

    // Cache the full list for the node (useful for warehouse/summary screens)
    await cacheSet(`spans_node_${nodeId}`, all).catch(() => {});

    // Cache per pole using the same key select-pair.tsx reads
    await Promise.allSettled(
      Object.entries(byPole).map(([poleId, spans]) =>
        cacheSet(`spans_pole_${poleId}`, spans),
      ),
    );
  } catch {}
}

let _isPrefetching = false;

export async function prefetchSitemap(token: string, force = false): Promise<void> {
  if (_isPrefetching) return;

  try {
    if (!force) {
      const lastSynced = await cacheGet<number>("sitemap_last_synced_at").catch(() => null);
      // Skip heavy prefetch loop if successfully synced within the last 24 hours
      if (lastSynced && Date.now() - lastSynced < 24 * 60 * 60 * 1000) {
        return;
      }
    }

    _isPrefetching = true;

    const areas = await getAreas(token);
    await cacheSet("sitemap_areas", areas);

    // Run sequentially to avoid hammering the backend with dozens of parallel requests
    for (const area of areas) {
      try {
        const { data: nodes } = await getNodes(area.id, token);
        await cacheSet(`sitemap_nodes_${area.id}`, nodes);

        for (const node of nodes) {
          try {
            const poles = await getNodePoles(node.id, token);
            await cacheSet(`sitemap_poles_${node.id}`, poles);

            // Prefetch spans for every pole in this node in one request
            await fetchAndCacheSpans(node.id);
          } catch {}
        }
      } catch {}
    }

    await cacheSet("sitemap_last_synced_at", Date.now()).catch(() => {});
  } catch {} finally {
    _isPrefetching = false;
  }
}
