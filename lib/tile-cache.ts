/**
 * Offline tile cache for ArcGIS satellite imagery.
 *
 * Downloads map tiles to the device filesystem so maps work offline.
 * Tiles are stored at:  <documentDirectory>/tilecache/<z>/<y>/<x>.jpg
 *
 * React Native Image components use file:// URIs directly.
 * Leaflet WebViews use the injected OfflineTileLayer JS that tries
 * the local file first and falls back to the network URL.
 */
import * as FileSystem from "expo-file-system/legacy";

export const ARCGIS_BASE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

const TILE_DIR = (FileSystem.documentDirectory ?? "") + "tilecache/";

// In-memory cache so we don't hammer the filesystem with getInfoAsync on
// every render — once confirmed present, treat as permanently cached.
const locallyAvailable = new Set<string>();

function key(z: number, y: number, x: number) {
  return `${z}/${y}/${x}`;
}
function localPath(z: number, y: number, x: number) {
  return `${TILE_DIR}${z}/${y}/${x}.jpg`;
}
export function networkUrl(z: number, y: number, x: number) {
  return `${ARCGIS_BASE}/${z}/${y}/${x}`;
}

/** Returns a file:// URI if the tile is on disk, else the HTTPS network URL. */
export async function getTileUri(z: number, y: number, x: number): Promise<string> {
  const k = key(z, y, x);
  if (locallyAvailable.has(k)) return localPath(z, y, x);
  try {
    const info = await FileSystem.getInfoAsync(localPath(z, y, x));
    if (info.exists) {
      locallyAvailable.add(k);
      return localPath(z, y, x);
    }
  } catch {}
  return networkUrl(z, y, x);
}

/** Downloads a tile to disk. Returns the local path (or network URL on failure). */
export async function ensureTile(z: number, y: number, x: number): Promise<string> {
  const k = key(z, y, x);
  if (locallyAvailable.has(k)) return localPath(z, y, x);
  const path = localPath(z, y, x);
  const dir = `${TILE_DIR}${z}/${y}/`;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) { locallyAvailable.add(k); return path; }
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const res = await FileSystem.downloadAsync(networkUrl(z, y, x), path);
    if (res.status === 200) { locallyAvailable.add(k); return path; }
  } catch {}
  return networkUrl(z, y, x);
}

// ── Tile coordinate helpers ───────────────────────────────────────────────────
function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
  );
}
function lngToX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

export type TileProgress = (done: number, total: number) => void;

/** Download all tiles inside a lat/lng bounding box for the given zoom levels. */
export async function downloadBounds(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  zooms: number[],
  onProgress?: TileProgress
): Promise<{ total: number; downloaded: number; skipped: number; failed: number }> {
  const tiles: [number, number, number][] = [];
  for (const z of zooms) {
    const x0 = lngToX(minLng, z), x1 = lngToX(maxLng, z);
    const y0 = latToY(maxLat, z), y1 = latToY(minLat, z);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        tiles.push([z, y, x]);
  }

  let done = 0, downloaded = 0, skipped = 0, failed = 0;
  const CHUNK = 8;

  for (let i = 0; i < tiles.length; i += CHUNK) {
    await Promise.all(
      tiles.slice(i, i + CHUNK).map(async ([z, y, x]) => {
        const k = key(z, y, x);
        if (locallyAvailable.has(k)) { skipped++; return; }
        const path = localPath(z, y, x);
        const dir = `${TILE_DIR}${z}/${y}/`;
        try {
          const info = await FileSystem.getInfoAsync(path);
          if (info.exists) { locallyAvailable.add(k); skipped++; return; }
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          const res = await FileSystem.downloadAsync(networkUrl(z, y, x), path);
          if (res.status === 200) { locallyAvailable.add(k); downloaded++; }
          else failed++;
        } catch { failed++; }
      })
    );
    done += Math.min(CHUNK, tiles.length - i);
    onProgress?.(done, tiles.length);
  }
  return { total: tiles.length, downloaded, skipped, failed };
}

/**
 * Pre-cache Philippines overview at zoom 6–10.
 * ~2 000 tiles ≈ 50 MB — run once during the profile "Download Data" sync.
 */
export async function cachePhilippines(onProgress?: TileProgress) {
  // Bounding box: Batanes (north) to Tawi-Tawi (south)
  return downloadBounds(4.5, 21.5, 116.0, 127.0, [6, 7, 8, 9, 10], onProgress);
}

/**
 * Pre-cache high-zoom tiles around a set of GPS locations (e.g., poles).
 * Pads the bounding box by ~2 km and caches zoom 11–15.
 */
export async function cacheLocations(
  locs: { lat: number; lng: number }[],
  zooms = [11, 12, 13, 14, 15],
  onProgress?: TileProgress
) {
  if (!locs.length) return;
  const pad = 0.018; // ~2 km
  const lats = locs.map(p => p.lat);
  const lngs = locs.map(p => p.lng);
  return downloadBounds(
    Math.min(...lats) - pad,
    Math.max(...lats) + pad,
    Math.min(...lngs) - pad,
    Math.max(...lngs) + pad,
    zooms,
    onProgress
  );
}

/**
 * The document-directory path injected into Leaflet WebViews.
 * Leaflet's custom OfflineTileLayer prefixes tile coordinates with this
 * to get a file:// URI; on miss it falls back to the ARCGIS HTTPS URL.
 */
export function getTileCacheDir(): string {
  return TILE_DIR;
}

/**
 * JavaScript snippet injected into every Leaflet WebView HTML.
 * Replace L.tileLayer(...) calls with  addOfflineTiles(map)  instead.
 */
export function offlineTileLayerJs(tileCacheDir: string): string {
  return `
(function(){
  var _DIR="${tileCacheDir.replace(/"/g, '\\"')}";
  var _NET="${ARCGIS_BASE}";
  var OTL=L.TileLayer.extend({
    createTile:function(c,done){
      var img=document.createElement('img');
      var local=_DIR+c.z+'/'+c.y+'/'+c.x+'.jpg';
      var remote=_NET+'/'+c.z+'/'+c.y+'/'+c.x;
      var tried=false;
      img.onload=function(){done(null,img);};
      img.onerror=function(){
        if(!tried){tried=true;img.src=remote;}
        else{done(null,img);}
      };
      img.src=local;
      return img;
    }
  });
  window.addOfflineTiles=function(map){
    new OTL('',{maxZoom:19,updateWhenIdle:false,keepBuffer:4}).addTo(map);
  };
})();
`;
}
