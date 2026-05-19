import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { Stack, useRouter } from "expo-router";
import {
  Box,
  ClipboardCheck,
  ClipboardList,
  MapPin,
  Navigation,
  Plus,
  Search,
  X,
  WifiOff,
  ChevronLeft,
} from "lucide-react-native";
import * as Location from "expo-location";
import { useAuth } from "@/context/auth-context";
import { addToQueue, syncQueue, getQueue } from "@/services/offline";
import {
  getNapBoxes,
  getNapBoxPorts,
  createNapBox,
  countUsedPorts,
  type NapBox,
  type NapPort,
} from "@/services/nap-box";
import { getPoles, createPole, type Pole } from "@/services/pole";
import { cacheGet, cacheSet } from "@/lib/cache";

type NapStatus = "active" | "inactive" | "for_removal";

const STATUS_CONFIG: Record<NapStatus, { label: string; color: string; bg: string }> = {
  active:      { label: "Active",      color: "#059669", bg: "#D1FAE5" },
  inactive:    { label: "Inactive",    color: "#6B7280", bg: "#F3F4F6" },
  for_removal: { label: "For Removal", color: "#D97706", bg: "#FEF3C7" },
};

function NapDetailModal({ box, onClose }: { box: NapBox; onClose: () => void }) {
  const router = useRouter();
  const { token } = useAuth();

  const sc = STATUS_CONFIG[box.status] ?? STATUS_CONFIG.inactive;
  const totalSlots = parseInt(box.port_count);
  const lat = box.pole?.lat ?? "";
  const lng = box.pole?.lng ?? "";
  const barangayName = box.pole?.barangay?.name ?? "—";
  const poleCode = box.pole?.pole_code ?? String(box.pole_id);

  const [ports, setPorts] = useState<NapPort[]>(box.ports ?? []);
  const [portsLoading, setPortsLoading] = useState(!box.ports);
  const [confirmVisible, setConfirmVisible] = useState(false);

  useEffect(() => {
    if (box.ports) return;

    const PORTS_CACHE_KEY = `nap_ports_${box.id}`;
    
    // Check cache first
    cacheGet<NapPort[]>(PORTS_CACHE_KEY).then(cached => {
      if (cached) {
        setPorts(cached);
        setPortsLoading(false);
      }
      
      // Always fetch fresh
      getNapBoxPorts(box.id, token!)
        .then(fresh => {
          setPorts(fresh);
          cacheSet(PORTS_CACHE_KEY, fresh).catch(() => {});
        })
        .catch(() => {})
        .finally(() => setPortsLoading(false));
    });
  }, [box.id, box.ports, token]);

  const usedSlots = countUsedPorts(ports);
  const freeSlots = totalSlots - usedSlots;
  const pct = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
  const barColor = pct >= 100 ? "#EF4444" : pct >= 80 ? "#F59E0B" : "#10B981";

  const getPortColor = (portNum: number) => {
    const port = ports.find((p) => p.port_number === portNum);
    if (!port || port.status === "free") return { core: "#16a34a", ferrule: "#bbf7d0" };
    if (port.status === "inactive") return { core: "#d97706", ferrule: "#fef3c7" };
    return { core: "#dc2626", ferrule: "#fee2e2" };
  };

  const cols = Math.ceil(totalSlots / 2);
  const row1 = Array.from({ length: cols }, (_, i) => i + 1);
  const row2 = totalSlots > cols
    ? Array.from({ length: totalSlots - cols }, (_, i) => cols + i + 1)
    : [];

  const handleConfirmAudit = () => {
    setConfirmVisible(false);
    onClose();
    router.push({
      pathname: "/naps/audit",
      params: {
        napId: box.id,
        napTag: box.nap_code,
        total: String(box.port_count),
        used: String(usedSlots),
      },
    });
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.modalContainer}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderLeft}>
            <View style={styles.modalIconBox}>
              <Box size={22} color="#7C3AED" />
            </View>
            <View>
              <Text style={styles.modalId}>{box.nap_code}</Text>
              <Text style={styles.modalTag}>Pole {poleCode}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <X size={18} color="#64748B" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <View style={[styles.statusDot, { backgroundColor: sc.color }]} />
              <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
            </View>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{box.port_count}-port</Text>
            </View>
          </View>

          <View style={styles.utilCard}>
            <View style={styles.utilTopRow}>
              <Text style={styles.utilCardTitle}>Port Utilization</Text>
              <Text style={[styles.utilPctLabel, { color: barColor }]}>{pct}%</Text>
            </View>
            <View style={styles.utilBarBig}>
              <View style={[styles.utilFillBig, { width: `${pct}%` as any, backgroundColor: barColor }]} />
            </View>
            <View style={styles.utilStatsRow}>
              <View style={styles.utilStat}>
                <Text style={styles.utilStatNum}>{usedSlots}</Text>
                <Text style={styles.utilStatLabel}>Used</Text>
              </View>
              <View style={styles.utilStat}>
                <Text style={[styles.utilStatNum, { color: "#10B981" }]}>{freeSlots}</Text>
                <Text style={styles.utilStatLabel}>Free</Text>
              </View>
              <View style={styles.utilStat}>
                <Text style={styles.utilStatNum}>{totalSlots}</Text>
                <Text style={styles.utilStatLabel}>Total</Text>
              </View>
            </View>
          </View>

          {portsLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <ActivityIndicator size="small" color="#7C3AED" />
              <Text style={{ marginTop: 8, fontSize: 12, color: "#94A3B8" }}>Loading ports...</Text>
            </View>
          ) : (
            <View style={styles.napPanel}>
              <View style={styles.napPanelHeader}>
                <Text style={styles.napPanelId}>{box.nap_code}</Text>
                <Text style={styles.napPanelType}>{box.port_count}-PORT</Text>
              </View>
              <View style={styles.fiberRow}>
                {row1.map((n) => {
                  const c = getPortColor(n);
                  return (
                    <View key={n} style={styles.fiberPort}>
                      <View style={styles.fiberPortInner}>
                        <View style={[styles.fiberPortCore, { backgroundColor: c.core, shadowColor: c.core }]}>
                          <View style={[styles.ferrule, { backgroundColor: c.ferrule }]} />
                        </View>
                      </View>
                      <Text style={styles.fiberPortNum}>{n}</Text>
                    </View>
                  );
                })}
              </View>
              {row2.length > 0 && (
                <View style={styles.fiberRow}>
                  {row2.map((n) => {
                    const c = getPortColor(n);
                    return (
                      <View key={n} style={styles.fiberPort}>
                        <View style={styles.fiberPortInner}>
                          <View style={[styles.fiberPortCore, { backgroundColor: c.core, shadowColor: c.core }]}>
                            <View style={[styles.ferrule, { backgroundColor: c.ferrule }]} />
                          </View>
                        </View>
                        <Text style={styles.fiberPortNum}>{n}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              <View style={styles.napUtilSection}>
                <View style={styles.napUtilLabelRow}>
                  <Text style={styles.napUtilLabel}>UTILIZATION</Text>
                  <Text style={styles.napUtilValue}>{usedSlots}/{totalSlots} ({pct}%)</Text>
                </View>
                <View style={styles.napUtilTrack}>
                  <View style={[styles.napUtilFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
                </View>
              </View>
              <View style={styles.napLegendRow}>
                <View style={styles.napLegendItem}>
                  <View style={[styles.napLegendDot, { backgroundColor: "#dc2626" }]} />
                  <Text style={styles.napLegendText}>Active</Text>
                </View>
                <View style={styles.napLegendItem}>
                  <View style={[styles.napLegendDot, { backgroundColor: "#d97706" }]} />
                  <Text style={styles.napLegendText}>Inactive</Text>
                </View>
                <View style={styles.napLegendItem}>
                  <View style={[styles.napLegendDot, { backgroundColor: "#16a34a" }]} />
                  <Text style={styles.napLegendText}>Free</Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>Location</Text>
            <View style={styles.locGrid}>
              <View style={styles.locCell}>
                <Text style={styles.locCellLabel}>Barangay</Text>
                <Text style={styles.locCellValue}>{barangayName}</Text>
              </View>
              <View style={styles.locCell}>
                <Text style={styles.locCellLabel}>Pole</Text>
                <Text style={styles.locCellValue}>{poleCode}</Text>
              </View>
            </View>
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>Coordinates</Text>
            {lat && lng ? (
              <>
                <View style={styles.coordRow}>
                  <View style={styles.coordItem}>
                    <Text style={styles.coordLabel}>Latitude</Text>
                    <Text style={styles.coordValue}>{lat}</Text>
                  </View>
                  <View style={styles.coordDivider} />
                  <View style={styles.coordItem}>
                    <Text style={styles.coordLabel}>Longitude</Text>
                    <Text style={styles.coordValue}>{lng}</Text>
                  </View>
                </View>
                <View style={styles.mapCard}>
                  <WebView
                    style={styles.mapWebView}
                    originWhitelist={["*"]}
                    scrollEnabled={false}
                    source={{
                      html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><style>html,body,#map{margin:0;padding:0;width:100%;height:100%}.leaflet-control-attribution{display:none!important}</style></head><body><div id="map"></div><script>var map=L.map('map',{zoomControl:false,attributionControl:false}).setView([${lat},${lng}],16);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);L.marker([${lat},${lng}],{icon:L.divIcon({html:'<div style="width:14px;height:14px;background:#7C3AED;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(124,58,237,0.6)"></div>',className:'',iconAnchor:[7,7]})}).addTo(map)</script></body></html>`,
                    }}
                  />
                </View>
                <TouchableOpacity
                  style={styles.mapOpenBtnRow}
                  onPress={() => Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)}
                  activeOpacity={0.85}
                >
                  <Navigation size={14} color="#7C3AED" />
                  <Text style={styles.mapOpenText}>Open in Google Maps</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 10 }}>
                <MapPin size={14} color="#CBD5E1" />
                <Text style={{ fontSize: 13, color: "#94A3B8", fontStyle: "italic" }}>No GPS coordinates recorded</Text>
              </View>
            )}
          </View>
        </ScrollView>

        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={styles.auditBtn}
            onPress={() => setConfirmVisible(true)}
            activeOpacity={0.85}
          >
            <ClipboardCheck size={20} color="#FFFFFF" />
            <Text style={styles.auditBtnText}>Start Audit</Text>
          </TouchableOpacity>
        </View>

        {confirmVisible && (
          <View style={styles.confirmOverlay}>
            <View style={styles.confirmCard}>
              <View style={styles.confirmIconBox}>
                <ClipboardList size={32} color="#7C3AED" />
              </View>
              <Text style={styles.confirmTitle}>Start Audit?</Text>
              <Text style={styles.confirmSubtitle}>You are about to begin a port audit for</Text>
              <View style={styles.confirmNapIdBadge}>
                <Box size={14} color="#7C3AED" />
                <Text style={styles.confirmNapId}>{box.nap_code}</Text>
              </View>
              <Text style={styles.confirmDetail}>{totalSlots} ports · {barangayName}</Text>
              <View style={styles.confirmButtons}>
                <TouchableOpacity
                  style={styles.confirmCancelBtn}
                  onPress={() => setConfirmVisible(false)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.confirmCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmStartBtn}
                  onPress={handleConfirmAudit}
                  activeOpacity={0.85}
                >
                  <ClipboardCheck size={16} color="#FFFFFF" />
                  <Text style={styles.confirmStartText}>Yes, Start</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const PORT_COUNTS: ("8" | "12" | "16" | "32")[] = ["8", "12", "16", "32"];

function AddPoleModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (pole: Pole) => void;
  token: string;
}) {
  const [poleCode, setPoleCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<Pole[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [duplicate, setDuplicate] = useState<Pole | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    setPoleCode(""); setLat(""); setLng(""); setError(null);
    setSearchResults([]); setShowDropdown(false); setDuplicate(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handlePoleCodeChange = (text: string) => {
    setPoleCode(text);
    setDuplicate(null);
    setError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!text.trim()) {
      setSearchResults([]); setShowDropdown(false); return;
    }
    setShowDropdown(true);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await getPoles(token, { search: text.trim() });
        const results = res.data.slice(0, 6);
        setSearchResults(results);
        const exact = results.find(
          (p) => p.pole_code.toLowerCase() === text.trim().toLowerCase()
        );
        setDuplicate(exact ?? null);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
  };

  const handleSelectExisting = (pole: Pole) => {
    setShowDropdown(false);
    setSearchResults([]);
    onCreated(pole);
    reset();
  };

  const handleSubmit = async () => {
    if (!poleCode.trim()) { setError("Pole code is required."); return; }
    if (duplicate) { setError("That pole code already exists. Select it from the dropdown instead."); return; }
    setSaving(true);
    setError(null);
    try {
      const pole = await createPole(token, {
        pole_code: poleCode.trim().toUpperCase(),
        lat: lat.trim() || null,
        lng: lng.trim() || null,
      });
      reset();
      onCreated(pole);
    } catch (e: any) {
      setError(e.message || "Failed to create pole.");
    } finally {
      setSaving(false);
    }
  };

  const isExactMatch = !!duplicate;
  const hasTyped = poleCode.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.modalContainer}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderLeft}>
            <View style={styles.modalIconBox}>
              <MapPin size={22} color="#7C3AED" />
            </View>
            <View>
              <Text style={styles.modalId}>Add New Pole</Text>
              <Text style={styles.modalTag}>Search or register a pole</Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <X size={18} color="#64748B" />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.modalScroll, { gap: 0 }]}
          keyboardShouldPersistTaps="handled"
        >
          {!!error && (
            <View style={fStyles.errorBanner}>
              <Text style={fStyles.errorBannerText}>{error}</Text>
            </View>
          )}

          {/* Pole Code with live search */}
          <Text style={fStyles.label}>Pole Code *</Text>
          <View style={[
            fStyles.poleSearchBox,
            { marginBottom: 0 },
            isExactMatch && { borderColor: "#F59E0B", backgroundColor: "#FFFBEB" },
          ]}>
            <Search size={14} color={isExactMatch ? "#F59E0B" : "#94A3B8"} />
            <TextInput
              style={fStyles.poleSearchInput}
              value={poleCode}
              onChangeText={handlePoleCodeChange}
              placeholder="e.g. PL-0001"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color="#7C3AED" />}
            {!searching && hasTyped && (
              <TouchableOpacity onPress={() => { setPoleCode(""); setSearchResults([]); setShowDropdown(false); setDuplicate(null); }}>
                <X size={14} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Duplicate warning */}
          {isExactMatch && (
            <View style={fStyles.duplicateWarning}>
              <Text style={fStyles.duplicateWarningText}>
                ⚠ This pole already exists. Tap it below to use it.
              </Text>
            </View>
          )}

          {/* Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <View style={fStyles.poleDropdown}>
              <View style={fStyles.dropdownHeader}>
                <Text style={fStyles.dropdownHeaderText}>Existing poles</Text>
              </View>
              {searchResults.map((pole, idx) => {
                const isMatch = pole.pole_code.toLowerCase() === poleCode.trim().toLowerCase();
                return (
                  <TouchableOpacity
                    key={pole.id}
                    style={[
                      fStyles.poleDropdownItem,
                      idx === searchResults.length - 1 && { borderBottomWidth: 0 },
                      isMatch && fStyles.poleDropdownItemMatch,
                    ]}
                    onPress={() => handleSelectExisting(pole)}
                    activeOpacity={0.7}
                  >
                    <MapPin size={13} color={isMatch ? "#D97706" : "#7C3AED"} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[fStyles.poleItemCode, isMatch && { color: "#D97706" }]}>
                          {pole.pole_code}
                        </Text>
                        {isMatch && (
                          <View style={fStyles.existsBadge}>
                            <Text style={fStyles.existsBadgeText}>Already exists</Text>
                          </View>
                        )}
                      </View>
                      {pole.barangay && (
                        <Text style={fStyles.poleItemBarangay}>{pole.barangay.name}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* No results hint */}
          {showDropdown && !searching && searchResults.length === 0 && (
            <View style={fStyles.noResultsHint}>
              <Text style={fStyles.noResultsHintText}>No existing poles match — fill in details below to create.</Text>
            </View>
          )}

          {/* Coordinates — only show when not a duplicate */}
          {!isExactMatch && (
            <>
              <View style={[fStyles.row, { marginTop: 16 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={fStyles.label}>Latitude</Text>
                  <TextInput
                    style={fStyles.input}
                    value={lat}
                    onChangeText={setLat}
                    placeholder="14.5547"
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={fStyles.label}>Longitude</Text>
                  <TextInput
                    style={fStyles.input}
                    value={lng}
                    onChangeText={setLng}
                    placeholder="121.0244"
                    placeholderTextColor="#94A3B8"
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.modalFooter}>
          {isExactMatch ? (
            <TouchableOpacity
              style={[styles.auditBtn, { backgroundColor: "#D97706" }]}
              onPress={() => handleSelectExisting(duplicate!)}
              activeOpacity={0.85}
            >
              <MapPin size={20} color="#FFFFFF" />
              <Text style={styles.auditBtnText}>Use Existing Pole</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.auditBtn, saving && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Plus size={20} color="#FFFFFF" />}
              <Text style={styles.auditBtnText}>{saving ? "Saving…" : "Create New Pole"}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

function AddNapBoxModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (box: NapBox) => void;
  token: string;
}) {
  const [napCode, setNapCode]       = useState("");
  const [portCount, setPortCount]   = useState<"8" | "12" | "16" | "32">("16");
  const [status, setStatus]         = useState<"active" | "inactive">("active");
  const [selectedPole, setSelectedPole] = useState<Pole | null>(null);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // Inline dropdown state
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [poleSearch, setPoleSearch]     = useState("");
  const [allPoles, setAllPoles]         = useState<Pole[]>([]);
  const [polesLoading, setPolesLoading] = useState(false);
  const [polesPage, setPolesPage]       = useState(1);
  const [polesLastPage, setPolesLastPage] = useState(1);
  const [polesLoadingMore, setPolesLoadingMore] = useState(false);
  const [addPoleVisible, setAddPoleVisible] = useState(false);
  const [inlineCreatePole, setInlineCreatePole] = useState(false);
  const [newPoleCode, setNewPoleCode] = useState("");
  const [newPoleLat, setNewPoleLat] = useState("");
  const [newPoleLng, setNewPoleLng] = useState("");
  const [newPoleSaving, setNewPoleSaving] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [showInlineMap, setShowInlineMap] = useState(false);
  const [showSelectedPoleMap, setShowSelectedPoleMap] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<TextInput>(null);

  const captureGps = async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setError("Location permission denied."); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const lat = pos.coords.latitude.toFixed(7);
      const lng = pos.coords.longitude.toFixed(7);
      setNewPoleLat(lat);
      setNewPoleLng(lng);
      setShowInlineMap(true);
    } catch (e: any) {
      setError(e.message || "Failed to get location.");
    } finally {
      setGpsLoading(false);
    }
  };

  const loadPoles = useCallback(async (q: string, pg: number, replace: boolean) => {
    if (pg === 1) setPolesLoading(true); else setPolesLoadingMore(true);
    try {
      const res = await getPoles(token, { search: q.trim() || undefined, page: pg });
      setAllPoles(prev => replace ? res.data : [...prev, ...res.data]);
      setPolesLastPage(res.meta?.last_page ?? res.last_page ?? 1);
      setPolesPage(pg);
    } catch { /* keep list */ }
    finally {
      setPolesLoading(false);
      setPolesLoadingMore(false);
    }
  }, [token]);

  useEffect(() => {
    if (visible) {
      setAllPoles([]);
      setPoleSearch("");
      loadPoles("", 1, true);
    }
  }, [visible, loadPoles]);

  const handleOpenDropdown = () => {
    setDropdownOpen(true);
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  const handlePoleSearch = (text: string) => {
    setPoleSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadPoles(text, 1, true), 300);
  };

  const handlePickPole = (pole: Pole) => {
    setSelectedPole(pole);
    setDropdownOpen(false);
    setPoleSearch("");
    setShowSelectedPoleMap(!!(pole.lat && pole.lng));
  };

  const handleLoadMorePoles = () => {
    if (!polesLoadingMore && polesPage < polesLastPage)
      loadPoles(poleSearch, polesPage + 1, false);
  };

  const handlePoleCreated = (pole: Pole) => {
    setAddPoleVisible(false);
    setSelectedPole(pole);
    setDropdownOpen(false);
    setAllPoles(prev => [pole, ...prev]);
  };

  const handleInlinePoleSubmit = async () => {
    if (!newPoleCode.trim()) { setError("Pole Code is required."); return; }
    setNewPoleSaving(true); setError(null);
    try {
      const payload = {
        pole_code: newPoleCode.trim().toUpperCase(),
        lat: newPoleLat.trim() || null,
        lng: newPoleLng.trim() || null,
      };
      
      let pole;
      try {
        pole = await createPole(token, payload);
      } catch (err: any) {
        if (err.message === "Network request failed" || err.message.includes("fetch")) {
          // Offline fallback
          const localId = await addToQueue('CREATE_POLE', payload);
          pole = { id: localId as any, pole_code: payload.pole_code, lat: payload.lat, lng: payload.lng } as Pole;
        } else {
          throw err;
        }
      }

      setAllPoles(prev => [pole, ...prev]);
      setSelectedPole(pole);
      setShowSelectedPoleMap(!!(pole.lat && pole.lng));
      setInlineCreatePole(false);
      setNewPoleCode(""); setNewPoleLat(""); setNewPoleLng("");
    } catch (e: any) {
      setError(e.message || "Failed to create pole.");
    } finally {
      setNewPoleSaving(false);
    }
  };

  const handleStartInlinePole = () => {
    setDropdownOpen(false); 
    setInlineCreatePole(true);
  };

  const reset = () => {
    setNapCode(""); setPortCount("16"); setStatus("active");
    setSelectedPole(null); setError(null);
    setDropdownOpen(false); setPoleSearch("");
    setInlineCreatePole(false);
    setNewPoleCode(""); setNewPoleLat(""); setNewPoleLng("");
    setShowInlineMap(false); setShowSelectedPoleMap(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!selectedPole) { setError("Please select a pole first."); return; }
    if (!napCode.trim()) { setError("NAP code is required."); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        pole_id: selectedPole.id,
        nap_code: napCode.trim().toUpperCase(),
        port_count: portCount,
        status,
      };

      let box;
      try {
        box = await createNapBox(token, payload);
      } catch (err: any) {
        if (err.message === "Network request failed" || err.message.includes("fetch")) {
          // Offline fallback
          await addToQueue('CREATE_NAPBOX', payload);
          box = { id: Date.now(), ...payload, ports: [] } as any;
        } else {
          throw err;
        }
      }

      reset();
      onCreated(box);
    } catch (e: any) {
      setError(e.message || "Failed to create NAP box.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.modalContainer}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderLeft}>
              <View style={styles.modalIconBox}>
                <Box size={22} color="#7C3AED" />
              </View>
              <View>
                <Text style={styles.modalId}>Add NAP Box</Text>
                <Text style={styles.modalTag}>Register a new NAP box</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <X size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={[styles.modalScroll, { gap: 0 }]}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {!!error && (
              <View style={fStyles.errorBanner}>
                <Text style={fStyles.errorBannerText}>{error}</Text>
              </View>
            )}

            {/* ── Pole ── */}
            <Text style={fStyles.sectionLabel}>Pole</Text>

            {inlineCreatePole ? (
              <View style={pStyles.inlineFormPanel}>
                <View style={pStyles.inlineFormHeader}>
                  <MapPin size={16} color="#7C3AED" />
                  <Text style={pStyles.inlineFormTitle}>Create New Pole</Text>
                  <TouchableOpacity onPress={() => { setInlineCreatePole(false); setError(null); }} style={pStyles.inlineFormClose}>
                    <X size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
                <Text style={fStyles.label}>Pole Code *</Text>
                <TextInput
                  style={fStyles.input}
                  value={newPoleCode}
                  onChangeText={setNewPoleCode}
                  placeholder="e.g. PL-0001"
                  placeholderTextColor="#94A3B8"
                  autoCapitalize="characters"
                />

                {/* GPS Capture */}
                <Text style={fStyles.label}>GPS Coordinates</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                  <TouchableOpacity
                    style={pStyles.gpsCaptureBtn}
                    onPress={captureGps}
                    disabled={gpsLoading}
                    activeOpacity={0.8}
                  >
                    {gpsLoading
                      ? <ActivityIndicator size="small" color="#7C3AED" />
                      : <Navigation size={15} color="#7C3AED" />}
                    <Text style={pStyles.gpsCaptureBtnText}>
                      {gpsLoading ? "Locating…" : "Capture GPS"}
                    </Text>
                  </TouchableOpacity>

                  {newPoleLat && newPoleLng ? (
                    <TouchableOpacity
                      style={pStyles.gpsMapToggleBtn}
                      onPress={() => setShowInlineMap(v => !v)}
                      activeOpacity={0.8}
                    >
                      <MapPin size={14} color={showInlineMap ? "#7C3AED" : "#64748B"} />
                      <Text style={[pStyles.gpsMapToggleBtnText, showInlineMap && { color: "#7C3AED" }]}>
                        {showInlineMap ? "Hide Map" : "View Map"}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={fStyles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={fStyles.label}>Latitude</Text>
                    <TextInput style={[fStyles.input, { marginBottom: 0 }]} value={newPoleLat} onChangeText={v => { setNewPoleLat(v); setShowInlineMap(false); }} placeholder="Optional" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={fStyles.label}>Longitude</Text>
                    <TextInput style={[fStyles.input, { marginBottom: 0 }]} value={newPoleLng} onChangeText={v => { setNewPoleLng(v); setShowInlineMap(false); }} placeholder="Optional" placeholderTextColor="#94A3B8" keyboardType="decimal-pad" />
                  </View>
                </View>

                {/* WebView Map */}
                {showInlineMap && newPoleLat && newPoleLng ? (
                  <View style={pStyles.mapContainer}>
                    <WebView
                      style={{ flex: 1, borderRadius: 14 }}
                      source={{
                        html: `<!DOCTYPE html><html><head>
                          <meta name="viewport" content="width=device-width,initial-scale=1">
                          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                          <style>*{margin:0;padding:0}html,body,#map{width:100%;height:100vh}</style>
                        </head><body>
                          <div id="map"></div>
                          <script>
                            var map=L.map('map').setView([${newPoleLat},${newPoleLng}],17);
                            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri'}).addTo(map);
                            var icon=L.divIcon({html:'<div style="width:18px;height:18px;border-radius:50%;background:#7c3aed;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>',className:'',iconSize:[18,18],iconAnchor:[9,9]});
                            L.marker([${newPoleLat},${newPoleLng}],{icon}).addTo(map);
                          </script>
                        </body></html>`,
                      }}
                      javaScriptEnabled
                      domStorageEnabled
                      originWhitelist={["*"]}
                      scrollEnabled={false}
                    />
                    <View style={pStyles.mapCoordBadge}>
                      <Text style={pStyles.mapCoordText}>
                        {parseFloat(newPoleLat).toFixed(5)}, {parseFloat(newPoleLng).toFixed(5)}
                      </Text>
                    </View>
                  </View>
                ) : null}

                <TouchableOpacity style={[styles.auditBtn, { marginTop: 12, paddingVertical: 14 }]} onPress={handleInlinePoleSubmit} disabled={newPoleSaving}>
                  {newPoleSaving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.auditBtnText}>Save Pole</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[pStyles.dropdownTrigger, dropdownOpen && pStyles.dropdownTriggerOpen]}
                onPress={dropdownOpen ? () => setDropdownOpen(false) : handleOpenDropdown}
                activeOpacity={0.8}
              >
                {selectedPole ? (
                  <>
                    <View style={pStyles.dropdownTriggerIcon}>
                      <MapPin size={14} color="#7C3AED" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={pStyles.dropdownTriggerValue}>{selectedPole.pole_code}</Text>
                      {selectedPole.barangay ? (
                        <Text style={pStyles.dropdownTriggerSub}>{selectedPole.barangay.name}</Text>
                      ) : null}
                    </View>
                    {selectedPole.lat && selectedPole.lng ? (
                      <TouchableOpacity
                        onPress={e => { e.stopPropagation?.(); setShowSelectedPoleMap(v => !v); }}
                        style={[pStyles.gpsMapToggleBtn, { marginRight: 6 }]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <MapPin size={13} color={showSelectedPoleMap ? "#7C3AED" : "#64748B"} />
                        <Text style={[pStyles.gpsMapToggleBtnText, showSelectedPoleMap && { color: "#7C3AED" }]}>
                          {showSelectedPoleMap ? "Hide" : "Map"}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </>
                ) : (
                  <>
                    <MapPin size={15} color="#94A3B8" />
                    <Text style={pStyles.dropdownTriggerPlaceholder}>Select a pole…</Text>
                  </>
                )}
                <Text style={[pStyles.dropdownChevron, dropdownOpen && { transform: [{ rotate: "180deg" }] }]}>
                  v
                </Text>
              </TouchableOpacity>
            )}

            {/* Selected pole map — shown when a pole with coordinates is picked */}
            {!inlineCreatePole && selectedPole && selectedPole.lat && selectedPole.lng && showSelectedPoleMap && (
              <View style={[pStyles.mapContainer, { marginTop: -6, borderTopLeftRadius: 0, borderTopRightRadius: 0 }]}>
                <WebView
                  style={{ flex: 1 }}
                  source={{
                    html: `<!DOCTYPE html><html><head>
                      <meta name="viewport" content="width=device-width,initial-scale=1">
                      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
                      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                      <style>*{margin:0;padding:0}html,body,#map{width:100%;height:100vh}</style>
                    </head><body>
                      <div id="map"></div>
                      <script>
                        var map=L.map('map').setView([${selectedPole.lat},${selectedPole.lng}], 17);
                        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri'}).addTo(map);
                        var icon=L.divIcon({html:'<div style="width:18px;height:18px;border-radius:50%;background:#7c3aed;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>',className:'',iconSize:[18,18],iconAnchor:[9,9]});
                        L.marker([${selectedPole.lat},${selectedPole.lng}],{icon}).addTo(map);
                      </script>
                    </body></html>`,
                  }}
                  javaScriptEnabled
                  domStorageEnabled
                  originWhitelist={["*"]}
                  scrollEnabled={false}
                />
                <View style={pStyles.mapCoordBadge}>
                  <Text style={pStyles.mapCoordText}>
                    {parseFloat(selectedPole.lat).toFixed(5)}, {parseFloat(selectedPole.lng).toFixed(5)}
                  </Text>
                </View>
              </View>
            )}

            {/* Inline dropdown panel */}
            {dropdownOpen && (
              <View style={pStyles.dropdownPanel}>
                {/* Search */}
                <View style={pStyles.dropdownSearch}>
                  <Search size={13} color="#94A3B8" />
                  <TextInput
                    ref={searchRef}
                    style={pStyles.dropdownSearchInput}
                    value={poleSearch}
                    onChangeText={handlePoleSearch}
                    placeholder="Search pole code or barangay..."
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  {polesLoading
                    ? <ActivityIndicator size="small" color="#7C3AED" />
                    : poleSearch.length > 0
                      ? <TouchableOpacity onPress={() => handlePoleSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <X size={13} color="#94A3B8" />
                        </TouchableOpacity>
                      : null}
                </View>

                {/* Add New Pole row — always first */}
                <TouchableOpacity
                  style={pStyles.addPoleRow}
                  onPress={handleStartInlinePole}
                  activeOpacity={0.75}
                >
                  <View style={pStyles.addPoleRowIcon}>
                    <Plus size={13} color="#7C3AED" />
                  </View>
                  <Text style={pStyles.addPoleRowText}>Add New Pole</Text>
                </TouchableOpacity>

                <View style={pStyles.dropdownDivider} />

                {/* Poles list */}
                {polesLoading && allPoles.length === 0 ? (
                  <View style={{ paddingVertical: 20, alignItems: "center" }}>
                    <ActivityIndicator size="small" color="#7C3AED" />
                    <Text style={{ marginTop: 8, fontSize: 12, color: "#94A3B8" }}>Loading poles...</Text>
                  </View>
                ) : allPoles.length === 0 ? (
                  <View style={{ paddingVertical: 20, alignItems: "center" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: "#94A3B8" }}>
                      {poleSearch.trim() ? `No results for "${poleSearch}"` : "No poles found"}
                    </Text>
                  </View>
                ) : (
                  <>
                    {allPoles.map((pole, idx) => (
                      <TouchableOpacity
                        key={pole.id}
                        style={[
                          pStyles.dropdownItem,
                          idx === allPoles.length - 1 && { borderBottomWidth: 0 },
                          selectedPole?.id === pole.id && pStyles.dropdownItemSelected,
                        ]}
                        onPress={() => handlePickPole(pole)}
                        activeOpacity={0.7}
                      >
                        <View style={[
                          pStyles.dropdownItemDot,
                          selectedPole?.id === pole.id && { backgroundColor: "#7C3AED" },
                        ]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[
                            pStyles.dropdownItemCode,
                            selectedPole?.id === pole.id && { color: "#7C3AED" },
                          ]}>
                            {pole.pole_code}
                          </Text>
                          {pole.barangay ? (
                            <Text style={pStyles.dropdownItemSub}>{pole.barangay.name}</Text>
                          ) : pole.lat && pole.lng ? (
                            <Text style={pStyles.dropdownItemSub}>{pole.lat}, {pole.lng}</Text>
                          ) : null}
                        </View>
                        {selectedPole?.id === pole.id && (
                          <Text style={{ color: "#7C3AED", fontSize: 16, fontWeight: "800" }}>✓</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                    {polesPage < polesLastPage && (
                      <TouchableOpacity
                        style={pStyles.loadMoreBtn}
                        onPress={handleLoadMorePoles}
                        disabled={polesLoadingMore}
                        activeOpacity={0.7}
                      >
                        {polesLoadingMore
                          ? <ActivityIndicator size="small" color="#7C3AED" />
                          : <Text style={pStyles.loadMoreText}>Load more poles...</Text>}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            )}

            {/* -- NAP Box Details -- */}
            <Text style={[fStyles.sectionLabel, { marginTop: 24 }]}>NAP Box Details</Text>

            <Text style={fStyles.label}>NAP Code *</Text>
            <TextInput
              style={fStyles.input}
              value={napCode}
              onChangeText={setNapCode}
              placeholder="e.g. NAP-001"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
            />

            <Text style={[fStyles.label, { marginTop: 16 }]}>Port Count</Text>
            <View style={fStyles.optionRow}>
              {PORT_COUNTS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[fStyles.optionBtn, portCount === opt && fStyles.optionBtnActive]}
                  onPress={() => setPortCount(opt)}
                >
                  <Text style={[fStyles.optionBtnText, portCount === opt && fStyles.optionBtnTextActive]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[fStyles.label, { marginTop: 16 }]}>Status</Text>
            <View style={fStyles.optionRow}>
              {(["active", "inactive"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[fStyles.optionBtn, { flex: 1 }, status === s && fStyles.optionBtnActive]}
                  onPress={() => setStatus(s)}
                >
                  <View style={[fStyles.statusDot, { backgroundColor: s === "active" ? "#059669" : "#6B7280" }]} />
                  <Text style={[fStyles.optionBtnText, status === s && fStyles.optionBtnTextActive]}>
                    {s === "active" ? "Active" : "Inactive"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[styles.auditBtn, saving && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Plus size={20} color="#FFFFFF" />}
              <Text style={styles.auditBtnText}>{saving ? "Saving..." : "Create NAP Box"}</Text>
            </TouchableOpacity>
          </View>

        </View>
      </Modal>

      <AddPoleModal
        visible={addPoleVisible}
        onClose={() => setAddPoleVisible(false)}
        onCreated={handlePoleCreated}
        token={token}
      />
    </>
  );
}

export default function NapsScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [napBoxes, setNapBoxes] = useState<NapBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NapBox | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  const fetchNapBoxes = useCallback(
    async (isRefresh = false) => {
      const CACHE_KEY = "nap_boxes_cache";

      if (isRefresh) setRefreshing(true);
      else {
        // Instant load from cache
        const cached = await cacheGet<NapBox[]>(CACHE_KEY);
        if (cached) {
          setNapBoxes(cached);
          setLoading(false);
        } else {
          setLoading(true);
        }
      }
      
      setError(null);
      
      // Attempt sync before fetching if online
      try {
        if (token) {
          await syncQueue(token);
          const q = await getQueue();
          setPendingSync(q.length);
        }
      } catch (e) {
        console.log("Sync failed silently", e);
      }

      try {
        const res = await getNapBoxes(token!);
        setNapBoxes(res.data);
        cacheSet(CACHE_KEY, res.data).catch(() => {});
      } catch (e: any) {
        // If we have cache, don't show full error
        const cached = await cacheGet<NapBox[]>(CACHE_KEY);
        if (!cached) {
          setError(e.message || "Failed to load NAP boxes.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    fetchNapBoxes();
  }, [fetchNapBoxes]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return napBoxes;
    return napBoxes.filter(
      (b) =>
        b.nap_code.toLowerCase().includes(q) ||
        (b.pole?.pole_code ?? "").toLowerCase().includes(q) ||
        (b.pole?.barangay?.name ?? "").toLowerCase().includes(q)
    );
  }, [search, napBoxes]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      
      <View style={styles.floatingHeader}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={22} color="#111827" />
        </TouchableOpacity>
        <View style={styles.floatingHeaderText}>
          <Text style={styles.headerTitle}>NAP Inventory</Text>
          <Text style={styles.headerSub}>Skycable Network</Text>
        </View>
      </View>

      <View style={styles.searchWrapper}>
        <View style={styles.searchBox}>
          <Search size={16} color="#94A3B8" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search NAP code, pole, barangay..."
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <X size={15} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          {!loading && !error && (
            <Text style={styles.resultCount}>
              {filtered.length} box{filtered.length !== 1 ? "es" : ""}
            </Text>
          )}
          {pendingSync > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEF3C7", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
              <WifiOff size={12} color="#D97706" />
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#D97706" }}>{pendingSync} pending upload</Text>
            </View>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.centerText}>Loading NAP boxes...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorTitle}>Failed to load</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : napBoxes.length === 0 ? (
        <View style={styles.centerState}>
          <Box size={44} color="#CBD5E1" />
          <Text style={styles.centerTitle}>No NAP boxes found</Text>
          <Text style={styles.centerText}>No NAP boxes are registered yet.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(b) => String(b.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchNapBoxes(true)}
              colors={["#7C3AED"]}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerState}>
              <Box size={40} color="#CBD5E1" />
              <Text style={styles.centerTitle}>No matches</Text>
              <Text style={styles.centerText}>Try a different search term.</Text>
            </View>
          }
          renderItem={({ item: b }) => {
            const sc = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.inactive;
            const totalSlots = parseInt(b.port_count);
            const usedSlots = b.ports ? countUsedPorts(b.ports) : 0;
            const pct = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
            const barColor = pct >= 100 ? "#EF4444" : pct >= 80 ? "#F59E0B" : "#10B981";
            const poleCode = b.pole?.pole_code ?? String(b.pole_id);
            const barangay = b.pole?.barangay?.name ?? " -- ";

            const cols = Math.ceil(totalSlots / 2);
            const row1 = Array.from({ length: cols }, (_, i) => i);
            const row2 = Array.from({ length: totalSlots - cols }, (_, i) => cols + i);
            const getPortColor = (i: number) => {
              if (!b.ports) return i < usedSlots ? "#dc2626" : "#16a34a";
              const port = b.ports.find((p) => p.port_number === i + 1);
              if (!port || port.status === "free") return "#16a34a";
              if (port.status === "inactive") return "#d97706";
              return "#dc2626";
            };

            return (
              <TouchableOpacity style={styles.card} onPress={() => setSelected(b)} activeOpacity={0.75}>
                <View style={styles.cardTopRow}>
                  <View style={styles.cardIconBox}>
                    <Box size={22} color="#7C3AED" />
                  </View>
                  <View style={styles.cardTitleBlock}>
                    <Text style={styles.cardId}>{b.nap_code}</Text>
                    <Text style={styles.cardTag}>Pole {poleCode}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                    <View style={[styles.statusDot, { backgroundColor: sc.color }]} />
                    <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
                  </View>
                </View>

                <View style={styles.cardDivider} />

                <View style={styles.cardMetaRow}>
                  <View style={styles.cardMetaItem}>
                    <Text style={styles.cardMetaLabel}>Ports</Text>
                    <Text style={styles.cardMetaValue}>{b.port_count}</Text>
                  </View>
                  <View style={styles.cardMetaDot} />
                  <View style={styles.cardMetaItem}>
                    <Text style={styles.cardMetaLabel}>Used</Text>
                    <Text style={styles.cardMetaValue}>{usedSlots}</Text>
                  </View>
                  <View style={styles.cardMetaDot} />
                  <View style={styles.cardMetaItem}>
                    <Text style={styles.cardMetaLabel}>Free</Text>
                    <Text style={styles.cardMetaValue}>{totalSlots - usedSlots}</Text>
                  </View>
                </View>

                <View style={styles.cardLocationRow}>
                  <MapPin size={11} color="#94A3B8" />
                  <Text style={styles.cardLocationText}>{barangay}</Text>
                </View>

                <View style={styles.cardNapPanel}>
                  <View style={styles.cardNapHeader}>
                    <Text style={styles.cardNapId}>{b.nap_code}</Text>
                    <Text style={styles.cardNapType}>{b.port_count}-PORT</Text>
                  </View>
                  <View style={styles.cardFiberRow}>
                    {row1.map((i) => (
                      <View key={i} style={styles.cardFiberPort}>
                        <View style={[styles.cardFiberCore, { backgroundColor: getPortColor(i) }]}>
                          <View style={styles.cardFerrule} />
                        </View>
                      </View>
                    ))}
                  </View>
                  {row2.length > 0 && (
                    <View style={styles.cardFiberRow}>
                      {row2.map((i) => (
                        <View key={i} style={styles.cardFiberPort}>
                          <View style={[styles.cardFiberCore, { backgroundColor: getPortColor(i) }]}>
                            <View style={styles.cardFerrule} />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={styles.cardNapUtilRow}>
                    <Text style={styles.cardNapUtilLabel}>UTILIZATION</Text>
                    <Text style={styles.cardNapUtilValue}>{usedSlots}/{totalSlots} ({pct}%)</Text>
                  </View>
                  <View style={styles.cardNapUtilTrack}>
                    <View style={[styles.cardNapUtilFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setAddVisible(true)}
        activeOpacity={0.85}
      >
        <Plus size={26} color="#FFFFFF" />
      </TouchableOpacity>

      {selected && (
        <NapDetailModal box={selected} onClose={() => setSelected(null)} />
      )}

      <AddNapBoxModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onCreated={(box) => {
          setNapBoxes((prev) => [box, ...prev]);
          setAddVisible(false);
        }}
        token={token!}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: "#F8FAFC" },
  floatingHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12, backgroundColor: "#F8FAFC", zIndex: 20 },
  backBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E7ECF2", alignItems: "center", justifyContent: "center", shadowColor: "#101828", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  floatingHeaderText: { flex: 1 },
  headerTitle: { fontSize: 19, fontWeight: "900", color: "#111827" },
  headerSub: { marginTop: 2, fontSize: 12, color: "#667085", fontWeight: "600" },

  searchWrapper:    { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#F1F5F9", gap: 8 },
  poleSearchRow:    { flexDirection: "row", gap: 8 },
  poleInputBox:     { flex: 1, flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  poleInput:        { flex: 1, fontSize: 14, color: "#0F172A", padding: 0 },
  loadBtn:          { backgroundColor: "#7C3AED", borderRadius: 12, paddingHorizontal: 18, justifyContent: "center" },
  loadBtnText:      { fontSize: 13, fontWeight: "800", color: "#FFFFFF" },
  searchBox:        { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput:      { flex: 1, fontSize: 14, color: "#0F172A", padding: 0 },
  resultCount:      { fontSize: 11, fontWeight: "600", color: "#94A3B8" },

  list:             { padding: 16, gap: 14 },

  centerState:      { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, paddingHorizontal: 32 },
  centerTitle:      { fontSize: 16, fontWeight: "800", color: "#0F172A", marginTop: 16, textAlign: "center" },
  centerText:       { fontSize: 13, color: "#64748B", marginTop: 6, textAlign: "center", lineHeight: 20 },
  errorTitle:       { fontSize: 16, fontWeight: "800", color: "#DC2626", marginBottom: 6 },
  errorText:        { fontSize: 13, color: "#64748B", textAlign: "center" },

  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  cardTopRow:       { flexDirection: "row", alignItems: "center", gap: 12 },
  cardIconBox:      { width: 46, height: 46, borderRadius: 14, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  cardTitleBlock:   { flex: 1 },
  cardId:           { fontSize: 15, fontWeight: "800", color: "#7C3AED", fontFamily: "monospace" },
  cardTag:          { fontSize: 12, fontWeight: "600", color: "#94A3B8", marginTop: 1 },
  cardDivider:      { height: 1, backgroundColor: "#F1F5F9", marginVertical: 14 },
  cardMetaRow:      { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  cardMetaItem:     { flex: 1, alignItems: "center" },
  cardMetaLabel:    { fontSize: 10, fontWeight: "600", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.4 },
  cardMetaValue:    { fontSize: 13, fontWeight: "800", color: "#0F172A", marginTop: 2 },
  cardMetaDot:      { width: 1, height: 28, backgroundColor: "#F1F5F9" },
  cardLocationRow:  { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 14 },
  cardLocationText: { fontSize: 11, fontWeight: "500", color: "#94A3B8" },

  statusBadge:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  statusDot:        { width: 6, height: 6, borderRadius: 3 },
  statusText:       { fontSize: 12, fontWeight: "700" },
  typeBadge:        { backgroundColor: "#F1F5F9", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99 },
  typeBadgeText:    { fontSize: 12, fontWeight: "600", color: "#475569" },

  // Modal
  modalContainer:   { flex: 1, backgroundColor: "#FFFFFF" },
  modalHandle:      { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", alignSelf: "center", marginTop: 12, marginBottom: 4 },
  modalHeader:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  modalHeaderLeft:  { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  modalIconBox:     { width: 46, height: 46, borderRadius: 14, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center" },
  modalId:          { fontSize: 18, fontWeight: "800", color: "#7C3AED" },
  modalTag:         { fontSize: 12, fontWeight: "600", color: "#94A3B8", marginTop: 2 },
  closeBtn:         { backgroundColor: "#F1F5F9", borderRadius: 20, padding: 8 },
  modalScroll:      { padding: 20, gap: 14, paddingBottom: 32 },

  badgeRow:         { flexDirection: "row", gap: 8, flexWrap: "wrap" },

  utilCard:         { backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#F1F5F9" },
  utilTopRow:       { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  utilCardTitle:    { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  utilPctLabel:     { fontSize: 20, fontWeight: "900" },
  utilBarBig:       { height: 10, borderRadius: 5, backgroundColor: "#E2E8F0", overflow: "hidden", marginBottom: 16 },
  utilFillBig:      { height: "100%", borderRadius: 5 },
  utilStatsRow:     { flexDirection: "row", justifyContent: "space-around" },
  utilStat:         { alignItems: "center" },
  utilStatNum:      { fontSize: 22, fontWeight: "900", color: "#0F172A" },
  utilStatLabel:    { fontSize: 11, fontWeight: "600", color: "#94A3B8", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 },

  detailCard:       { backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: "#F1F5F9" },
  sectionTitle:     { fontSize: 11, fontWeight: "800", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },

  locGrid:          { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  locCell:          { flex: 1, minWidth: "45%", backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#F1F5F9" },
  locCellLabel:     { fontSize: 10, fontWeight: "700", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  locCellValue:     { fontSize: 14, fontWeight: "800", color: "#0F172A" },

  coordRow:         { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  coordItem:        { flex: 1, alignItems: "center" },
  coordLabel:       { fontSize: 10, fontWeight: "700", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  coordValue:       { fontSize: 15, fontWeight: "800", color: "#0F172A", letterSpacing: -0.3 },
  coordDivider:     { width: 1, height: 36, backgroundColor: "#E2E8F0", marginHorizontal: 8 },

  mapCard:          { borderRadius: 14, overflow: "hidden", height: 200, backgroundColor: "#EDE9FE", marginBottom: 10 },
  mapWebView:       { flex: 1, borderRadius: 14 },
  mapOpenBtnRow:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#EDE9FE", borderRadius: 12, paddingVertical: 10 },
  mapOpenText:      { fontSize: 13, fontWeight: "700", color: "#7C3AED" },

  modalFooter:      { padding: 20, paddingBottom: 32, borderTopWidth: 1, borderTopColor: "#F1F5F9", alignItems: "center" },
  auditBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: "#7C3AED", borderRadius: 16, paddingVertical: 16, paddingHorizontal: 48, shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 6 },
  auditBtnText:     { fontSize: 16, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.3 },

  confirmOverlay:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24, zIndex: 99 },
  confirmCard:      { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 28, alignItems: "center", width: "100%", shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.15, shadowRadius: 32, elevation: 12 },
  confirmIconBox:   { width: 72, height: 72, borderRadius: 24, backgroundColor: "#EDE9FE", alignItems: "center", justifyContent: "center", marginBottom: 16 },
  confirmTitle:     { fontSize: 22, fontWeight: "900", color: "#0F172A", marginBottom: 8 },
  confirmSubtitle:  { fontSize: 14, fontWeight: "500", color: "#64748B", textAlign: "center", marginBottom: 12 },
  confirmNapIdBadge:{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EDE9FE", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8 },
  confirmNapId:     { fontSize: 16, fontWeight: "800", color: "#7C3AED" },
  confirmDetail:    { fontSize: 12, fontWeight: "600", color: "#94A3B8", marginBottom: 24 },
  confirmButtons:   { flexDirection: "row", gap: 12, width: "100%" },
  confirmCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#E2E8F0", alignItems: "center" },
  confirmCancelText:{ fontSize: 15, fontWeight: "700", color: "#64748B" },
  confirmStartBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#7C3AED", shadowColor: "#7C3AED", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  confirmStartText: { fontSize: 15, fontWeight: "800", color: "#FFFFFF" },

  // Fiber Panel
  napPanel:         { backgroundColor: "#191919", borderRadius: 18, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 6 },
  napPanelHeader:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  napPanelId:       { fontFamily: "monospace", fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.4)", letterSpacing: 2, textTransform: "uppercase" },
  napPanelType:     { fontFamily: "monospace", fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.3)", letterSpacing: 1 },
  fiberRow:         { flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  fiberPort:        { width: 36, height: 36, borderRadius: 7, backgroundColor: "#101010", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  fiberPortInner:   { width: 28, height: 28, borderRadius: 5, backgroundColor: "#050505", alignItems: "center", justifyContent: "center" },
  fiberPortCore:    { width: 16, height: 16, borderRadius: 3, alignItems: "center", justifyContent: "center", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 5, elevation: 3 },
  ferrule:          { width: 7, height: 7, borderRadius: 4 },
  fiberPortNum:     { position: "absolute", bottom: 1, right: 3, fontFamily: "monospace", fontSize: 6, color: "rgba(255,255,255,0.3)" },
  napUtilSection:   { marginTop: 14 },
  napUtilLabelRow:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  napUtilLabel:     { fontFamily: "monospace", fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.3)", letterSpacing: 2 },
  napUtilValue:     { fontFamily: "monospace", fontSize: 9, fontWeight: "700", color: "rgba(147,197,253,0.7)" },
  napUtilTrack:     { height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  napUtilFill:      { height: "100%", borderRadius: 3 },
  napLegendRow:     { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 12 },
  napLegendItem:    { flexDirection: "row", alignItems: "center", gap: 5 },
  napLegendDot:     { width: 8, height: 8, borderRadius: 4 },
  napLegendText:    { fontSize: 10, fontWeight: "600", color: "rgba(255,255,255,0.4)" },

  cardNapPanel:     { backgroundColor: "#191919", borderRadius: 12, padding: 12, marginTop: 2 },
  cardNapHeader:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  cardNapId:        { fontFamily: "monospace", fontSize: 8, fontWeight: "600", color: "rgba(255,255,255,0.4)", letterSpacing: 1.5, textTransform: "uppercase" },
  cardNapType:      { fontFamily: "monospace", fontSize: 8, fontWeight: "600", color: "rgba(255,255,255,0.3)", letterSpacing: 1 },
  cardFiberRow:     { flexDirection: "row", justifyContent: "center", gap: 5, marginBottom: 5 },
  cardFiberPort:    { width: 26, height: 26, borderRadius: 5, backgroundColor: "#101010", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  cardFiberCore:    { width: 16, height: 16, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  cardFerrule:      { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.2)" },
  cardNapUtilRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  cardNapUtilLabel: { fontFamily: "monospace", fontSize: 7, fontWeight: "700", color: "rgba(255,255,255,0.25)", letterSpacing: 1.5 },
  cardNapUtilValue: { fontFamily: "monospace", fontSize: 7, fontWeight: "700", color: "rgba(147,197,253,0.6)" },
  cardNapUtilTrack: { height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.06)", overflow: "hidden" },
  cardNapUtilFill:  { height: "100%", borderRadius: 2 },

  fab: {
    position: "absolute",
    bottom: 104,
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
});

const fStyles = StyleSheet.create({
  errorBanner:        { backgroundColor: "#FEE2E2", borderRadius: 12, padding: 12, marginBottom: 16 },
  errorBannerText:    { fontSize: 13, fontWeight: "600", color: "#DC2626" },
  sectionLabel:       { fontSize: 11, fontWeight: "800", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },
  label:              { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6, letterSpacing: 0.2 },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 14,
    color: "#0F172A",
    marginBottom: 4,
  },
  row:                { flexDirection: "row", marginTop: 14 },

  selectedChip:       { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EDE9FE", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 4 },
  selectedChipCode:   { fontSize: 14, fontWeight: "800", color: "#7C3AED" },
  selectedChipSub:    { fontSize: 12, fontWeight: "500", color: "#94A3B8", flexShrink: 1 },

  poleRow:            { flexDirection: "row", gap: 8, marginBottom: 4 },
  poleSearchBox:      { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  poleSearchInput:    { flex: 1, fontSize: 14, color: "#0F172A", padding: 0 },
  addPoleBtn:         { width: 48, height: 48, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },

  poleDropdown:       { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, overflow: "hidden", marginBottom: 4 },
  poleDropdownItem:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  poleItemCode:       { fontSize: 13, fontWeight: "700", color: "#0F172A" },
  poleItemBarangay:   { fontSize: 11, fontWeight: "500", color: "#94A3B8", marginTop: 1 },
  poleEmptyRow:       { paddingHorizontal: 14, paddingVertical: 18, alignItems: "center" },
  poleEmptyText:      { fontSize: 12, fontWeight: "500", color: "#94A3B8", textAlign: "center" },

  optionRow:          { flexDirection: "row", gap: 8, marginBottom: 4 },
  optionBtn:          { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: "#E2E8F0", backgroundColor: "#F8FAFC" },
  optionBtnActive:    { borderColor: "#7C3AED", backgroundColor: "#EDE9FE" },
  optionBtnText:      { fontSize: 14, fontWeight: "800", color: "#94A3B8" },
  optionBtnTextActive:{ color: "#7C3AED" },
  statusDot:          { width: 8, height: 8, borderRadius: 4 },

  duplicateWarning:      { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FCD34D", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginTop: 6, marginBottom: 2 },
  duplicateWarningText:  { fontSize: 12, fontWeight: "600", color: "#B45309" },
  dropdownHeader:        { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9", backgroundColor: "#F8FAFC" },
  dropdownHeaderText:    { fontSize: 10, fontWeight: "800", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1 },
  poleDropdownItemMatch: { backgroundColor: "#FFFBEB" },
  existsBadge:           { backgroundColor: "#FEF3C7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  existsBadgeText:       { fontSize: 10, fontWeight: "700", color: "#D97706" },
  noResultsHint:         { paddingVertical: 12, paddingHorizontal: 4, marginTop: 2, marginBottom: 4 },
  noResultsHintText:     { fontSize: 12, fontWeight: "500", color: "#94A3B8", fontStyle: "italic" },
});

// ── Pole Picker styles ────────────────────────────────────────────────────────
const pStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },

  // Dark header
  header: {
    backgroundColor: "#0F172A",
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIconRing: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(124,58,237,0.25)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255,255,255,0.45)",
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Search bar
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchBarFocused: {
    borderColor: "rgba(167,139,250,0.6)",
    backgroundColor: "rgba(167,139,250,0.08)",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF",
    padding: 0,
    letterSpacing: 0.1,
  },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  // "Register New Pole" card
  createCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#DDD6FE",
    borderStyle: "dashed",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 4,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  createIconRing: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#EDE9FE",
    borderWidth: 1,
    borderColor: "#DDD6FE",
    alignItems: "center",
    justifyContent: "center",
  },
  createTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: -0.2,
  },
  createSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "#A78BFA",
    marginTop: 2,
  },
  createArrow: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
  },
  createArrowText: {
    fontSize: 18,
    color: "#7C3AED",
    lineHeight: 22,
  },

  // Divider
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 12,
    paddingHorizontal: 2,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E2E8F0",
  },
  dividerLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  // Pole card
  poleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    paddingRight: 14,
    paddingVertical: 0,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
    marginBottom: 2,
  },
  poleCardAccent: {
    width: 4,
    alignSelf: "stretch",
    backgroundColor: "#7C3AED",
    opacity: 0.25,
    marginRight: 0,
  },
  poleCardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 12,
    marginVertical: 12,
  },
  poleCardCode: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },
  poleCardSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "#64748B",
    marginTop: 2,
  },
  poleCardSubMuted: {
    fontSize: 11,
    fontWeight: "400",
    color: "#CBD5E1",
    marginTop: 2,
    fontStyle: "italic",
  },
  poleCardChevron: {
    fontSize: 20,
    color: "#CBD5E1",
    lineHeight: 24,
  },

  // Skeleton
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    padding: 14,
    marginBottom: 2,
  },
  skeletonIcon: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: "#E2E8F0",
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#E2E8F0",
    width: "70%",
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  quickCreateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EDE9FE",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#DDD6FE",
  },
  quickCreateText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7C3AED",
  },

  // Premium Inline Dropdown Styles
  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 8,
  },
  dropdownTriggerOpen: {
    borderColor: "#7C3AED",
    backgroundColor: "#F5F3FF",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    marginBottom: 0,
    borderBottomWidth: 0,
  },
  dropdownTriggerIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dropdownTriggerValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  dropdownTriggerSub: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748B",
    marginTop: 2,
  },
  dropdownTriggerPlaceholder: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#94A3B8",
    marginLeft: 12,
  },
  dropdownChevron: {
    fontSize: 18,
    color: "#94A3B8",
    fontWeight: "600",
  },
  
  dropdownPanel: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#7C3AED",
    borderTopWidth: 0,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 8,
    paddingBottom: 12,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 16,
  },
  dropdownSearch: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  dropdownSearchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: "#0F172A",
    padding: 0,
  },
  addPoleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EDE9FE",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  addPoleRowIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  addPoleRowText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#7C3AED",
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 4,
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  dropdownItemSelected: {
    backgroundColor: "#F8FAFC",
  },
  dropdownItemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E2E8F0",
    marginRight: 12,
  },
  dropdownItemCode: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
  },
  dropdownItemSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "#94A3B8",
    marginTop: 2,
  },
  loadMoreBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    borderStyle: "dashed",
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#7C3AED",
  },
  inlineFormPanel: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  inlineFormHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  inlineFormTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
    marginLeft: 8,
  },
  inlineFormClose: {
    padding: 4,
  },

  gpsCaptureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EDE9FE",
    borderWidth: 1.5,
    borderColor: "#DDD6FE",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flex: 1,
  },
  gpsCaptureBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#7C3AED",
  },
  gpsMapToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  gpsMapToggleBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  mapContainer: {
    height: 200,
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 10,
    marginBottom: 4,
    borderWidth: 1.5,
    borderColor: "#DDD6FE",
    position: "relative",
  },
  mapCoordBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "rgba(15,23,42,0.75)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mapCoordText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
    fontVariant: ["tabular-nums"],
  },
});
