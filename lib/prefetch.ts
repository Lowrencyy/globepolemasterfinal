/**
 * Background prefetch — runs once on app start.
 * Warms the cache for projects → nodes → poles + teardown data.
 * Non-blocking: never throws, never delays the UI.
 */
import api from "./api";
import { cacheSet } from "./cache";

async function run() {
  // Top-level sync only — 3 calls.
  // Nodes / poles / spans are fetched on-demand by each project screen
  // (cache-first) so there's no need to pre-download the full hierarchy.
  const [projRes, logsRes, subsRes] = await Promise.allSettled([
    api.get("/projects"),
    api.get("/teardown-logs?per_page=500"),
    api.get("/teardown-submissions?per_page=500"),
  ]);

  if (projRes.status === "fulfilled") {
    const list = Array.isArray(projRes.value.data) ? projRes.value.data : [];
    await cacheSet("projects_list", list);
  }
  if (logsRes.status === "fulfilled") {
    const d = logsRes.value.data;
    await cacheSet("teardown_logs", Array.isArray(d) ? d : d?.data ?? []);
  }
  if (subsRes.status === "fulfilled") {
    const d = subsRes.value.data;
    await cacheSet("teardown_submissions", Array.isArray(d) ? d : d?.data ?? []);
  }
}

let _prefetchDone = false;

export function isPrefetchDone(): boolean { return _prefetchDone; }
export function markPrefetchDone(): void  { _prefetchDone = true; }
export function resetPrefetchSession(): void { _prefetchDone = false; }

export function prefetchAll(): Promise<void> {
  return run().catch(() => {});
}
