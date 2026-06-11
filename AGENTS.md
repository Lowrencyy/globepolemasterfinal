# Globe Mobile App — Codex Context

## What this is
Expo (SDK 54) / React Native mobile app for Globe field staff. Handles teardown reporting, NAP box management, and pole map viewing.

## Backend
```
BASE_URL = https://telcovantage.com/api/v1
```
Two separate API clients:
- `services/api.ts` → `api.request<T>(path, options, token)` — explicit token, used by services/
- `lib/api.ts` → `api.get/post/put/delete(url)` — reads token from `lib/token-bridge.ts`, used by teardown screens

## Token flow (CRITICAL)
`auth-context.tsx` is the single source of truth for authentication.  

On login → calls `setBridgeToken(token)` + `tokenStore.set(token)`  
On app start → `tokenStore.get()` rehydrates React state + calls `setBridgeToken(saved)`  
On logout → `setBridgeToken(null)` + `tokenStore.clear()`

`lib/token-bridge.ts` — synchronous in-memory token. `lib/api.ts` reads this via `getBridgeToken()` first, falls back to `tokenStore.get()`. This ensures teardown API calls always have the auth header WITHOUT requiring a re-login.

> **Why this matters:** `lib/api.ts` and `services/api.ts` are different files. Teardown screens use `lib/api.ts`. Before the token-bridge fix, teardown submissions had no Authorization header → 401 → silent offline queue.

## File structure
```
app/
  (tabs)/
    index.tsx       — Home screen (weather, clock, quick actions)
    explore.tsx     — Pole Map View (Leaflet WebView, all poles with GPS)
    profile.tsx     — User profile
  teardowns/
    index.tsx       — Area/node selection for teardowns
    nodes.tsx       — Node list
    poles.tsx       — Poles for selected node
    select-pair.tsx — Select span for teardown
    destination-pole.tsx — Destination pole detail + GPS + photos
    pole-detail.tsx — From-pole detail + photos
    components.tsx  — Cable/component collection + Mark as Complete
    teardown-complete.tsx — Success screen
  naps/
    index.tsx       — NAP box list
    audit.tsx       — Port audit
context/
  auth-context.tsx  — Login/logout, token management
lib/
  api.ts            — HTTP client (get/post/put/delete) using token-bridge
  cache.ts          — File-based JSON cache (expo-file-system)
  token.ts          — tokenStore (file-persisted, in-memory cache)
  token-bridge.ts   — Synchronous in-memory token (bridges auth-context → lib/api.ts)
  display-time.ts   — PHT time helpers (getPHTNow, getDisplayTime, saveDisplayTime)
  sync-queue.ts     — Offline submission queue (retries on network restore)
services/
  api.ts            — HTTP client (request<T>) using explicit token
  auth.ts           — loginGlobe, logoutGlobe
  pole.ts           — Globe pole API (getPoles with per_page support)
  skycable.ts       — Skycable areas/nodes/poles
  nap-box.ts        — NAP box + ports
```

## Time — always PHT (UTC+8)
`lib/display-time.ts` provides PHT-correct timestamps immune to device timezone.  
`toPHTIso(ms)` — converts UTC epoch ms to `+08:00` ISO string.  
`saveDisplayTime()` — called on app mount + foreground (via AppState listener in index.tsx).  
`getDisplayTime()` — returns last saved snapshot (or current PHT if no snapshot).

In `index.tsx`:
```ts
const pht = useMemo(() => new Date(now.getTime() + 8 * 3600 * 1000), [now])
// Use pht.getUTCHours(), pht.getUTCMinutes(), etc. — NOT getHours()
```
All time display and greeting logic uses `pht.getUTC*()` methods, not local device time.

## Teardown submit flow
1. Field staff → selects node → pole → span (select-pair.tsx)
2. GPS + photos captured (destination-pole.tsx, pole-detail.tsx)
3. Cable/components collected (components.tsx)
4. "Mark as Complete" → confirmation modal → `handleSubmit()`
5. Navigate to teardown-complete immediately (optimistic)
6. Background: `api.post("/teardown-logs", formData)` → `POST /api/v1/teardown-logs`
7. On success: clean up draft files + update cache
8. On failure: `queuePush()` → retried by sync-queue every 60s

### Confirmation modal placement (IMPORTANT)
The `confirmOpen` Modal MUST be placed INSIDE the `summaryOpen` Modal's JSX (not as a sibling).  
Reason: `summaryOpen` uses `animationType="slide"` which creates a native UI layer. A sibling Modal rendered outside it appears BEHIND the slide-up layer. Moving it inside ensures it renders above the summary.

## Pole Map (explore.tsx)
- Fetches globe poles from `GET /api/v1/globe/poles?per_page=500&page=N` (all pages)
- Cache key: `pole_map_pins_v1` (file cache)
- Shows on Leaflet WebView (react-native-webview)
- Filter pills: All / Pending / Active / Inactive / For Removal
- Status colors: active=#10b981, pending=#f59e0b, inactive=#6b7280, for_removal=#ef4444
- No markers for poles without lat/lng

## Weather caching
Last successful weather fetch is saved to AsyncStorage key `cached_weather`.  
On app start: loads cached weather instantly, then fetches fresh in background.  
On fetch failure: keeps cached data showing — never shows "Weather unavailable" if prior fetch succeeded.

## Home screen (index.tsx)
- Quick action cards: NAP Inventory + Sitemap Teardown — full-width stacked (same width as weather card)
- Time display: `HH:MM:SS` big digits (36px) + `AM/PM` badge at end of seconds row (10px)
- NAP Box Status section REMOVED (stat pills, mini fiber panel cards, NapBoxMiniCard component all removed)

## Important: spans loading requires auth
`select-pair.tsx` calls `api.get('/skycable/spans?node_id=X')` using `lib/api.ts`.  
This requires `token-bridge` to be populated. If spans show "could not load", check that the user's token was set via `setBridgeToken()` on login (auth-context.tsx).

## Offline sync
`lib/sync-queue.ts` — queues failed teardown submissions. Calls `api.post("/teardown-logs", form)` on retry. Processed every 60s and on app foreground via `net-sync`.
