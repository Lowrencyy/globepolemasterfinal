/**
 * LiveMapTile — a live street map thumbnail using WebView + Leaflet + OpenStreetMap.
 * OSM tiles are highly reliable, Leaflet handles retries automatically.
 * Position updates via injectJavaScript — no reload needed.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";

type Props = {
  fallbackLat?: number | null;
  fallbackLng?: number | null;
  size?: number;
  borderRadius?: number;
};

function buildHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html><html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
html,body,#m{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#1a1a2e}
.leaflet-control-attribution,.leaflet-control-zoom{display:none!important}
.leaflet-tile-pane{filter:none}
</style>
</head>
<body>
<div id="m"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('m',{zoomControl:false,attributionControl:false,dragging:false,
  scrollWheelZoom:false,doubleClickZoom:false,touchZoom:false,keyboard:false})
  .setView([${lat},${lng}],17);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,subdomains:'abc',
  errorTileUrl:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}).addTo(map);
var dot=L.circleMarker([${lat},${lng}],{
  radius:8,color:'#ffffff',weight:2.5,
  fillColor:'#EF4444',fillOpacity:1
}).addTo(map);
window.updatePos=function(la,ln){
  map.setView([la,ln],17,{animate:true,duration:0.5});
  dot.setLatLng([la,ln]);
};
</script>
</body></html>`;
}

export function LiveMapTile({ fallbackLat, fallbackLng, size = 96, borderRadius = 10 }: Props) {
  const initLat = fallbackLat ?? 14.5995;
  const initLng = fallbackLng ?? 120.9842;

  const [html] = useState(() => buildHtml(initLat, initLng));
  const wvRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const pendingPos = useRef<{ lat: number; lng: number } | null>(null);

  // Watch live GPS position — inject updates into WebView
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      // Seed immediately
      const last = await Location.getLastKnownPositionAsync({ maxAge: 30_000 });
      if (last) {
        const { latitude: la, longitude: ln } = last.coords;
        if (ready) {
          wvRef.current?.injectJavaScript(`window.updatePos(${la},${ln});true;`);
        } else {
          pendingPos.current = { lat: la, lng: ln };
        }
      }

      // Then watch
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 3, timeInterval: 2000 },
        pos => {
          const { latitude: la, longitude: ln } = pos.coords;
          if (ready) {
            wvRef.current?.injectJavaScript(`window.updatePos(${la},${ln});true;`);
          } else {
            pendingPos.current = { lat: la, lng: ln };
          }
        },
      );
    })();

    return () => { sub?.remove(); };
  }, [ready]);

  function onLoad() {
    setReady(true);
    if (pendingPos.current) {
      const { lat, lng } = pendingPos.current;
      wvRef.current?.injectJavaScript(`window.updatePos(${lat},${lng});true;`);
      pendingPos.current = null;
    }
  }

  return (
    <View style={[s.wrap, { width: size, height: size, borderRadius }]}>
      <WebView
        ref={wvRef}
        source={{ html }}
        style={s.wv}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        allowFileAccess
        originWhitelist={["*"]}
        onLoad={onLoad}
        androidLayerType="hardware"
        textZoom={100}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#1a1a2e" },
  wv:   { flex: 1, backgroundColor: "transparent" },
});
