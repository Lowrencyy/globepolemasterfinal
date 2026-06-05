import api from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getDisplayTime, getPHTNow } from "@/lib/display-time";
import { queuePush, imageQueuePush, persistImage } from "@/lib/sync-queue";
import { tokenStore } from "@/lib/token";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { captureEvents } from "@/lib/capture-events";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  Stack,
  router,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const SCREEN_H = Dimensions.get("window").height;

type PhotoFile = { uri: string } | null;
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

export function buildSpanMapHtml(
  fromLat: number,
  fromLng: number,
  fromLabel: string,
  toLat: number,
  toLng: number,
  toLabel: string,
  accent: string,
  compact: boolean,
) {
  const midLat = (fromLat + toLat) / 2;
  const midLng = (fromLng + toLng) / 2;
  const zoom = compact ? 15 : 16;
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;background:#f0f4f8;}
.leaflet-div-icon{background:none!important;border:none!important;}
.pin{display:flex;flex-direction:column;align-items:center;}
.pin-dot{width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);}
.pin-label{margin-top:3px;background:rgba(15,23,42,0.82);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;white-space:nowrap;}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{zoomControl:${!compact},scrollWheelZoom:false,dragging:${!compact},doubleClickZoom:false,touchZoom:${!compact}}).setView([${midLat},${midLng}],${zoom});
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{subdomains:'abcd',maxZoom:20}).addTo(map);
var fromIcon=L.divIcon({className:'',html:'<div class="pin"><div class="pin-dot" style="background:${accent}"></div><div class="pin-label">${fromLabel}</div></div>',iconAnchor:[7,7]});
var toIcon=L.divIcon({className:'',html:'<div class="pin"><div class="pin-dot" style="background:#6366F1"></div><div class="pin-label">${toLabel}</div></div>',iconAnchor:[7,7]});
L.marker([${fromLat},${fromLng}],{icon:fromIcon}).addTo(map);
L.marker([${toLat},${toLng}],{icon:toIcon}).addTo(map);
L.polyline([[${fromLat},${fromLng}],[${toLat},${toLng}]],{color:'${accent}',weight:3,opacity:0.75,dashArray:'6,4'}).addTo(map);
var bounds=L.latLngBounds([[${fromLat},${fromLng}],[${toLat},${toLng}]]);
map.fitBounds(bounds,{padding:[${compact ? 36 : 52},${compact ? 36 : 52}],maxZoom:${compact ? 18 : 19}});
setTimeout(function(){map.invalidateSize();},120);
</script>
</body></html>`;
}

export function buildPoleMapHtml(lat: number, lng: number, accentColor: string, satellite = false, poleCode = "") {
  const tileUrl = satellite
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
    : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const tileOpts = satellite
    ? 'maxZoom:19,attribution:""'
    : 'subdomains:"abcd",maxZoom:20,attribution:""';
  const safeName = poleCode.replace(/'/g, "\\'").replace(/</g, "&lt;");
  const labelHtml = safeName
    ? `<div class="pole-label">${safeName}</div>`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body,#map{width:100%;height:100%;background:#0d1117;}
.leaflet-div-icon{background:none!important;border:none!important;}
.leaflet-control-attribution{display:none!important;}
.leaflet-control-zoom{display:none!important;}
.pin-wrap{display:flex;flex-direction:column;align-items:center;}
.pin-ring{
  width:36px;height:36px;border-radius:50%;
  background:${accentColor}22;
  border:2px solid ${accentColor}88;
  display:flex;align-items:center;justify-content:center;
  animation:ring-pulse 2s infinite;
}
.pin-dot{
  width:14px;height:14px;border-radius:50%;
  background:${accentColor};
  border:2.5px solid #fff;
  box-shadow:0 2px 8px rgba(0,0,0,0.5);
}
.pole-label{
  margin-top:5px;
  background:rgba(0,0,0,0.72);
  color:#fff;
  font-size:11px;
  font-weight:700;
  font-family:system-ui,-apple-system,sans-serif;
  padding:3px 8px;
  border-radius:6px;
  white-space:nowrap;
  letter-spacing:0.3px;
  border:1px solid rgba(255,255,255,0.15);
}
@keyframes ring-pulse{
  0%{box-shadow:0 0 0 0 ${accentColor}55;}
  70%{box-shadow:0 0 0 16px ${accentColor}00;}
  100%{box-shadow:0 0 0 0 ${accentColor}00;}
}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var map=L.map('map',{
  zoomControl:false,
  scrollWheelZoom:false,
  dragging:true,
  doubleClickZoom:true,
  touchZoom:true,
  attributionControl:false
}).setView([${lat},${lng}], 18);

L.tileLayer('${tileUrl}',{${tileOpts}}).addTo(map);

var icon=L.divIcon({
  className:'',
  html:'<div class="pin-wrap"><div class="pin-ring"><div class="pin-dot"></div></div>${labelHtml}</div>',
  iconSize:[120,${safeName ? 60 : 36}],
  iconAnchor:[60,18]
});

L.marker([${lat},${lng}],{icon:icon}).addTo(map);

setTimeout(function(){
  map.invalidateSize();
  map.setView([${lat},${lng}], 18);
}, 250);
</script>
</body>
</html>`;
}

const TILE_PX = 256;
const ZOOM = 18;
const TILE_OFFSETS = [-1, 0, 1] as const;

function latLngToTileFrac(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const xFrac = ((lng + 180) / 360) * n;
  const yFrac =
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { xFrac, yFrac, tileX: Math.floor(xFrac), tileY: Math.floor(yFrac) };
}

export function StaticTileMap({ lat, lng }: { lat: number; lng: number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const { xFrac, yFrac, tileX, tileY } = latLngToTileFrac(lat, lng, ZOOM);

  const fracX = xFrac - tileX;
  const fracY = yFrac - tileY;

  const onLayout = (e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) * 2.2 : 2.2;
  const imgW = TILE_PX * scale;
  const imgH = TILE_PX * scale;
  const offsetX = size ? size.w / 2 - fracX * imgW : 0;
  const offsetY = size ? size.h / 2 - fracY * imgH : 0;

  const PIN = 14;
  const pinLeft = size ? size.w / 2 - PIN / 2 : 0;
  const pinTop = size ? size.h / 2 - PIN / 2 : 0;

  return (
    <View style={{ ...StyleSheet.absoluteFillObject, overflow: "hidden", borderRadius: 18 }} onLayout={onLayout}>
      {TILE_OFFSETS.map(dy =>
        TILE_OFFSETS.map(dx => (
          <ExpoImage
            key={`${dx}:${dy}`}
            source={{
              uri: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${ZOOM}/${tileY + dy}/${tileX + dx}`,
            }}
            style={{
              position: "absolute",
              left: offsetX + dx * imgW,
              top: offsetY + dy * imgH,
              width: imgW,
              height: imgH,
            }}
            contentFit="cover"
          />
        )),
      )}
      {size && (
        <View
          style={{
            position: "absolute",
            left: pinLeft,
            top: pinTop,
            width: PIN,
            height: PIN,
            borderRadius: PIN / 2,
            backgroundColor: "#EF4444",
            borderWidth: 2,
            borderColor: "#FFF",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 3,
            elevation: 3,
          }}
        />
      )}
    </View>
  );
}


function sanitize(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_");
}

const STEPS = [
  { key: "cable", label: "Cable", icon: "🔌" },
  { key: "components", label: "Components", icon: "📦" },
] as const;

function TrackerMini({ done, label }: { done: boolean; label: string }) {
  return (
    <View style={styles.trackerMini}>
      <View style={[styles.trackerMiniDot, done && styles.trackerMiniDotDone]}>
        <Text
          style={[
            styles.trackerMiniDotText,
            done && styles.trackerMiniDotTextDone,
          ]}
        >
          {done ? "✓" : "•"}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={[styles.trackerMiniLabel, done && styles.trackerMiniLabelDone]}
      >
        {label}
      </Text>
    </View>
  );
}

function ProgressWaveBar({
  progress,
  accentColor,
}: {
  progress: number;
  accentColor: string;
}) {
  const waveAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(waveAnim, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [waveAnim]);

  const shimmerTranslate = waveAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-160, 260],
  });

  const bobTranslate = waveAnim.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -1.5, 0, 1.5, 0],
  });

  return (
    <View style={styles.progressBarTrack}>
      <View
        style={[
          styles.progressBarFill,
          { width: `${progress}%`, backgroundColor: accentColor },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.progressWave,
            {
              transform: [
                { translateX: shimmerTranslate },
                { translateY: bobTranslate },
                { rotate: "12deg" },
              ],
            },
          ]}
        />
      </View>
    </View>
  );
}

function SectionHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderTextWrap}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

function CounterCard({
  label,
  value,
  expected: _expected,
  onChange,
  accentColor,
}: {
  label: string;
  value: number;
  expected: number;
  onChange: (v: number) => void;
  accentColor: string;
}) {
  return (
    <View style={styles.counterCard}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterControls}>
        <Pressable
          onPress={() => onChange(Math.max(0, value - 1))}
          style={({ pressed }) => [
            styles.counterBtn,
            pressed && styles.pressedDown,
          ]}
        >
          <Text style={styles.counterBtnText}>−</Text>
        </Pressable>

        <Text style={styles.counterValue}>{value}</Text>

        <Pressable
          onPress={() => onChange(value + 1)}
          style={({ pressed }) => [
            styles.counterBtn,
            { backgroundColor: accentColor, borderColor: accentColor },
            pressed && styles.pressedDown,
          ]}
        >
          <Text style={[styles.counterBtnText, { color: "#FFFFFF" }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PhotoCircleItem({
  label,
  photo,
  required,
  preUploaded,
  onPress,
}: {
  label: string;
  photo: PhotoFile;
  required?: boolean;
  preUploaded?: boolean;
  onPress?: () => void;
}) {
  const done = !!photo || !!preUploaded;
  const scaleAnim = useRef(new Animated.Value(done ? 1 : 0.9)).current;
  const glowAnim = useRef(new Animated.Value(done ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: done ? 1 : 0.94,
        friction: 7,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: done ? 1 : 0,
        duration: 220,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [done, scaleAnim, glowAnim]);

  const ringScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });

  const ringOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.18],
  });

  return (
    <View style={styles.photoCircleItem}>
      <Animated.View
        style={[
          styles.photoCircleOuter,
          {
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        {done ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.photoCircleGlow,
              {
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />
        ) : null}

        <Pressable
          onPress={photo ? onPress : undefined}
          style={({ pressed }) => [
            styles.photoCircle,
            done && styles.photoCircleDone,
            pressed && photo && styles.pressedDown,
          ]}
        >
          {photo ? (
            <ExpoImage
              source={{ uri: photo.uri }}
              style={styles.photoCircleImage}
              contentFit="cover"
              transition={180}
            />
          ) : (
            <View style={styles.photoCircleEmpty}>
              <Text style={styles.photoCircleEmptyIcon}>📷</Text>
            </View>
          )}
        </Pressable>
      </Animated.View>

      <Text numberOfLines={1} style={styles.photoCircleLabel}>
        {label}
      </Text>

      <View style={styles.photoCircleCheckWrap}>
        <View
          style={[styles.photoCircleCheck, done && styles.photoCircleCheckDone]}
        >
          <Text
            style={[
              styles.photoCircleCheckText,
              done && styles.photoCircleCheckTextDone,
            ]}
          >
            {done ? "✓" : "•"}
          </Text>
        </View>
        <Text
          style={[
            styles.photoCircleCheckLabel,
            done && styles.photoCircleCheckLabelDone,
          ]}
        >
          {preUploaded ? "Saved" : done ? "Ready" : required ? "Req" : "Opt"}
        </Text>
      </View>
    </View>
  );
}

// Pure React Native span map — no WebView, works inside ScrollView on Android.
// Shows satellite tiles centered at the midpoint between two poles, with colored dots.
function StaticSpanMapView({
  fromLat, fromLng, toLat, toLng, accentColor,
}: {
  fromLat: number; fromLng: number; toLat: number; toLng: number; accentColor: string;
}) {
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);

  const midLat = (fromLat + toLat) / 2;
  const midLng = (fromLng + toLng) / 2;

  const maxDiff = Math.max(Math.abs(toLat - fromLat), Math.abs(toLng - fromLng));
  const zoom = maxDiff < 0.001 ? 17 : maxDiff < 0.005 ? 16 : maxDiff < 0.02 ? 15 : 14;

  const { xFrac: midXFrac, yFrac: midYFrac, tileX, tileY } = latLngToTileFrac(midLat, midLng, zoom);
  const { xFrac: fromXFrac, yFrac: fromYFrac } = latLngToTileFrac(fromLat, fromLng, zoom);
  const { xFrac: toXFrac,   yFrac: toYFrac   } = latLngToTileFrac(toLat,   toLng,   zoom);

  const scale = size ? Math.max(size.w / TILE_PX, size.h / TILE_PX) * 1.6 : 1.6;
  const imgW  = TILE_PX * scale;
  const imgH  = TILE_PX * scale;
  const PIN   = 13;

  const px = (xFrac: number, yFrac: number) => ({
    left: (size?.w ?? 0) / 2 + (xFrac - midXFrac) * imgW - PIN / 2,
    top:  (size?.h ?? 0) / 2 + (yFrac - midYFrac) * imgH - PIN / 2,
  });

  return (
    <View
      style={{ flex: 1, overflow: "hidden" }}
      onLayout={e => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size && TILE_OFFSETS.map(dy =>
        TILE_OFFSETS.map(dx => (
          <ExpoImage
            key={`${dx}:${dy}`}
            source={{ uri: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${tileY + dy}/${tileX + dx}` }}
            style={{
              position: "absolute",
              left: size.w / 2 - (midXFrac - tileX) * imgW + dx * imgW,
              top:  size.h / 2 - (midYFrac - tileY) * imgH + dy * imgH,
              width: imgW, height: imgH,
            }}
            contentFit="cover"
          />
        ))
      )}
      {size && (() => {
        const f = px(fromXFrac, fromYFrac);
        const t = px(toXFrac, toYFrac);
        return (
          <>
            <View style={{ position: "absolute", left: f.left, top: f.top, width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: accentColor, borderWidth: 2, borderColor: "#FFF", elevation: 3 }} />
            <View style={{ position: "absolute", left: t.left, top: t.top, width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: "#6366F1", borderWidth: 2, borderColor: "#FFF", elevation: 3 }} />
          </>
        );
      })()}
    </View>
  );
}

// ── Shared stamp HTML (used for bunching photo metadata overlay) ────────────
export const STAMP_HTML = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000"><canvas id="c"></canvas><script>
function rr(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function drawStamp(ctx,img,lines,mapB64,mapDotX,mapDotY,mapTiles){
  var W=img.width,H=img.height;
  var gap=Math.round(W*0.012);
  var fSize=Math.min(Math.max(14,Math.round(W*0.020)),Math.floor((H*0.22)/(lines.length*1.55+1.5)));
  var lh=Math.round(fSize*1.55);
  var vPad=Math.round(fSize*0.9);
  var hPad=Math.round(fSize*0.75);
  var panelH=lines.length*lh+vPad*2;
  var r=Math.round(panelH*0.14);
  var mapSize=(mapB64||(mapTiles&&mapTiles.length))?panelH:0;
  var textW=W-gap*2-mapSize-(mapSize?gap:0);
  var panelY=H-panelH-gap;
  var mapY=panelY;
  var fadeH=panelH+gap*4;
  var grad=ctx.createLinearGradient(0,H-fadeH,0,H);
  grad.addColorStop(0,'rgba(0,0,0,0)');grad.addColorStop(1,'rgba(0,0,0,0.38)');
  ctx.fillStyle=grad;ctx.fillRect(0,H-fadeH,W,fadeH);
  function drawTextPanel(){
    ctx.save();rr(ctx,gap,panelY,textW,panelH,r);
    ctx.fillStyle='rgba(0,0,0,0.52)';ctx.fill();ctx.restore();
    ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=3;
    var startY=panelY+(panelH-lines.length*lh)/2;
    lines.forEach(function(line,i){
      var y=startY+(i+0.78)*lh;
      var maxW=textW-hPad*2;
      if(i===0){ctx.font='bold '+Math.round(fSize*1.05)+'px Arial,sans-serif';ctx.fillStyle='#FFFFFF';}
      else if(i===lines.length-1){ctx.font=Math.round(fSize*0.84)+'px Arial,sans-serif';ctx.fillStyle='rgba(255,255,255,0.72)';}
      else{ctx.font='bold '+fSize+'px Arial,sans-serif';ctx.fillStyle='#FFFFFF';}
      var txt=line;while(ctx.measureText(txt).width>maxW&&txt.length>4)txt=txt.slice(0,-2);
      if(txt!==line)txt=txt.slice(0,-1)+'…';
      ctx.fillText(txt,gap+hPad,y);
    });
    ctx.shadowBlur=0;
  }
  function drawMapPanel(mapImgs){
    var mx=gap+textW+gap,my=mapY;
    ctx.save();rr(ctx,mx,my,mapSize,mapSize,r);ctx.clip();
    var dotFX=(mapDotX!=null&&!isNaN(mapDotX))?mapDotX:0.5;
    var dotFY=(mapDotY!=null&&!isNaN(mapDotY))?mapDotY:0.5;
    if(Array.isArray(mapImgs)){
      mapImgs.forEach(function(t){
        if(!t||!t.img)return;
        var dx=Number(t.dx)||0,dy=Number(t.dy)||0;
        ctx.drawImage(t.img,mx+(dx+0.5-dotFX)*mapSize,my+(dy+0.5-dotFY)*mapSize,mapSize,mapSize);
      });
    }else if(mapImgs){
      ctx.drawImage(mapImgs,mx+(0.5-dotFX)*mapSize,my+(0.5-dotFY)*mapSize,mapSize,mapSize);
    }
    ctx.fillStyle='rgba(0,0,0,0.15)';ctx.fillRect(mx,my,mapSize,mapSize);
    var dotR=Math.round(mapSize*0.07);
    var dX=mx+mapSize/2,dY=my+mapSize/2;
    ctx.beginPath();ctx.arc(dX,dY,dotR,0,2*Math.PI);
    ctx.fillStyle='#EF4444';ctx.fill();
    ctx.strokeStyle='#FFFFFF';ctx.lineWidth=Math.max(2,Math.round(dotR*0.35));ctx.stroke();
    ctx.restore();
  }
  function finish(){
    var b64=document.getElementById('c').toDataURL('image/jpeg',0.93).split(',')[1];
    window.ReactNativeWebView.postMessage(JSON.stringify({stamped:b64}));
  }
  function loadMapImages(cb){
    var tilePayload=Array.isArray(mapTiles)?mapTiles.filter(function(t){return t&&t.b64;}):[];
    if(tilePayload.length){
      var loaded=[],pending=tilePayload.length;
      tilePayload.forEach(function(t){
        var im=new Image();
        im.onload=function(){loaded.push({img:im,dx:Number(t.dx)||0,dy:Number(t.dy)||0});if(--pending===0)cb(loaded.length?loaded:null);};
        im.onerror=function(){if(--pending===0)cb(loaded.length?loaded:null);};
        im.src='data:image/png;base64,'+t.b64;
      });
      return;
    }
    if(mapB64){var mapImg=new Image();mapImg.onload=function(){cb(mapImg);};mapImg.onerror=function(){cb(null);};mapImg.src='data:image/png;base64,'+mapB64;return;}
    cb(null);
  }
  if(mapSize>0&&(mapB64||(mapTiles&&mapTiles.length))){loadMapImages(function(mapImgs){drawTextPanel();if(mapImgs)drawMapPanel(mapImgs);finish();});}else{drawTextPanel();finish();}
}
function stamp(payload){
  var data;try{data=JSON.parse(payload);}catch(ex){window.ReactNativeWebView.postMessage(JSON.stringify({error:'parse'}));return;}
  var img=new Image();
  img.onload=function(){
    var c=document.getElementById('c');c.width=img.width;c.height=img.height;
    var ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    drawStamp(ctx,img,data.lines,data.mapB64||null,data.mapDotX!=null?data.mapDotX:0.5,data.mapDotY!=null?data.mapDotY:0.5,data.mapTiles||null);
  };
  img.onerror=function(){window.ReactNativeWebView.postMessage(JSON.stringify({error:'load'}));};
  img.src='data:image/jpeg;base64,'+data.b64;
}
document.addEventListener('message',function(e){stamp(e.data);});
window.addEventListener('message',function(e){stamp(e.data);});
window.ReactNativeWebView.postMessage(JSON.stringify({ready:1}));
<\/script></body></html>`;

type StampMapTile = { b64: string; dx: number; dy: number };
type StampMapResult = { b64: string; tiles: StampMapTile[]; dotX: number; dotY: number };
const _STAMP_OFFSETS = [-1, 0, 1] as const;
const _CARTO_SUBS = ["a", "b", "c", "d"] as const;

function _bunchingTileInfo(lat: number, lng: number, zoom = 18) {
  const n = Math.pow(2, zoom);
  const xFrac = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFrac = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tileX = Math.floor(xFrac);
  const tileY = Math.floor(yFrac);
  return { tileX, tileY, zoom, dotX: xFrac - tileX, dotY: yFrac - tileY };
}

async function _fetchBunchingMapTileB64(lat: number, lng: number): Promise<StampMapResult | null> {
  try {
    const { tileX, tileY, zoom, dotX, dotY } = _bunchingTileInfo(lat, lng, 18);
    // Fetch only the center tile (fast single download instead of 3×3 grid)
    const startIdx = Math.abs(tileX + tileY) % _CARTO_SUBS.length;
    const candidates = [
      ...[..._CARTO_SUBS].slice(startIdx), ...[..._CARTO_SUBS].slice(0, startIdx),
    ].map(s => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tileX}/${tileY}.png`);
    candidates.push(`https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`);
    for (const url of candidates) {
      const tmp = `${FileSystem.cacheDirectory}bstamp_${Date.now()}_center.png`;
      try {
        const dl = await FileSystem.downloadAsync(url, tmp);
        const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: "base64" as any });
        FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
        const center: StampMapTile = { b64, dx: 0, dy: 0 };
        return { b64: center.b64, tiles: [center], dotX, dotY };
      } catch { FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {}); }
    }
    return null;
  } catch { return null; }
}

export default function TeardownComponentsScreen() {
  const params = useLocalSearchParams<{
    pole_code: string;
    pole_name: string;
    node_id: string;
    node_name?: string;
    project_id: string;
    project_name: string;
    accent: string;
    span_id: string;
    span_code: string;
    to_pole_id: string;
    to_pole_code: string;
    to_pole_name: string;
    expected_cable: string;
    length_meters: string;
    declared_runs: string;
    expected_node: string;
    expected_amplifier: string;
    expected_extender: string;
    expected_tsc: string;
    expected_powersupply: string;
    expected_powersupply_housing: string;
    to_pole_latitude: string;
    to_pole_longitude: string;
    to_pole_gps_captured_at: string;
    to_pole_gps_accuracy: string;
    destination_slot: string;
    destination_landmark: string;
    from_pole_id: string;
    from_pole_latitude: string;
    from_pole_longitude: string;
    from_pole_gps_captured_at: string;
    teardown_started_at?: string;
  }>();

  const accentColor = params.accent || "#0B7A5A";
  const projFolder = sanitize(params.project_name);
  const fromCode = sanitize(params.pole_code);
  const toCode = sanitize(params.to_pole_code);
  const draftDir = `${FileSystem.documentDirectory}teardown_drafts/${projFolder}/${params.node_id}/${params.from_pole_id}/`;
  const poleDraftDir = `${FileSystem.documentDirectory}pole_drafts/${projFolder}/${params.node_id}/${params.from_pole_id}/`;
  const expectedCable = Number(params.expected_cable) || 0;
  const declaredRuns = Number(params.declared_runs) || 0;
  const lengthMeters = Number(params.length_meters) || 0;

  // Use the start time passed from destination-pole (when lineman entered that screen)
  // Fall back to now only if not passed (shouldn't happen in normal flow)
  const startedAt = useRef(params.teardown_started_at ?? new Date().toISOString());
  const gpsRef = useRef<{
    lat: number;
    lng: number;
    acc: number | null;
    capturedAt: string;
  } | null>(null);
  const photoTimestamps = useRef<Record<string, string>>({});
  const scrollRef = useRef<ScrollView>(null);
  const timerStartRef = useRef(Date.now());

  const [step, setStep] = useState(0);

  const [photos, setPhotos] = useState<Record<string, PhotoFile>>({
    from_before: null,
    from_after: null,
    from_tag: null,
    to_before: null,
    to_after: null,
    to_tag: null,
  });

  const [collectedAll, setCollectedAll] = useState<boolean | null>(null);
  const [recoveredCable, setRecoveredCable] = useState("");
  const [actualRuns, setActualRuns] = useState(declaredRuns || 1);
  const [cableReason, setCableReason] = useState("");
  const [cablePhoto, setCablePhoto] = useState<PhotoFile>(null);

  // ── Bunching photo capture + GPS + stamp ──────────────────────────────────
  const [bunchingCapturing, setBunchingCapturing] = useState(false);
  const [bunchingGps, setBunchingGps] = useState<{ lat: number; lng: number; capturedAt: string } | null>(null);
  const [bunchingStreet, setBunchingStreet] = useState("");
  const [bunchingCity, setBunchingCity] = useState("");
  const [bunchingRegion, setBunchingRegion] = useState("");
  const [bunchingPreviewOpen, setBunchingPreviewOpen] = useState(false);
  // Refs so the captureEvents listener always reads fresh values (avoids stale closure)
  const bunchingGpsRef = useRef<{ lat: number; lng: number; capturedAt: string } | null>(null);
  const bunchingStreetRef = useRef("");
  const bunchingCityRef = useRef("");
  const bunchingRegionRef = useRef("");
  const bunchingStampRef = useRef<WebView>(null);
  const bunchingStampResolverRef = useRef<((b64: string | null) => void) | null>(null);
  const bunchingMapCache = useRef<StampMapResult | null>(null);

  const [collectedNode, setCollectedNode] = useState(0);
  const [collectedAmp, setCollectedAmp] = useState(0);
  const [collectedExt, setCollectedExt] = useState(0);
  const [collectedTsc, setCollectedTsc] = useState(0);
  const [collectedPs, setCollectedPs] = useState(0);
  const [collectedPsh, setCollectedPsh] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [polePreSubmitted, setPolePreSubmitted] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [vicinityOpen, setVicinityOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fromLat = Number(params.from_pole_latitude) || null;
  const fromLng = Number(params.from_pole_longitude) || null;
  const toLat = Number(params.to_pole_latitude) || null;
  const toLng = Number(params.to_pole_longitude) || null;

  // Display coords — start from params, fill from GPS cache when params are empty
  const [mapFromLat, setMapFromLat] = useState<number | null>(fromLat);
  const [mapFromLng, setMapFromLng] = useState<number | null>(fromLng);
  const [mapToLat,   setMapToLat]   = useState<number | null>(toLat);
  const [mapToLng,   setMapToLng]   = useState<number | null>(toLng);

  useEffect(() => {
    (async () => {
      const loadCoords = async (
        poleId: string,
        setLat: (v: number) => void,
        setLng: (v: number) => void,
      ) => {
        const g = await cacheGet<{ lat: number | string; lng: number | string }>(`pole_gps_${poleId}`).catch(() => null);
        if (g?.lat && g?.lng) { setLat(Number(g.lat)); setLng(Number(g.lng)); return; }
        if (params.node_id) {
          const poles = await cacheGet<any[]>(`sitemap_poles_${params.node_id}`).catch(() => null);
          const match = poles?.find(p => String(p.pole_id) === String(poleId));
          if (match?.pole?.lat && match?.pole?.lng) {
            setLat(parseFloat(match.pole.lat));
            setLng(parseFloat(match.pole.lng));
          }
        }
      };
      if (!fromLat || !fromLng) await loadCoords(params.from_pole_id, setMapFromLat, setMapFromLng);
      if (!toLat   || !toLng  ) await loadCoords(params.to_pole_id,   setMapToLat,   setMapToLng);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasSpanCoords = !!(mapFromLat && mapFromLng && mapToLat && mapToLng);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLabel, setViewerLabel] = useState("");
  const [viewerPhoto, setViewerPhoto] = useState<PhotoFile>(null);

  const recoveredNum = parseFloat(recoveredCable) || 0;
  const adjExpected =
    declaredRuns > 0 && lengthMeters > 0
      ? lengthMeters * actualRuns
      : expectedCable;
  const unrecovered = Math.max(0, adjExpected - recoveredNum);

  const reviewFloatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(reviewFloatAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(reviewFloatAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [reviewFloatAnim]);

  const photoReviewAnimatedStyle = {
    transform: [
      {
        translateY: reviewFloatAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -2],
        }),
      },
    ],
  };

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - timerStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const loadPhotos = useCallback(async () => {
    const fromPoleFiles: Record<string, { dir: string; file: string }> = {
      from_before: {
        dir: poleDraftDir,
        file: `pole_${params.from_pole_id}_before.jpg`,
      },
      from_after: {
        dir: poleDraftDir,
        file: `pole_${params.from_pole_id}_after.jpg`,
      },
      from_tag: {
        dir: poleDraftDir,
        file: `pole_${params.from_pole_id}_poletag.jpg`,
      },
    };

    const toFiles: Record<string, { dir: string; file: string }> = {
      to_before: { dir: draftDir, file: `${toCode}_before.jpg` },
      to_after: { dir: draftDir, file: `${toCode}_after.jpg` },
      to_tag: { dir: draftDir, file: `${toCode}_poletag.jpg` },
    };

    const allFiles = { ...fromPoleFiles, ...toFiles };
    const result: Record<string, PhotoFile> = {};

    // Helper: load a file, preferring the stamped _view.jpg over the clean version.
    // Uses canonical URIs from getInfoAsync (not constructed strings) to avoid path issues.
    const loadFile = async (path: string, tsKey: string, fileName: string): Promise<PhotoFile> => {
      const info = await FileSystem.getInfoAsync(path).catch(() => null);
      if (!(info as any)?.exists) return null;
      const viewPath = path.replace(/\.jpg$/i, "_view.jpg");
      const viewInfo = await FileSystem.getInfoAsync(viewPath).catch(() => null);
      // Only use _view.jpg if it exists AND has content (size > 0)
      const viewValid = (viewInfo as any)?.exists && ((viewInfo as any).size ?? 0) > 0;
      const uri = viewValid ? (viewInfo as any).uri : (info as any).uri;
      if ("modificationTime" in (info as any) && (info as any).modificationTime) {
        photoTimestamps.current[tsKey] = new Date((info as any).modificationTime * 1000).toISOString();
      }
      return { uri, name: fileName, type: "image/jpeg" } as any;
    };

    await Promise.all(
      Object.entries(allFiles).map(async ([key, { dir, file }]) => {
        const loaded = await loadFile(dir + file, key, file);
        if (loaded) {
          result[key] = loaded;
        } else if (key === "to_tag") {
          // Fallback: destination-pole cross-copies the to-pole tag to pole_drafts.
          // Try that path if the teardown_drafts version is missing.
          const poleDir = `${FileSystem.documentDirectory}pole_drafts/${sanitize(params.project_name)}/${params.node_id}/${params.to_pole_id}/`;
          result[key] = await loadFile(poleDir + `pole_${params.to_pole_id}_poletag.jpg`, key, file);
        } else {
          result[key] = null;
        }
      }),
    );
    setPhotos(result);

    // Override file-modification timestamps with cached capture timestamps (actual field time).
    // Prevents falsifying when a photo was taken by using the server-receive time instead.
    const cachedTs = await Promise.all([
      cacheGet<string>(`photo_captured_at_${params.from_pole_id}_before`),
      cacheGet<string>(`photo_captured_at_${params.from_pole_id}_after`),
      cacheGet<string>(`photo_captured_at_${params.from_pole_id}_tag`),
      cacheGet<string>(`photo_captured_at_${params.to_pole_id}_before`),
      cacheGet<string>(`photo_captured_at_${params.to_pole_id}_after`),
      cacheGet<string>(`photo_captured_at_${params.to_pole_id}_tag`),
    ]);
    const tsKeys = ["from_before", "from_after", "from_tag", "to_before", "to_after", "to_tag"] as const;
    cachedTs.forEach((ts, i) => { if (ts) photoTimestamps.current[tsKeys[i]] = ts; });

    const cablePath = draftDir + `${fromCode}_cable.jpg`;
    const cableInfo = await FileSystem.getInfoAsync(cablePath);
    if (cableInfo.exists) {
      setCablePhoto({
        uri: cableInfo.uri,
        name: `${fromCode}_cable.jpg`,
        type: "image/jpeg",
      } as any);
      if ("modificationTime" in cableInfo && cableInfo.modificationTime) {
        photoTimestamps.current.before_span = new Date(
          cableInfo.modificationTime * 1000,
        ).toISOString();
      }
    }
  }, [draftDir, fromCode, params.from_pole_id, params.to_pole_id, poleDraftDir, toCode]);

  useFocusEffect(
    useCallback(() => {
      loadPhotos();
    }, [loadPhotos]),
  );

  useEffect(() => {
    captureGps();
    if (params.from_pole_id) {
      cacheGet<boolean>(`pole_submitted_${params.from_pole_id}`)
        .then((v) => setPolePreSubmitted(!!v))
        .catch(() => {});
    }
  }, [params.from_pole_id]);

  const formDraftPath = draftDir + "form_state.json";

  // Load persisted form state on mount
  useEffect(() => {
    FileSystem.readAsStringAsync(formDraftPath)
      .then((raw) => {
        const saved = JSON.parse(raw);
        if (saved.collectedAll !== undefined)
          setCollectedAll(saved.collectedAll);
        if (saved.recoveredCable !== undefined)
          setRecoveredCable(saved.recoveredCable);
        if (saved.cableReason !== undefined) setCableReason(saved.cableReason);
        if (saved.actualRuns !== undefined) setActualRuns(saved.actualRuns);
        if (saved.collectedNode !== undefined)
          setCollectedNode(saved.collectedNode);
        if (saved.collectedAmp !== undefined)
          setCollectedAmp(saved.collectedAmp);
        if (saved.collectedExt !== undefined)
          setCollectedExt(saved.collectedExt);
        if (saved.collectedTsc !== undefined)
          setCollectedTsc(saved.collectedTsc);
        if (saved.collectedPs !== undefined) setCollectedPs(saved.collectedPs);
        if (saved.collectedPsh !== undefined)
          setCollectedPsh(saved.collectedPsh);
        if (saved.step !== undefined) setStep(saved.step);
      })
      .catch(() => {});
  }, [formDraftPath]);

  // Save form state whenever it changes
  useEffect(() => {
    const state = {
      collectedAll,
      recoveredCable,
      cableReason,
      actualRuns,
      collectedNode,
      collectedAmp,
      collectedExt,
      collectedTsc,
      collectedPs,
      collectedPsh,
      step,
    };
    FileSystem.makeDirectoryAsync(draftDir, { intermediates: true })
      .then(() =>
        FileSystem.writeAsStringAsync(formDraftPath, JSON.stringify(state)),
      )
      .catch(() => {});
  }, [
    collectedAll,
    recoveredCable,
    cableReason,
    actualRuns,
    collectedNode,
    collectedAmp,
    collectedExt,
    collectedTsc,
    collectedPs,
    collectedPsh,
    step,
    draftDir,
    formDraftPath,
  ]);

  async function captureGps() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;

      const last = await Location.getLastKnownPositionAsync({
        maxAge: 30000,
      }).catch(() => null);

      if (last && last.coords.accuracy != null && last.coords.accuracy <= 50) {
        gpsRef.current = {
          lat: last.coords.latitude,
          lng: last.coords.longitude,
          acc: last.coords.accuracy,
          capturedAt: new Date(last.timestamp).toISOString(),
        };
        return;
      }

      const loc = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        }),
        new Promise<null>((res) => setTimeout(() => res(null), 60000)),
      ]);

      if (loc) {
        gpsRef.current = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          acc: loc.coords.accuracy,
          capturedAt: new Date(loc.timestamp).toISOString(),
        };
      }
    } catch {}
  }

  function handleBunchingStampMessage(event: { nativeEvent: { data: string } }) {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.ready || !bunchingStampResolverRef.current) return;
      bunchingStampResolverRef.current(data.stamped ?? null);
      bunchingStampResolverRef.current = null;
    } catch {}
  }

  function buildBunchingStampLines(lat: number, lng: number, street: string, city: string, region: string): string[] {
    const phtIso = getPHTNow();
    const [datePart, timeRaw] = phtIso.substring(0, 19).split("T");
    const [yr, mo, dy] = datePart.split("-").map(Number);
    const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const lines: string[] = [`${MON[mo - 1]} ${dy}, ${yr}  ${timeRaw}`];
    if (street) lines.push(street);
    const cityProv = [city, region].filter(Boolean).join(", ");
    if (cityProv) lines.push(cityProv);
    const fromCode_ = params.pole_code ?? params.from_pole_id ?? "";
    const toCode_ = params.to_pole_code ?? params.to_pole_id ?? "";
    lines.push(`${fromCode_} → ${toCode_}  (BUNCHING)`);
    const nodeLabel = params.node_name || "";
    if (nodeLabel) lines.push(`node name: ${nodeLabel}`);
    return lines;
  }

  async function stampBunchingPhoto(uri: string, lines: string[], lat: number, lng: number): Promise<string> {
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" as any });
      const mapResult = bunchingMapCache.current
        ?? await _fetchBunchingMapTileB64(lat, lng).catch(() => null);
      if (mapResult) bunchingMapCache.current = mapResult;
      const payload = JSON.stringify({
        b64, lines,
        mapB64: mapResult?.b64 ?? null,
        mapTiles: mapResult?.tiles ?? null,
        mapDotX: mapResult?.dotX ?? 0.5,
        mapDotY: mapResult?.dotY ?? 0.5,
      });
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => { bunchingStampResolverRef.current = null; resolve(uri); }, 15000);
        bunchingStampResolverRef.current = (result: string | null) => {
          clearTimeout(timer);
          if (!result) { resolve(uri); return; }
          const tmp = `${FileSystem.cacheDirectory}bstamp_out_${Date.now()}.jpg`;
          FileSystem.writeAsStringAsync(tmp, result, { encoding: "base64" as any })
            .then(() => resolve(tmp))
            .catch(() => resolve(uri));
        };
        bunchingStampRef.current?.injectJavaScript(
          `(function(){document.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(payload)}}));})();true;`
        );
      });
    } catch { return uri; }
  }

  // Keep refs in sync so the captureEvents listener always has fresh GPS/address
  useEffect(() => { bunchingGpsRef.current = bunchingGps; }, [bunchingGps]);
  useEffect(() => { bunchingStreetRef.current = bunchingStreet; }, [bunchingStreet]);
  useEffect(() => { bunchingCityRef.current = bunchingCity; }, [bunchingCity]);
  useEffect(() => { bunchingRegionRef.current = bunchingRegion; }, [bunchingRegion]);

  // Listen for photo from capture.tsx
  useEffect(() => {
    const spanId = params.span_id ?? "";
    return captureEvents.on(async (result) => {
      if (result.ownerType !== "bunching" || result.ownerPoleId !== spanId) return;
      setBunchingCapturing(true);
      try {
        // Wait for capture.tsx navigation-back animation to complete
        await new Promise(r => setTimeout(r, 350));

        const gps = bunchingGpsRef.current;

        // Compress
        const manip = ImageManipulator.manipulate(result.uri);
        manip.resize({ width: 1280 });
        const imgCtx = await manip.renderAsync();
        const compressed = await imgCtx.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });

        await FileSystem.makeDirectoryAsync(draftDir, { intermediates: true });
        const dest = draftDir + `${fromCode}_bunching.jpg`;

        if (gps && !bunchingMapCache.current) {
          bunchingMapCache.current = await _fetchBunchingMapTileB64(gps.lat, gps.lng).catch(() => null);
        }

        let displayUri = compressed.uri;
        if (gps) {
          const lines = buildBunchingStampLines(
            gps.lat, gps.lng,
            bunchingStreetRef.current, bunchingCityRef.current, bunchingRegionRef.current,
          );
          const stamped = await stampBunchingPhoto(compressed.uri, lines, gps.lat, gps.lng);
          await FileSystem.copyAsync({ from: stamped, to: dest }).catch(() => {});
          displayUri = stamped;
        } else {
          await FileSystem.copyAsync({ from: compressed.uri, to: dest }).catch(() => {});
          displayUri = dest;
        }

        photoTimestamps.current.before_span = gps?.capturedAt ?? await getDisplayTime();
        setCablePhoto({ uri: displayUri } as PhotoFile);
        setBunchingPreviewOpen(true);
      } catch (e: any) {
        Alert.alert("Capture Failed", e?.message ?? "Could not take photo.");
      } finally {
        setBunchingCapturing(false);
      }
    });
  }, [params.span_id]);

  async function openBunchingCamera() {
    bunchingMapCache.current = null;

    // Capture GPS before navigating so the overlay in capture.tsx shows it
    const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    let gps: { lat: number; lng: number; capturedAt: string } | null = null;
    if (locStatus === "granted") {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
      if (pos) {
        gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, capturedAt: getPHTNow() };
        setBunchingGps(gps);
        bunchingGpsRef.current = gps;
        Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
          .then(addrs => {
            const a = addrs[0];
            if (a) {
              const street = String(a.street ?? a.name ?? "").trim();
              const city   = String(a.city ?? a.district ?? a.subregion ?? "").trim();
              const region = String(a.region ?? "").trim();
              setBunchingStreet(street); bunchingStreetRef.current = street;
              setBunchingCity(city);     bunchingCityRef.current   = city;
              setBunchingRegion(region); bunchingRegionRef.current = region;
            }
          })
          .catch(() => {});
      }
    }

    router.push({
      pathname: "/capture" as any,
      params: {
        label: "BUNCHING",
        poleCode: `${params.pole_code ?? ""} → ${params.to_pole_code ?? ""}`,
        nodeName: params.node_name ?? "",
        lat: gps ? String(gps.lat) : "",
        lng: gps ? String(gps.lng) : "",
        ownerType: "bunching",
        ownerPoleId: params.span_id ?? "",
        returnKey: `bunching_${params.span_id ?? ""}`,
        tab: "before",
      },
    });
  }

  function retakeBunchingPhoto() {
    setCablePhoto(null);
    setBunchingGps(null); bunchingGpsRef.current = null;
    setBunchingStreet(""); bunchingStreetRef.current = "";
    setBunchingCity("");   bunchingCityRef.current = "";
    setBunchingRegion(""); bunchingRegionRef.current = "";
    bunchingMapCache.current = null;
    openBunchingCamera();
  }

  const canProceed = useCallback(() => {
    if (step === 0) {
      return collectedAll !== null && recoveredCable.trim() !== "" && !!cablePhoto;
    }

    const fromPhotosOk = polePreSubmitted || (!!photos.from_before && !!photos.from_tag);
    return (
      fromPhotosOk &&
      !!photos.to_before &&
      !!photos.to_after &&
      !!photos.to_tag &&
      collectedAll !== null
    );
  }, [step, collectedAll, recoveredCable, cablePhoto, polePreSubmitted, photos]);

  function goNext() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    } else {
      handleSubmit();
    }
  }

  function openViewer(label: string, photo: PhotoFile) {
    if (!photo) return;
    setViewerLabel(label);
    setViewerPhoto(photo);
    setViewerOpen(true);
  }

  async function buildFields(): Promise<Record<string, string>> {
    // 1. Single source of truth for time: prioritize device photo metadata capture times in PHT
    const photoTsList = Object.values(photoTimestamps.current).filter(Boolean).sort();
    const phtNow = getPHTNow();
    const actualStartedAt = photoTsList.length > 0 ? photoTsList[0] : startedAt.current || phtNow;
    const actualFinishedAt = photoTsList.length > 0 ? photoTsList[photoTsList.length - 1] : phtNow;

    const user = await tokenStore.getUser();

    // 2. Extract true device-originated EXIF coordinates captured at origin
    const fromGpsCache = params.from_pole_id ? await cacheGet<{ lat: number | string; lng: number | string }>(`pole_gps_${params.from_pole_id}`).catch(() => null) : null;
    const toGpsCache = params.to_pole_id ? await cacheGet<{ lat: number | string; lng: number | string }>(`pole_gps_${params.to_pole_id}`).catch(() => null) : null;

    const didCollectComponents =
      collectedNode > 0 ||
      collectedAmp > 0 ||
      collectedExt > 0 ||
      collectedTsc > 0 ||
      collectedPs > 0 ||
      collectedPsh > 0
        ? "1"
        : "0";

    const fields: Record<string, string> = {
      did_collect_all_cable: collectedAll ? "1" : "0",
      collected_cable: String(recoveredNum),
      declared_runs: String(declaredRuns),
      actual_runs: String(actualRuns),
      did_collect_components: didCollectComponents,
      nodes_collected: String(collectedNode),
      amplifiers_collected: String(collectedAmp),
      extenders_collected: String(collectedExt),
      tsc_collected: String(collectedTsc),
      powersupply_collected: String(collectedPs),
      ps_housing_collected: String(collectedPsh),
      expected_cable: String(expectedCable),
      expected_node: params.expected_node || "0",
      expected_amplifier: params.expected_amplifier || "0",
      expected_extender: params.expected_extender || "0",
      expected_tsc: params.expected_tsc || "0",
      started_at: actualStartedAt,
      finished_at: actualFinishedAt,
      submitted_at: actualFinishedAt,
    };

    if (!collectedAll) {
      fields.recovered_cable = String(recoveredNum);
      fields.unrecovered_cable = String(unrecovered);
      fields.unrecovered_reason = cableReason;
    }

    if (params.span_id) fields.pole_span_id = params.span_id;
    if (params.node_id && params.node_id !== "undefined")
      fields.node_id = params.node_id;
    if (params.node_name && params.node_name !== "undefined")
      fields.node_name = params.node_name;

    // Pole codes — stored in queue for display purposes
    if (params.pole_code) fields.from_pole_code = params.pole_code;
    if (params.to_pole_code) fields.to_pole_code = params.to_pole_code;

    // Send lineman-edited pole names so the backend stamps them into the images
    if (params.pole_name) fields.from_pole_name = params.pole_name;
    if (params.to_pole_name) fields.to_pole_name = params.to_pole_name;
    if (params.project_id && params.project_id !== "undefined") {
      fields.project_id = params.project_id;
    }
    if (params.to_pole_id && params.to_pole_id !== "undefined") {
      fields.to_pole_id = params.to_pole_id;
    }
    if (params.destination_slot) {
      fields.destination_slot = params.destination_slot;
    }
    if (params.destination_landmark) {
      fields.destination_landmark = params.destination_landmark;
    }
    if (user?.name) fields.submitted_by = user.name;
    const teamVal = (user as any)?.team_name ?? (user as any)?.team;
    if (teamVal) fields.team = teamVal;

    // Coordinate binding: prioritize device-embedded metadata cache over web parameters
    const trueFromLat = fromGpsCache?.lat ? String(fromGpsCache.lat) : params.from_pole_latitude;
    const trueFromLng = fromGpsCache?.lng ? String(fromGpsCache.lng) : params.from_pole_longitude;
    const gps = gpsRef.current;

    if (trueFromLat && trueFromLng) {
      fields.gps_latitude = trueFromLat;
      fields.gps_longitude = trueFromLng;
      fields.from_pole_latitude = trueFromLat;
      fields.from_pole_longitude = trueFromLng;
      if (params.from_pole_gps_captured_at) {
        fields.from_pole_gps_captured_at = params.from_pole_gps_captured_at;
      }
    } else if (gps) {
      fields.gps_latitude = String(gps.lat);
      fields.gps_longitude = String(gps.lng);
      if (gps.acc != null) fields.gps_accuracy = gps.acc.toFixed(2);
      fields.from_pole_latitude = String(gps.lat);
      fields.from_pole_longitude = String(gps.lng);
      fields.from_pole_gps_captured_at = gps.capturedAt;
    }

    fields.captured_at_device = actualStartedAt;

    for (const [key, ts] of Object.entries(photoTimestamps.current)) {
      fields[`${key}_captured_at`] = ts;
    }

    const trueToLat = toGpsCache?.lat ? String(toGpsCache.lat) : params.to_pole_latitude;
    const trueToLng = toGpsCache?.lng ? String(toGpsCache.lng) : params.to_pole_longitude;

    if (trueToLat && trueToLng) {
      fields.to_pole_latitude = trueToLat;
      fields.to_pole_longitude = trueToLng;
      if (params.to_pole_gps_captured_at) {
        fields.to_pole_gps_captured_at = params.to_pole_gps_captured_at;
      }
      if (params.to_pole_gps_accuracy) {
        fields.to_pole_gps_accuracy = params.to_pole_gps_accuracy;
      }
    }

    return fields;
  }

  function buildPhotoPaths(): Record<string, string> {
    const paths: Record<string, string> = {};
    if (photos.from_before) paths.from_before    = photos.from_before.uri;
    if (photos.from_after)  paths.from_after     = photos.from_after.uri;
    if (photos.from_tag)    paths.from_pole_tag  = photos.from_tag.uri;   // backend expects from_pole_tag
    if (photos.to_before)   paths.to_before      = photos.to_before.uri;
    if (photos.to_after)    paths.to_after       = photos.to_after.uri;
    if (photos.to_tag)      paths.to_pole_tag    = photos.to_tag.uri;     // backend expects to_pole_tag
    if (cablePhoto)         paths.bunching       = cablePhoto.uri;        // backend expects bunching
    return paths;
  }

  async function handleSubmit() {
    const missing: string[] = [];
    if (!polePreSubmitted && !photos.from_before) missing.push("From Pole — Before photo");
    if (!polePreSubmitted && !photos.from_tag) missing.push("From Pole — Pole Tag photo");
    if (!photos.to_before) missing.push("Destination Pole — Before photo");
    if (!photos.to_after) missing.push("Destination Pole — After photo");
    if (!photos.to_tag) missing.push("Destination Pole — Pole Tag photo");
    if (collectedAll === null) missing.push("Cable collection answer");
    if (recoveredCable.trim() === "") {
      missing.push("Actual cable collected (meters)");
    }
    if (!cablePhoto) missing.push("Bunching photo");

    if (missing.length > 0) {
      Alert.alert(
        "Incomplete Teardown",
        `Cannot submit — the following are missing:\n\n• ${missing.join("\n• ")}`,
      );
      return;
    }

    setSubmitting(true);

    let fields: Record<string, string>;
    let photoPaths: Record<string, string>;

    try {
      fields = await buildFields();
      photoPaths = buildPhotoPaths();
    } catch {
      Alert.alert("Error", "Could not prepare submission. Please try again.");
      setSubmitting(false);
      return;
    }

    // Generate a unique local_id for deduplication on the backend
    const local_id = `td_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const fieldNameMap: Record<string, string> = {
      from_tag:    "from_pole_tag",
      to_tag:      "to_pole_tag",
      before_span: "bunching",
    };

    // Photos are uploaded separately after the metadata record is created.
    // Do NOT bundle them here — 6×3MB over ngrok reliably causes timeout.
    const form = new FormData();
    form.append("local_id", local_id);
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }

    if (params.from_pole_id) {
      cacheSet(`spans_pole_${params.from_pole_id}`, null).catch(() => {});
    }
    // Invalidate destination pole span cache — it may now have new pending spans
    if (params.to_pole_id) {
      cacheSet(`spans_pole_${params.to_pole_id}`, null).catch(() => {});
    }
    cacheSet("teardown_logs", null).catch(() => {});
    if (params.node_id) {
      cacheSet(`node_logs_${params.node_id}`, null).catch(() => {});
    }

    router.replace({
      pathname: "/teardowns/teardown-complete" as any,
      params: {
        from_pole_code: params.pole_code ?? "",
        from_pole_name: params.pole_name ?? "",
        to_pole_id: params.to_pole_id ?? "",
        to_pole_code: params.to_pole_code ?? "",
        to_pole_name: params.to_pole_name ?? "",
        node_id: params.node_id ?? "",
        project_id: params.project_id ?? "",
        project_name: params.project_name ?? "",
        accent: params.accent ?? "",
        span_id: params.span_id ?? "",
        submitted_at: await getDisplayTime(),
        cable_collected: collectedAll ? "1" : "0",
        expected_cable: String(adjExpected),
        length_meters: String(lengthMeters),
        node_count: String(collectedNode),
        amplifier_count: String(collectedAmp),
        extender_count: String(collectedExt),
        tsc_count: String(collectedTsc),
        ps_count: String(collectedPs),
        ps_housing_count: String(collectedPsh),
        from_pole_id: params.from_pole_id ?? "",
        recovered_cable: String(recoveredNum),
        cable_reason: collectedAll ? "" : cableReason,
        from_pole_latitude: params.from_pole_latitude ?? "",
        from_pole_longitude: params.from_pole_longitude ?? "",
        to_pole_latitude: params.to_pole_latitude ?? "",
        to_pole_longitude: params.to_pole_longitude ?? "",
        pole_draft_dir: poleDraftDir,
        teardown_draft_dir: draftDir,
        to_code_sanitized: toCode,
      },
    });

    api
      .post("/teardown-logs", form)
      .then(async (res: any) => {
        const reportId = String(res?.data?.id ?? "");
        console.log("[ONLINE_UPLOAD_SUCCESS] report_id=" + reportId);

        // Upload images in parallel; queue any that fail
        const imageResults = await Promise.allSettled(
          Object.entries(photoPaths).map(async ([internalKey, uri]) => {
            const fieldName = fieldNameMap[internalKey] ?? internalKey;
            let imageType = "before";
            if (fieldName.includes("after")) imageType = "after";
            if (fieldName.includes("tag"))   imageType = "pole_tag";
            if (fieldName === "bunching")    imageType = "bunching";
            const isToPole = fieldName.startsWith("to_");
            const poleId   = isToPole ? params.to_pole_id : params.from_pole_id;
            const poleCode = isToPole ? params.to_pole_code : params.pole_code;
            const photoForm = new FormData();
            photoForm.append("report_id",      reportId);
            photoForm.append("pole_id",        String(poleId ?? ""));
            photoForm.append("node_id",        String(params.node_id ?? ""));
            photoForm.append("pole_code",      String(poleCode ?? "pole"));
            photoForm.append("image_type",     imageType);
            photoForm.append("inventory_type", "skycable");
            if (imageType === "bunching" && params.to_pole_id) {
              photoForm.append("to_pole_id", String(params.to_pole_id));
            }
            photoForm.append("image", { uri, name: `${fieldName}.jpg`, type: "image/jpeg" } as any);
            return { fieldName, uri, poleId, poleCode, imageType, result: await api.post("/teardown/upload-image", photoForm) };
          })
        );

        // Copy failed images to persistent storage BEFORE deleting draftDir.
        // This prevents file loss when the draft directory is cleaned up below.
        const failedImageEntries = await Promise.all(
          Object.entries(photoPaths).map(async ([internalKey, uri], idx) => {
            const r = imageResults[idx];
            if (r.status === "fulfilled") return null;
            const fieldName = fieldNameMap[internalKey] ?? internalKey;
            let imageType = "before";
            if (fieldName.includes("after")) imageType = "after";
            if (fieldName.includes("tag"))   imageType = "pole_tag";
            if (fieldName === "bunching")    imageType = "bunching";
            const isToPole = fieldName.startsWith("to_");
            // Persist to a safe directory that survives draft cleanup
            const persistentUri = await persistImage(uri, `${local_id}_${fieldName}.jpg`).catch(() => uri);
            return {
              reportLocalId: local_id,
              fieldName,
              uri: persistentUri,
              meta: {
                report_id:  reportId,
                pole_id:    String(isToPole ? params.to_pole_id : params.from_pole_id ?? ""),
                node_id:    String(params.node_id ?? ""),
                pole_code:  String(isToPole ? params.to_pole_code : params.pole_code ?? ""),
                image_type: imageType,
                ...(imageType === "bunching" && params.to_pole_id
                  ? { to_pole_id: String(params.to_pole_id) }
                  : {}),
              },
            };
          }),
        );

        const failedImages = failedImageEntries.filter(Boolean) as any[];
        if (failedImages.length > 0) {
          await imageQueuePush(failedImages).catch(() => {});
          console.log(`[NETWORK_ERROR_KEEP_PENDING] ${failedImages.length} image(s) persisted and queued`);
        }

        // Safe to delete draft dir now — failed images were already copied above
        await FileSystem.deleteAsync(draftDir, { idempotent: true }).catch(() => {});
        if (params.node_id) cacheSet(`node_logs_${params.node_id}`, null).catch(() => {});
        if (params.from_pole_id) {
          cacheSet(`pole_submitted_${params.from_pole_id}`, true).catch(() => {});
          FileSystem.deleteAsync(poleDraftDir + `pole_${params.from_pole_id}_after.jpg`, { idempotent: true }).catch(() => {});
        }

        // Record cleared_at for both poles. Backend determines actual skycable_status
        // based on remaining spans — a pole with multiple spans stays "in_progress"
        // until all spans are submitted.
        const clearedAt = getPHTNow();
        if (params.node_id && params.to_pole_id) {
          api.put(
            `/skycable/nodes/${params.node_id}/poles/${params.to_pole_id}`,
            { cleared_at: clearedAt }
          ).catch(() => {});
        }
        if (params.node_id && params.from_pole_id) {
          api.put(
            `/skycable/nodes/${params.node_id}/poles/${params.from_pole_id}`,
            { cleared_at: clearedAt }
          ).catch(() => {});
        }
        // Invalidate local poles cache — poles.tsx will re-fetch correct status from backend
        if (params.node_id) cacheSet(`sitemap_poles_${params.node_id}`, null).catch(() => {});
      })
      .catch(async (e: any) => {
        const status = e?.response?.status;

        // Already on server — treat as success, invalidate cache for fresh status
        if (status === 409) {
          if (params.from_pole_id) cacheSet(`pole_submitted_${params.from_pole_id}`, true).catch(() => {});
          if (params.node_id) cacheSet(`sitemap_poles_${params.node_id}`, null).catch(() => {});
          return;
        }

        const isBadRequest = status === 400 || status === 404 || status === 422;
        const isServer     = status >= 500;
        const isTimeout    = !status && e?.name === "AbortError";
        const isUnauth     = status === 401;

        const reason = isUnauth   ? "Session expired — please log out and back in."
                     : isBadRequest ? `Server rejected data (${status}) — saved for review.`
                     : isServer   ? `Server error ${status} — will retry automatically.`
                     : isTimeout  ? "Connection timed out — saved offline."
                     : e?.message ?? "Network error — saved offline.";

        console.log("[OFFLINE_CACHE_SAVED] reason=" + reason);
        await queuePush({
          fields: { ...fields, local_id },
          photoPaths,
          draftDir,
          poleDraftDir,
          fromPoleId: params.from_pole_id || undefined,
          toPoleId:   params.to_pole_id   || undefined,
          nodeId:     params.node_id || undefined,
          poleAfterPath: poleDraftDir + `pole_${params.from_pole_id}_after.jpg`,
        }).catch(() => {});

        // Only alert for 401 — requires user action (re-login).
        // 5xx / network / timeout are queued silently and retried automatically.
        // The teardown-complete screen already confirms the data is captured.
        if (isUnauth) {
          Alert.alert(
            "Session Expired",
            "Your teardown report is saved locally. Please log out and log back in — it will upload automatically.",
          );
        }
      });
  }

  const cableStepDone = collectedAll !== null && recoveredCable.trim() !== "" && !!cablePhoto;
  const componentsTotal =
    collectedNode +
    collectedAmp +
    collectedExt +
    collectedTsc +
    collectedPs +
    collectedPsh;

  const requiredPhotosDone = [
    polePreSubmitted || !!photos.from_before,
    polePreSubmitted || !!photos.from_tag,
    !!photos.to_before,
    !!photos.to_after,
    !!photos.to_tag,
    !!cablePhoto,
  ].filter(Boolean).length;

  const progress = useMemo(() => {
    const currentStepComplete = step === 0 ? cableStepDone : canProceed();
    const completed = [
      cableStepDone,
      step === 1 && currentStepComplete,
      requiredPhotosDone === 6,
      componentsTotal > 0,
    ].filter(Boolean).length;

    return {
      completed,
      total: 4,
      percent: Math.round((completed / 4) * 100),
    };
  }, [cableStepDone, step, requiredPhotosDone, componentsTotal, canProceed]);

  const spanLabel = params.span_code || `Span #${params.span_id}`;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={() => (step > 0 ? setStep(step - 1) : router.back())}
            style={({ pressed }) => [
              styles.floatingBackBtn,
              pressed && styles.pressedDown,
            ]}
          >
            <Text style={styles.floatingBackIcon}>‹</Text>
          </Pressable>

          <View style={styles.spanCard}>
            <View style={styles.spanCardTopRow}>
              <View
                style={[
                  styles.spanBadge,
                  {
                    backgroundColor: `${accentColor}18`,
                    borderColor: `${accentColor}30`,
                  },
                ]}
              >
                <Text style={[styles.spanBadgeText, { color: accentColor }]}>
                  Teardown
                </Text>
              </View>
              <View style={styles.spanStepBadge}>
                <Text style={styles.spanStepBadgeText}>
                  Step {step + 1}/{STEPS.length}
                </Text>
              </View>
            </View>

            <View style={styles.spanPoleRow}>
              <View style={styles.spanPoleBox}>
                <View
                  style={[styles.spanPoleDot, { backgroundColor: accentColor }]}
                />
                <Text
                  style={[styles.spanPoleCode, { color: accentColor }]}
                  numberOfLines={1}
                >
                  {params.pole_code || "—"}
                </Text>
                <Text style={styles.spanPoleLabel}>From</Text>
              </View>

              <View style={styles.spanConnector}>
                <View
                  style={[styles.spanLine, { borderColor: `${accentColor}50` }]}
                />
                <View
                  style={[
                    styles.spanDistBadge,
                    { backgroundColor: `${accentColor}12` },
                  ]}
                >
                  <Text style={[styles.spanDistText, { color: accentColor }]}>
                    {params.length_meters
                      ? `${params.length_meters}m`
                      : spanLabel || "Span"}
                  </Text>
                </View>
                <View
                  style={[styles.spanLine, { borderColor: `${accentColor}50` }]}
                />
              </View>

              <View style={styles.spanPoleBox}>
                <View
                  style={[styles.spanPoleDot, { backgroundColor: "#6366F1" }]}
                />
                <Text
                  style={[styles.spanPoleCode, { color: "#6366F1" }]}
                  numberOfLines={1}
                >
                  {params.to_pole_code || "—"}
                </Text>
                <Text style={styles.spanPoleLabel}>To</Text>
              </View>
            </View>

            {hasSpanCoords ? (
              <View style={styles.spanMiniMapWrap}>
                <StaticSpanMapView
                  fromLat={mapFromLat!}
                  fromLng={mapFromLng!}
                  toLat={mapToLat!}
                  toLng={mapToLng!}
                  accentColor={accentColor}
                />
              </View>
            ) : (
              <View style={styles.spanMapFallback}>
                <Text style={styles.spanMapFallbackIcon}>🗺</Text>
                <Text style={styles.spanMapFallbackText}>Map unavailable</Text>
                <Text style={styles.spanMapFallbackSub}>
                  GPS coords not captured yet
                </Text>
              </View>
            )}

            {hasSpanCoords ? (
              <Pressable
                style={({ pressed }) => [
                  styles.vicinityBtn,
                  { borderColor: `${accentColor}40` },
                  pressed && styles.pressedDown,
                ]}
                onPress={() => setVicinityOpen(true)}
              >
                <Text style={[styles.vicinityBtnText, { color: accentColor }]}>
                  🔍 View Vicinity Map
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Modal
            visible={vicinityOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setVicinityOpen(false)}
          >
            <View style={styles.vicinityModalBackdrop}>
              <View style={styles.vicinityModalCard}>
                <View style={styles.vicinityModalHeader}>
                  <Text style={styles.vicinityModalTitle}>
                    {params.pole_code} → {params.to_pole_code}
                  </Text>
                  <Pressable
                    onPress={() => setVicinityOpen(false)}
                    style={({ pressed }) => [
                      styles.vicinityCloseBtn,
                      pressed && styles.pressedDown,
                    ]}
                  >
                    <Text style={styles.vicinityCloseBtnText}>✕</Text>
                  </Pressable>
                </View>
                <View style={styles.vicinityMapWrap}>
                  <WebView
                    style={StyleSheet.absoluteFillObject}
                    scrollEnabled={false}
                    originWhitelist={["*"]}
                    javaScriptEnabled
                    domStorageEnabled
                    mixedContentMode="always"
                    cacheEnabled={false}
                    source={{
                      html: buildSpanMapHtml(
                        mapFromLat!,
                        mapFromLng!,
                        params.pole_code || "FROM",
                        mapToLat!,
                        mapToLng!,
                        params.to_pole_code || "TO",
                        accentColor,
                        false,
                      ),
                      baseUrl: "https://local.telcovantage/",
                    }}
                  />
                </View>
              </View>
            </View>
          </Modal>

          <View style={styles.progressCard}>
            <View style={styles.progressTopRow}>
              <Text style={styles.progressTitle}>Completion Tracker</Text>
              <Text style={[styles.progressPercent, { color: accentColor }]}>
                {progress.percent}%
              </Text>
            </View>

            <View style={styles.trackerRow}>
              <TrackerMini done={cableStepDone} label="Cable" />
              <TrackerMini done={requiredPhotosDone === 6} label="Photos" />
              <TrackerMini done={componentsTotal > 0} label="Items" />
            </View>

            <ProgressWaveBar
              progress={progress.percent}
              accentColor={accentColor}
            />
          </View>

          {step === 0 ? (
            <Animated.View
              style={[styles.sectionCard, photoReviewAnimatedStyle]}
            >
              <SectionHeading
                title="Photo Review"
                subtitle="Tap a captured photo to review"
                right={
                  <View
                    style={[
                      styles.sectionPill,
                      requiredPhotosDone === 6
                        ? styles.sectionPillSuccess
                        : styles.sectionPillMuted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionPillText,
                        requiredPhotosDone === 6
                          ? styles.sectionPillTextSuccess
                          : styles.sectionPillTextMuted,
                      ]}
                    >
                      {requiredPhotosDone}/5
                    </Text>
                  </View>
                }
              />

              <View style={styles.photoCircleGrid}>
                <PhotoCircleItem
                  label="From Before"
                  photo={photos.from_before}
                  required
                  preUploaded={polePreSubmitted}
                  onPress={() => openViewer("From Before", photos.from_before)}
                />
                <PhotoCircleItem
                  label="From After"
                  photo={photos.from_after}
                  onPress={() => openViewer("From After", photos.from_after)}
                />
                <PhotoCircleItem
                  label="From Tag"
                  photo={photos.from_tag}
                  required
                  preUploaded={polePreSubmitted}
                  onPress={() => openViewer("From Tag", photos.from_tag)}
                />
                <PhotoCircleItem
                  label="To Before"
                  photo={photos.to_before}
                  required
                  onPress={() => openViewer("To Before", photos.to_before)}
                />
                <PhotoCircleItem
                  label="To After"
                  photo={photos.to_after}
                  required
                  onPress={() => openViewer("To After", photos.to_after)}
                />
                <PhotoCircleItem
                  label="To Tag"
                  photo={photos.to_tag}
                  required
                  onPress={() => openViewer("To Tag", photos.to_tag)}
                />
                {cablePhoto ? (
                  <PhotoCircleItem
                    label="Bunching"
                    photo={cablePhoto}
                    required
                    onPress={() => openViewer("Bunching Image", cablePhoto)}
                  />
                ) : null}
              </View>

              <View style={styles.readyRow}>
                <View
                  style={[
                    styles.readyDot,
                    canProceed() && styles.readyDotSuccess,
                  ]}
                />
                <Text
                  style={[
                    styles.readyLabel,
                    canProceed() && styles.readyLabelSuccess,
                  ]}
                >
                  {canProceed()
                    ? "Ready for submission"
                    : "Please attach image"}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          <View style={styles.routeCard}>
            <View style={styles.routeBlock}>
              <Text style={styles.routeLabel}>From</Text>
              <Text style={styles.routeValue} numberOfLines={2}>
                {params.pole_name || params.pole_code || "—"}
              </Text>
            </View>

            <Text style={styles.routeArrow}>→</Text>

            <View style={styles.routeBlock}>
              <Text style={styles.routeLabel}>To</Text>
              <Text style={styles.routeValue} numberOfLines={2}>
                {params.to_pole_name || params.to_pole_code || "—"}
              </Text>
            </View>
          </View>

          {step === 0 ? (
            <>
            <View style={styles.sectionCard}>
              <SectionHeading
                title="Cable Collection"
                subtitle="Confirm cable recovery before proceeding"
                right={
                  <View
                    style={[
                      styles.sectionPill,
                      cableStepDone
                        ? styles.sectionPillSuccess
                        : styles.sectionPillMuted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionPillText,
                        cableStepDone
                          ? styles.sectionPillTextSuccess
                          : styles.sectionPillTextMuted,
                      ]}
                    >
                      {cableStepDone ? "Ready" : "Required"}
                    </Text>
                  </View>
                }
              />

              <Text style={styles.helperText}>Were all cables collected?</Text>

              <View style={styles.yesNoRow}>
                <TouchableOpacity
                  onPress={() => setCollectedAll(true)}
                  activeOpacity={0.85}
                  style={[
                    styles.yesNoBtn,
                    collectedAll === true && {
                      backgroundColor: "#10b981",
                      borderColor: "#10b981",
                    },
                  ]}
                >
                  <Text style={styles.yesNoEmoji}>✅</Text>
                  <Text
                    style={[
                      styles.yesNoBtnText,
                      collectedAll === true && { color: "#FFFFFF" },
                    ]}
                  >
                    Yes, all collected
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setCollectedAll(false)}
                  activeOpacity={0.85}
                  style={[
                    styles.yesNoBtn,
                    collectedAll === false && {
                      backgroundColor: "#ef4444",
                      borderColor: "#ef4444",
                    },
                  ]}
                >
                  <Text style={styles.yesNoEmoji}>⚠️</Text>
                  <Text
                    style={[
                      styles.yesNoBtnText,
                      collectedAll === false && { color: "#FFFFFF" },
                    ]}
                  >
                    Not all collected
                  </Text>
                </TouchableOpacity>
              </View>

              {collectedAll === true ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>
                    Actual cable collected (meters)
                  </Text>
                  <TextInput
                    onChangeText={setRecoveredCable}
                    value={recoveredCable}
                    keyboardType="numeric"
                    placeholder="Enter meters collected"
                    placeholderTextColor="#9CA3AF"
                    style={styles.textInput}
                  />
                </View>
              ) : null}

              {collectedAll === false ? (
                <>
                  {declaredRuns > 1 ? (
                    <View style={styles.warningBox}>
                      <Text style={styles.warningTitle}>
                        Declared runs: {declaredRuns}
                      </Text>
                      <Text style={styles.warningText}>
                        How many runs did you actually find?
                      </Text>

                      <View style={styles.runBtnRow}>
                        {Array.from(
                          { length: declaredRuns },
                          (_, i) => i + 1,
                        ).map((n) => (
                          <TouchableOpacity
                            key={n}
                            onPress={() => setActualRuns(n)}
                            style={[
                              styles.runBtn,
                              actualRuns === n && {
                                backgroundColor: accentColor,
                                borderColor: accentColor,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.runBtnNum,
                                actualRuns === n && { color: "#FFFFFF" },
                              ]}
                            >
                              {n}
                            </Text>
                            <Text
                              style={[
                                styles.runBtnLabel,
                                actualRuns === n && { color: "#DBEAFE" },
                              ]}
                            >
                              {n === 1 ? "run" : "runs"}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {actualRuns < declaredRuns ? (
                        <Text style={styles.warningFootnote}>
                          Adjusted expected: {lengthMeters * actualRuns}m
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>
                      Recovered cable (meters)
                    </Text>
                    <TextInput
                      onChangeText={setRecoveredCable}
                      value={recoveredCable}
                      keyboardType="numeric"
                      placeholder={`Max ${adjExpected}m`}
                      placeholderTextColor="#9CA3AF"
                      style={styles.textInput}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Reason</Text>
                    <TextInput
                      multiline
                      onChangeText={setCableReason}
                      value={cableReason}
                      placeholder="Describe why cable was not fully collected..."
                      placeholderTextColor="#9CA3AF"
                      style={[styles.textInput, styles.textArea]}
                    />
                  </View>

                </>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <SectionHeading
                title="Bunching Image"
                subtitle="Photo of cables bundled after teardown"
                right={
                  <View style={[styles.sectionPill, cablePhoto ? styles.sectionPillSuccess : styles.sectionPillMuted]}>
                    <Text style={[styles.sectionPillText, cablePhoto ? styles.sectionPillTextSuccess : styles.sectionPillTextMuted]}>
                      {cablePhoto ? "Captured" : "Required"}
                    </Text>
                  </View>
                }
              />
              {cablePhoto ? (
                <>
                  {/* Full-width photo — tap to open preview modal */}
                  <TouchableOpacity
                    activeOpacity={0.88}
                    style={styles.bunchingFullPhotoBox}
                    onPress={() => setBunchingPreviewOpen(true)}
                  >
                    <ExpoImage
                      source={{ uri: cablePhoto.uri }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="cover"
                    />
                    {/* GPS overlay at bottom-left */}
                    {bunchingGps ? (
                      <View style={styles.bunchingPhotoMetaOverlay}>
                        <Text style={styles.bunchingPhotoMetaCoords}>
                          📍 {bunchingGps.lat.toFixed(6)}, {bunchingGps.lng.toFixed(6)}
                        </Text>
                        {(bunchingStreet || bunchingCity) ? (
                          <Text style={styles.bunchingPhotoMetaAddr} numberOfLines={1}>
                            {[bunchingStreet, bunchingCity].filter(Boolean).join(", ")}
                          </Text>
                        ) : null}
                        <Text style={styles.bunchingPhotoMetaTime}>
                          {bunchingGps.capturedAt.replace("T", "  ").substring(0, 22)}
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.bunchingExpandHint}>
                      <Text style={styles.bunchingExpandHintText}>⛶ Tap to preview</Text>
                    </View>
                  </TouchableOpacity>

                  {/* Retake button */}
                  <TouchableOpacity
                    style={[styles.retakeBtn, { borderColor: accentColor }]}
                    onPress={retakeBunchingPhoto}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.retakeBtnText, { color: accentColor }]}>↺  Retake</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  onPress={openBunchingCamera}
                  activeOpacity={0.85}
                  style={[styles.cablePhotoBox, { borderColor: "#EF4444", borderStyle: "dashed" }]}
                >
                  <View style={styles.cablePhotoEmpty}>
                    <Text style={styles.cablePhotoEmptyIcon}>📷</Text>
                    <Text style={[styles.cablePhotoEmptyText, { color: "#EF4444" }]}>
                      Tap to capture (Required)
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <View style={styles.sectionCard}>
                <SectionHeading
                  title="Component Recovery"
                  subtitle="Enter the quantity collected for each item"
                  right={
                    <View
                      style={[
                        styles.sectionPill,
                        componentsTotal > 0
                          ? styles.sectionPillSuccess
                          : styles.sectionPillMuted,
                      ]}
                    >
                      <Text
                        style={[
                          styles.sectionPillText,
                          componentsTotal > 0
                            ? styles.sectionPillTextSuccess
                            : styles.sectionPillTextMuted,
                        ]}
                      >
                        {componentsTotal > 0 ? "Updated" : "Pending"}
                      </Text>
                    </View>
                  }
                />

                <View style={styles.counterRow}>
                  <CounterCard
                    label="Node"
                    value={collectedNode}
                    expected={Number(params.expected_node) || 0}
                    onChange={setCollectedNode}
                    accentColor={accentColor}
                  />
                  <CounterCard
                    label="Amplifier"
                    value={collectedAmp}
                    expected={Number(params.expected_amplifier) || 0}
                    onChange={setCollectedAmp}
                    accentColor={accentColor}
                  />
                </View>

                <View style={styles.counterRow}>
                  <CounterCard
                    label="Extender"
                    value={collectedExt}
                    expected={Number(params.expected_extender) || 0}
                    onChange={setCollectedExt}
                    accentColor={accentColor}
                  />
                  <CounterCard
                    label="TSC"
                    value={collectedTsc}
                    expected={Number(params.expected_tsc) || 0}
                    onChange={setCollectedTsc}
                    accentColor={accentColor}
                  />
                </View>

                <View style={[styles.counterRow, { marginBottom: 0 }]}>
                  <CounterCard
                    label="Power Supply"
                    value={collectedPs}
                    expected={Number(params.expected_powersupply) || 0}
                    onChange={setCollectedPs}
                    accentColor={accentColor}
                  />
                  <CounterCard
                    label="PS Housing"
                    value={collectedPsh}
                    expected={Number(params.expected_powersupply_housing) || 0}
                    onChange={setCollectedPsh}
                    accentColor={accentColor}
                  />
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>

        <View style={styles.ctaBar}>
          <Pressable
            style={({ pressed }) => [
              styles.submitBtn,
              {
                backgroundColor:
                  canProceed() && !submitting ? accentColor : "#C9CED6",
              },
              pressed && canProceed() && !submitting && styles.pressedDown,
            ]}
            onPress={() => {
              if (step === STEPS.length - 1) {
                setSummaryOpen(true);
              } else {
                goNext();
              }
            }}
            disabled={!canProceed() || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>
                {step === STEPS.length - 1
                  ? "Complete Teardown ✓"
                  : `Next: ${STEPS[step + 1].label} →`}
              </Text>
            )}
          </Pressable>
        </View>

        <Modal
          visible={viewerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setViewerOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setViewerOpen(false)}
            />
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{viewerLabel}</Text>
                  <Text style={styles.modalSubtitle}>Photo preview</Text>
                </View>

                <Pressable
                  onPress={() => setViewerOpen(false)}
                  style={({ pressed }) => [
                    styles.modalCloseBtn,
                    pressed && styles.pressedDown,
                  ]}
                >
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {viewerPhoto ? (
                <View style={styles.modalImageWrap}>
                  <ExpoImage
                    source={{ uri: viewerPhoto.uri }}
                    style={styles.modalImage}
                    contentFit="contain"
                    transition={150}
                  />
                </View>
              ) : null}

              <View style={styles.modalFooter}>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalGhostBtn,
                    pressed && styles.pressedDown,
                  ]}
                  onPress={() => setViewerOpen(false)}
                >
                  <Text style={styles.modalGhostBtnText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Full Teardown Summary modal */}
        <Modal
          visible={summaryOpen}
          animationType="slide"
          onRequestClose={() => setSummaryOpen(false)}
        >
          <SafeAreaView style={styles.summaryRoot} edges={["top", "bottom"]}>
            {/* Header */}
            <View style={styles.summaryHeader}>
              <Pressable
                onPress={() => setSummaryOpen(false)}
                style={({ pressed }) => [
                  styles.summaryBackBtn,
                  pressed && styles.pressedDown,
                ]}
              >
                <Text style={styles.summaryBackIcon}>‹</Text>
              </Pressable>
              <Text style={styles.summaryHeaderTitle}>Teardown Summary</Text>
              <View style={{ width: 44 }} />
            </View>

            <ScrollView
              contentContainerStyle={styles.summaryContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Span + Vicinity Map */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryCardLabel}>SPAN</Text>
                <View style={styles.spanPoleRow}>
                  <View style={styles.spanPoleBox}>
                    <View
                      style={[
                        styles.spanPoleDot,
                        { backgroundColor: accentColor },
                      ]}
                    />
                    <Text
                      style={[styles.spanPoleCode, { color: accentColor }]}
                      numberOfLines={1}
                    >
                      {params.pole_code || "—"}
                    </Text>
                    <Text style={styles.spanPoleLabel}>From</Text>
                  </View>
                  <View style={styles.spanConnector}>
                    <View
                      style={[
                        styles.spanLine,
                        { borderColor: `${accentColor}50` },
                      ]}
                    />
                    {params.length_meters ? (
                      <View
                        style={[
                          styles.spanDistBadge,
                          { backgroundColor: `${accentColor}12` },
                        ]}
                      >
                        <Text
                          style={[styles.spanDistText, { color: accentColor }]}
                        >
                          {params.length_meters}m
                        </Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.spanLine,
                        { borderColor: `${accentColor}50` },
                      ]}
                    />
                  </View>
                  <View style={styles.spanPoleBox}>
                    <View
                      style={[
                        styles.spanPoleDot,
                        { backgroundColor: "#6366F1" },
                      ]}
                    />
                    <Text
                      style={[styles.spanPoleCode, { color: "#6366F1" }]}
                      numberOfLines={1}
                    >
                      {params.to_pole_code || "—"}
                    </Text>
                    <Text style={styles.spanPoleLabel}>To</Text>
                  </View>
                </View>

                {hasSpanCoords ? (
                  <View style={styles.summaryMapWrap}>
                    <WebView
                      style={StyleSheet.absoluteFillObject}
                      scrollEnabled={false}
                      originWhitelist={["*"]}
                      javaScriptEnabled
                      domStorageEnabled
                      mixedContentMode="always"
                      cacheEnabled={false}
                      source={{
                        html: buildSpanMapHtml(
                          mapFromLat!,
                          mapFromLng!,
                          params.pole_code || "FROM",
                          mapToLat!,
                          mapToLng!,
                          params.to_pole_code || "TO",
                          accentColor,
                          false,
                        ),
                        baseUrl: "https://local.telcovantage/",
                      }}
                    />
                  </View>
                ) : (
                  <View style={styles.spanMapFallback}>
                    <Text style={styles.spanMapFallbackIcon}>🗺</Text>
                    <Text style={styles.spanMapFallbackText}>
                      Map unavailable
                    </Text>
                  </View>
                )}
              </View>

              {/* Photo Review */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryCardLabel}>
                  PHOTO REVIEW ({requiredPhotosDone}/5)
                </Text>
                <View style={styles.summaryPhotoGrid}>
                  {(
                    [
                      { key: "from_before", label: "From Before" },
                      { key: "from_after", label: "From After" },
                      { key: "from_tag", label: "From Tag" },
                      { key: "to_before", label: "To Before" },
                      { key: "to_after", label: "To After" },
                      { key: "to_tag", label: "To Tag" },
                    ] as const
                  ).map(({ key, label }) => {
                    const photo = photos[key];
                    return (
                      <View key={key} style={styles.summaryPhotoItem}>
                        {photo ? (
                          <Pressable
                            onPress={() => openViewer(label, photo)}
                            style={({ pressed }) => [
                              pressed && styles.pressedDown,
                            ]}
                          >
                            <ExpoImage
                              source={{ uri: photo.uri }}
                              style={styles.summaryPhotoThumb}
                              contentFit="cover"
                            />
                          </Pressable>
                        ) : (
                          <View style={styles.summaryPhotoEmpty}>
                            <Text style={styles.summaryPhotoEmptyIcon}>📷</Text>
                          </View>
                        )}
                        <Text
                          style={styles.summaryPhotoLabel}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                        <Text
                          style={[
                            styles.summaryPhotoStatus,
                            photo
                              ? styles.summaryPhotoStatusDone
                              : styles.summaryPhotoStatusMissing,
                          ]}
                        >
                          {photo ? "✓" : "—"}
                        </Text>
                      </View>
                    );
                  })}
                  {cablePhoto ? (
                    <View style={styles.summaryPhotoItem}>
                      <Pressable
                        onPress={() => openViewer("Bunching Image", cablePhoto)}
                        style={({ pressed }) => [pressed && styles.pressedDown]}
                      >
                        <ExpoImage
                          source={{ uri: cablePhoto.uri }}
                          style={styles.summaryPhotoThumb}
                          contentFit="cover"
                        />
                      </Pressable>
                      <Text style={styles.summaryPhotoLabel}>Bunching</Text>
                      <Text
                        style={[
                          styles.summaryPhotoStatus,
                          styles.summaryPhotoStatusDone,
                        ]}
                      >
                        ✓
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Components */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryCardLabel}>
                  COMPONENTS COLLECTED
                </Text>
                <View style={styles.summaryCompGrid}>
                  {[
                    { label: "Node", value: collectedNode, expected: Number(params.expected_node) || 0 },
                    { label: "Amplifier", value: collectedAmp, expected: Number(params.expected_amplifier) || 0 },
                    { label: "Extender", value: collectedExt, expected: Number(params.expected_extender) || 0 },
                    { label: "TSC", value: collectedTsc, expected: Number(params.expected_tsc) || 0 },
                    { label: "Pwr Supply", value: collectedPs, expected: Number(params.expected_powersupply) || 0 },
                    { label: "PS Housing", value: collectedPsh, expected: Number(params.expected_powersupply_housing) || 0 },
                  ].map(({ label, value, expected }) => {
                    const matched = value === expected && expected > 0;
                    return (
                      <View key={label} style={styles.summaryCompCell}>
                        <Text style={[styles.summaryCompCount, { color: matched ? accentColor : "#111827" }]}>
                          {value}
                        </Text>
                        <Text style={styles.summaryCompLabel}>{label}</Text>
                        <Text style={styles.summaryCompExpected}>/{expected}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Cable */}
              <View style={styles.summaryCard}>
                <Text style={styles.summaryCardLabel}>CABLE</Text>
                <View style={styles.summaryCableRow}>
                  {cablePhoto ? (
                    <Pressable
                      onPress={() => openViewer("Bunching Image", cablePhoto)}
                      style={({ pressed }) => [pressed && styles.pressedDown]}
                    >
                      <ExpoImage
                        source={{ uri: cablePhoto.uri }}
                        style={styles.summaryCableThumb}
                        contentFit="cover"
                      />
                    </Pressable>
                  ) : null}
                  <View style={styles.summaryCableStats}>
                    <View style={styles.summaryCableCell}>
                      <Text style={styles.summaryCableCellLabel}>Status</Text>
                      <Text style={[styles.summaryCableCellValue, { color: collectedAll ? "#16A34A" : "#DC2626" }]}>
                        {collectedAll === null ? "—" : collectedAll ? "All" : "Partial"}
                      </Text>
                    </View>
                    <View style={styles.summaryCableCell}>
                      <Text style={styles.summaryCableCellLabel}>Recovered</Text>
                      <Text style={styles.summaryCableCellValue}>{recoveredCable || "—"}m</Text>
                    </View>
                    <View style={styles.summaryCableCell}>
                      <Text style={styles.summaryCableCellLabel}>Expected</Text>
                      <Text style={styles.summaryCableCellValue}>{adjExpected}m</Text>
                    </View>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Mark as Complete CTA */}
            <View style={styles.summaryCtaBar}>
              <Pressable
                style={({ pressed }) => [
                  styles.summaryMarkBtn,
                  { backgroundColor: accentColor },
                  pressed && styles.pressedDown,
                ]}
                onPress={() => setConfirmOpen(true)}
              >
                <Text style={styles.summaryMarkBtnText}>
                  Mark as Complete ✓
                </Text>
              </Pressable>
            </View>

            {/* Confirmation dialog — inside summary modal so it renders above the slide layer */}
            <Modal
              visible={confirmOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setConfirmOpen(false)}
            >
              <View style={styles.confirmBackdrop}>
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmTitle}>
                    Have you completed all required details before submission?
                  </Text>
                  <Text style={styles.confirmBody}>
                    Are you sure all details are complete before submitting?
                  </Text>
                  <View style={styles.confirmBtnRow}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.confirmCancelBtn,
                        pressed && styles.pressedDown,
                      ]}
                      onPress={() => setConfirmOpen(false)}
                    >
                      <Text style={styles.confirmCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.confirmYesBtn,
                        { backgroundColor: accentColor },
                        pressed && styles.pressedDown,
                      ]}
                      onPress={() => {
                        setConfirmOpen(false);
                        handleSubmit();
                      }}
                    >
                      <Text style={styles.confirmYesText}>Yes, Submit</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          </SafeAreaView>
        </Modal>
      {/* Hidden stamp WebView for bunching photo metadata overlay */}
      <WebView
        ref={bunchingStampRef}
        style={{ position: "absolute", width: 0, height: 0, opacity: 0 }}
        source={{ html: STAMP_HTML }}
        onMessage={handleBunchingStampMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["*"]}
      />
      </SafeAreaView>

      {/* ── Bunching Photo Preview Modal ──────────────────────────── */}
      <Modal
        visible={bunchingPreviewOpen}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setBunchingPreviewOpen(false)}
      >
        <SafeAreaView style={styles.bunchingPreviewRoot} edges={["top", "bottom"]}>
          {/* Header */}
          <View style={styles.bunchingPreviewHeader}>
            <Text style={styles.bunchingPreviewTitle}>Bunching Photo</Text>
            <TouchableOpacity
              onPress={() => setBunchingPreviewOpen(false)}
              style={styles.bunchingPreviewClose}
            >
              <Text style={styles.bunchingPreviewCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Full-screen photo */}
          <View style={{ flex: 1 }}>
            {cablePhoto ? (
              <ExpoImage
                source={{ uri: cablePhoto.uri }}
                style={StyleSheet.absoluteFillObject}
                contentFit="contain"
              />
            ) : null}
          </View>

          {/* Actions */}
          <View style={styles.bunchingPreviewActions}>
            <TouchableOpacity
              style={[styles.bunchingPreviewBtn, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}
              onPress={() => { setBunchingPreviewOpen(false); retakeBunchingPhoto(); }}
            >
              <Text style={[styles.bunchingPreviewBtnText, { color: "#DC2626" }]}>↺  Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bunchingPreviewBtn, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", flex: 1 }]}
              onPress={() => setBunchingPreviewOpen(false)}
            >
              <Text style={[styles.bunchingPreviewBtnText, { color: "#15803D" }]}>✓  Keep Photo</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 170,
  },

  pressedDown: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },

  floatingBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E7EBEF",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  floatingBackIcon: {
    fontSize: 28,
    color: "#111827",
    fontWeight: "700",
    marginTop: -2,
  },

  progressCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#EAECEF",
    shadowColor: "#0F172A",
    shadowOpacity: 0.035,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  progressTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  progressTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#111827",
  },

  progressPercent: {
    fontSize: 13,
    fontWeight: "900",
  },

  trackerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 12,
  },

  trackerMini: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
  },

  trackerMiniDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 5,
  },

  trackerMiniDotDone: {
    backgroundColor: "#DCFCE7",
  },

  trackerMiniDotText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#64748B",
  },

  trackerMiniDotTextDone: {
    color: "#166534",
  },

  trackerMiniLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6B7280",
  },

  trackerMiniLabelDone: {
    color: "#166534",
  },

  progressBarTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#E8EDF2",
    overflow: "hidden",
  },

  progressBarFill: {
    height: "100%",
    borderRadius: 999,
    overflow: "hidden",
    justifyContent: "center",
  },

  progressWave: {
    position: "absolute",
    top: -10,
    bottom: -10,
    width: 70,
    backgroundColor: "rgba(255,255,255,0.24)",
    borderRadius: 24,
  },

  routeCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#E8EDF2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#0F172A",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  routeBlock: {
    flex: 1,
    alignItems: "center",
  },

  routeLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },

  routeValue: {
    fontSize: 13,
    color: "#0F172A",
    fontWeight: "800",
    textAlign: "center",
  },

  routeArrow: {
    fontSize: 20,
    fontWeight: "900",
    color: "#94A3B8",
    paddingHorizontal: 10,
  },

  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 10,
  },

  sectionHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "900",
    color: "#111827",
  },

  sectionSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 18,
    color: "#6B7280",
    fontWeight: "500",
  },

  sectionPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },

  sectionPillSuccess: {
    backgroundColor: "#DCFCE7",
  },

  sectionPillMuted: {
    backgroundColor: "#F3F4F6",
  },

  sectionPillText: {
    fontSize: 11,
    fontWeight: "800",
  },

  sectionPillTextSuccess: {
    color: "#166534",
  },

  sectionPillTextMuted: {
    color: "#667085",
  },

  photoCircleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 18,
    columnGap: 10,
  },

  photoCircleItem: {
    width: "30%",
    minWidth: 82,
    alignItems: "center",
    marginBottom: 2,
  },

  photoCircleOuter: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },

  photoCircleGlow: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 32,
    backgroundColor: "#34D399",
  },

  photoCircle: {
    width: 28,
    height: 28,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#F8FAFC",
    borderWidth: 2,
    borderColor: "#DDE3EA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  photoCircleDone: {
    borderColor: "#A7F3D0",
    shadowOpacity: 0.12,
  },

  photoCircleImage: {
    width: "100%",
    height: "100%",
  },

  photoCircleEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },

  photoCircleEmptyIcon: {
    fontSize: 22,
  },

  photoCircleLabel: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    minHeight: 18,
  },

  photoCircleCheckWrap: {
    alignItems: "center",
    marginTop: 3,
  },

  photoCircleCheck: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },

  photoCircleCheckDone: {
    backgroundColor: "#DCFCE7",
    borderColor: "#86EFAC",
  },

  photoCircleCheckText: {
    fontSize: 8,
    fontWeight: "900",
    color: "#64748B",
    lineHeight: 9,
  },

  photoCircleCheckTextDone: {
    color: "#166534",
  },

  photoCircleCheckLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    color: "#6B7280",
  },

  photoCircleCheckLabelDone: {
    color: "#166534",
  },

  helperText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },

  yesNoRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },

  yesNoBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: "#F3F4F6",
    borderWidth: 1.2,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },

  yesNoEmoji: {
    fontSize: 24,
    marginBottom: 6,
  },

  yesNoBtnText: {
    color: "#374151",
    fontWeight: "800",
    fontSize: 12,
    textAlign: "center",
  },

  warningBox: {
    backgroundColor: "#FFF7E7",
    borderRadius: 18,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FDE68A",
  },

  warningTitle: {
    fontSize: 12,
    fontWeight: "900",
    color: "#92400E",
    marginBottom: 4,
  },

  warningText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#B45309",
    marginBottom: 10,
  },

  warningFootnote: {
    fontSize: 11,
    color: "#B45309",
    fontWeight: "700",
    marginTop: 8,
  },

  runBtnRow: {
    flexDirection: "row",
    gap: 8,
  },

  runBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
  },

  runBtnNum: {
    fontSize: 18,
    fontWeight: "900",
    color: "#374151",
  },

  runBtnLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#9CA3AF",
    marginTop: 2,
  },

  fieldGroup: {
    marginBottom: 16,
  },

  fieldLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
    marginBottom: 8,
  },

  fieldLabelInline: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },

  fieldMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#667085",
  },

  inlineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  },

  textInput: {
    backgroundColor: "#FCFCFD",
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: "#E5E7EB",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: "#111827",
  },

  textArea: {
    minHeight: 88,
    textAlignVertical: "top",
  },

  cablePhotoBox: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1.2,
    borderColor: "#D8E0E8",
    borderStyle: "dashed",
    backgroundColor: "#F8FAFC",
    height: 220,
  },

  bunchingFullPhotoBox: {
    borderRadius: 16,
    overflow: "hidden",
    height: 260,
    marginBottom: 10,
    backgroundColor: "#0F172A",
  },

  bunchingPhotoMetaOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.52)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  bunchingPhotoMetaCoords: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    fontFamily: "monospace",
  },
  bunchingPhotoMetaAddr: {
    fontSize: 10,
    fontWeight: "500",
    color: "#CBD5E1",
  },
  bunchingPhotoMetaTime: {
    fontSize: 10,
    fontWeight: "600",
    color: "#94A3B8",
  },

  cablePhotoEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  cablePhotoEmptyIcon: {
    fontSize: 28,
    marginBottom: 8,
  },

  cablePhotoEmptyText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#667085",
  },

  bunchingExpandHint: {
    position: "absolute",
    bottom: 10,
    right: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  bunchingExpandHintText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },

  retakeBtn: {
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: "#F8FAFC",
  },
  retakeBtnText: {
    fontSize: 13,
    fontWeight: "900",
  },

  bunchingPreviewRoot: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  bunchingPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  bunchingPreviewTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
  },
  bunchingPreviewClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  bunchingPreviewCloseText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#64748B",
  },
  bunchingPreviewActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  bunchingPreviewBtn: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  bunchingPreviewBtnText: {
    fontSize: 14,
    fontWeight: "900",
  },

  counterRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },

  counterCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },

  counterLabel: {
    fontSize: 10,
    color: "#6B7280",
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 4,
    textAlign: "center",
  },

  counterExpected: {
    fontSize: 11,
    color: "#6366F1",
    fontWeight: "700",
    marginBottom: 10,
  },

  counterControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  counterBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.2,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },

  counterBtnText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#374151",
    marginTop: -1,
  },

  counterValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    minWidth: 24,
    textAlign: "center",
  },

  summaryCheckGrid: {
    gap: 10,
  },

  summaryCheckRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 2,
  },

  summaryCheckDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },

  summaryCheckDotDone: {
    backgroundColor: "#DCFCE7",
  },

  summaryCheckDotText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#64748B",
  },

  summaryCheckDotTextDone: {
    color: "#166534",
  },

  summaryCheckContent: {
    flex: 1,
    minWidth: 0,
  },

  summaryCheckTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },

  summaryCheckLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
  },

  summaryCheckStatus: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "700",
  },

  summaryCheckStatusDone: {
    color: "#166534",
  },

  summaryCheckStatusPending: {
    color: "#DC2626",
  },

  summaryCheckStatusPre: {
    color: "#6366F1",
  },

  requiredBadge: {
    backgroundColor: "#FEE2E2",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  requiredBadgeText: {
    fontSize: 8,
    color: "#DC2626",
    fontWeight: "900",
  },

  skipBadge: {
    backgroundColor: "#EDE9FE",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  skipBadgeText: {
    fontSize: 8,
    color: "#6366F1",
    fontWeight: "900",
  },

  ctaBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 10,
  },

  submitBtn: {
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },

  submitText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  timerBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },

  timerText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#374151",
    letterSpacing: 0.5,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12,16,24,0.62)",
    justifyContent: "center",
    padding: 18,
  },

  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 14,
    overflow: "hidden",
    maxHeight: SCREEN_H * 0.88,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#161A25",
  },

  modalSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: "#667085",
    fontWeight: "600",
  },

  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  modalCloseText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#111827",
  },

  modalImageWrap: {
    height: SCREEN_H * 0.65,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#E5E7EB",
  },

  modalImage: {
    width: "100%",
    height: "100%",
  },

  modalFooter: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },

  modalGhostBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: "#F3F4F6",
  },

  modalGhostBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#374151",
  },

  spanCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E9EDF2",
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },

  spanCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  spanBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  spanBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  spanStepBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  spanStepBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#667085",
  },

  spanPoleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  spanPoleBox: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },

  spanPoleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 2,
  },

  spanPoleCode: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },

  spanPoleLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  spanConnector: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  spanLine: {
    flex: 1,
    borderTopWidth: 2,
    borderStyle: "dashed",
  },

  spanDistBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  spanDistText: {
    fontSize: 11,
    fontWeight: "800",
  },

  spanMiniMapWrap: {
    height: 160,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#F0F4F8",
    marginBottom: 10,
  },

  spanMapFallback: {
    height: 90,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E5E9EE",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    gap: 4,
  },

  spanMapFallbackIcon: {
    fontSize: 22,
  },

  spanMapFallbackText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#374151",
  },

  spanMapFallbackSub: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
  },

  vicinityBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 12,
    backgroundColor: "#FAFAFA",
  },

  vicinityBtnText: {
    fontSize: 13,
    fontWeight: "800",
  },

  vicinityModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12,16,24,0.55)",
    justifyContent: "flex-end",
  },

  vicinityModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    paddingBottom: 32,
  },

  vicinityModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F3F5",
  },

  vicinityModalTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#0F172A",
  },

  vicinityCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  vicinityCloseBtnText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#374151",
  },

  vicinityMapWrap: {
    height: 400,
    backgroundColor: "#F0F4F8",
  },

  readyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#EEF2F7",
  },

  readyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#F59E0B",
  },

  readyDotSuccess: {
    backgroundColor: "#16A34A",
  },

  readyLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#B45309",
  },

  readyLabelSuccess: {
    color: "#166534",
  },

  summaryRoot: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E9EDF2",
  },

  summaryBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },

  summaryBackIcon: {
    fontSize: 28,
    color: "#111827",
    fontWeight: "700",
    marginTop: -2,
  },

  summaryHeaderTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
  },

  summaryContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
  },

  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },

  summaryCardLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  summaryMapWrap: {
    height: 220,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#F0F4F8",
    marginTop: 4,
  },

  summaryPhotoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  summaryPhotoItem: {
    width: "30%",
    alignItems: "center",
  },

  summaryPhotoThumb: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#F0F4F8",
  },

  summaryPhotoEmpty: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderStyle: "dashed",
  },

  summaryPhotoEmptyIcon: {
    fontSize: 22,
    opacity: 0.4,
  },

  summaryPhotoLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#374151",
    marginTop: 4,
    textAlign: "center",
  },

  summaryPhotoStatus: {
    fontSize: 11,
    fontWeight: "800",
    marginTop: 1,
  },

  summaryPhotoStatusDone: {
    color: "#16A34A",
  },

  summaryPhotoStatusMissing: {
    color: "#D1D5DB",
  },

  summaryCompGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },

  summaryCompCell: {
    width: "33.33%",
    paddingVertical: 8,
    paddingRight: 8,
  },

  summaryCompCount: {
    fontSize: 16,
    fontWeight: "900",
  },

  summaryCompLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: "#6B7280",
    marginTop: 1,
  },

  summaryCompExpected: {
    fontSize: 8,
    color: "#9CA3AF",
  },

  summaryCableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  summaryCableThumb: {
    width: 54,
    height: 44,
    borderRadius: 8,
    backgroundColor: "#F0F4F8",
  },

  summaryCableStats: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },

  summaryCableCell: {
    flex: 1,
  },

  summaryCableCellLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#9CA3AF",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },

  summaryCableCellValue: {
    fontSize: 13,
    fontWeight: "900",
    color: "#111827",
  },

  summaryCtaBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E9EDF2",
  },

  summaryMarkBtn: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },

  summaryMarkBtnText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  confirmCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },

  confirmTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 8,
  },

  confirmBody: {
    fontSize: 14,
    color: "#6B7280",
    lineHeight: 21,
    marginBottom: 24,
  },

  confirmBtnRow: {
    flexDirection: "row",
    gap: 12,
  },

  confirmCancelBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#F1F5F9",
  },

  confirmCancelText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },

  confirmYesBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },

  confirmYesText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
});
