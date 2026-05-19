import { useAuth } from "@/context/auth-context";
import {
  Bell,
  Bug,
  ChevronRight,
  MessageCircle,
  HardDrive,
  List,
  LogOut,
  RefreshCw,
  Settings,
  Shield,
  Smartphone,
  UploadCloud,
  User,
  Wifi,
} from "lucide-react-native";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { BASE_URL } from "@/lib/api";
import { cacheSet } from "@/lib/cache";
import { useRouter } from "expo-router";
import {
  processSyncQueue,
  processImageQueue,
  queueCount,
} from "@/lib/sync-queue";
import { getAreas, getNodes, getNodePoles } from "@/services/skycable";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE_URL = BASE_URL;

const HEALTH_ENDPOINT = "/ping";
const SYNC_ENDPOINT = "/ping";

type StepStatus = "idle" | "running" | "success" | "error";

type ModalStep = {
  id: string;
  label: string;
  detail?: string;
  status: StepStatus;
};

type ActionItem = {
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanBaseUrl = (url: string) => url.replace(/\/$/, "");

const fetchWithTimeout = async (
  url: string,
  options: any = {},
  timeoutMs = 8000
) => {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
};

export default function ProfileScreen() {
  const router = useRouter();
  const { logout, user, token } = useAuth();
  const insets = useSafeAreaInsets();

  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [modalVisible, setModalVisible] = React.useState(false);
  const [modalTitle, setModalTitle] = React.useState("");
  const [modalSubtitle, setModalSubtitle] = React.useState("");
  const [modalSteps, setModalSteps] = React.useState<ModalStep[]>([]);
  
  // Real-time sync tracking
  const [lastSyncDate, setLastSyncDate] = React.useState("—");
  const [pendingSyncCount, setPendingSyncCount] = React.useState(0);

  React.useEffect(() => {
    const checkQueue = async () => {
      const count = await queueCount();
      setPendingSyncCount(count);
      
      const last = await AsyncStorage.getItem("last_sync_date");
      if (last) setLastSyncDate(last);
    };
    
    checkQueue();
    const interval = setInterval(checkQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const initials = (user?.first_name?.[0] ?? "—").toUpperCase();
  const roleLabel = user?.role ?? "Field Staff";
  const subconName =
    user?.subcontractor_name || user?.company || "Subcontractor";

  const isProjectManager = roleLabel.toLowerCase() === "project manager";

  const updateStep = (id: string, updates: Partial<ModalStep>) => {
    setModalSteps((prev) =>
      prev.map((step) => (step.id === id ? { ...step, ...updates } : step))
    );
  };

  const openProcessModal = (
    title: string,
    subtitle: string,
    steps: ModalStep[]
  ) => {
    setModalTitle(title);
    setModalSubtitle(subtitle);
    setModalSteps(steps);
    setModalVisible(true);
  };

  const getErrorMessage = (error: any) => {
    if (error?.name === "AbortError") {
      return "Request timed out. Backend may be offline or unreachable.";
    }

    return error?.message || "Something went wrong.";
  };

  const runNetworkTest = async () => {
    if (busyAction) return;

    const steps: ModalStep[] = [
      {
        id: "config",
        label: "Checking API configuration",
        status: "idle",
      },
      {
        id: "ping",
        label: "Pinging backend server",
        status: "idle",
      },
      {
        id: "response",
        label: "Reading backend response",
        status: "idle",
      },
      {
        id: "result",
        label: "Final network status",
        status: "idle",
      },
    ];

    setBusyAction("network");
    openProcessModal(
      "Network Test",
      "Testing if your backend API is reachable.",
      steps
    );

    let activeStep = "config";

    try {
      activeStep = "config";
      updateStep(activeStep, {
        status: "running",
        detail: "Validating backend URL...",
      });
      await wait(400);

      if (!API_BASE_URL) {
        throw new Error("Backend URL is not configured.");
      }

      const baseUrl = cleanBaseUrl(API_BASE_URL);
      const healthUrl = `${baseUrl}${HEALTH_ENDPOINT}`;

      updateStep(activeStep, {
        status: "success",
        detail: baseUrl,
      });

      activeStep = "ping";
      updateStep(activeStep, {
        status: "running",
        detail: `Sending request to backend...`,
      });

      const startedAt = Date.now();

      const response = await fetchWithTimeout(
        healthUrl,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "ngrok-skip-browser-warning": "true",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        8000
      );

      const latency = Date.now() - startedAt;

      updateStep(activeStep, {
        status: response.ok ? "success" : "error",
        detail: `Status ${response.status} • ${latency}ms`,
      });

      activeStep = "response";
      updateStep(activeStep, {
        status: "running",
        detail: "Checking server response body...",
      });

      let responseText = "";

      try {
        responseText = await response.text();
      } catch {
        responseText = "";
      }

      updateStep(activeStep, {
        status: "success",
        detail: responseText
          ? "Backend returned a readable response."
          : "Backend responded with no body.",
      });

      activeStep = "result";

      if (response.ok) {
        updateStep(activeStep, {
          status: "success",
          detail: "Backend API is working.",
        });
      } else {
        updateStep(activeStep, {
          status: "error",
          detail: `Backend is reachable but returned status ${response.status}.`,
        });
      }
    } catch (error: any) {
      updateStep(activeStep, {
        status: "error",
        detail: getErrorMessage(error),
      });

      updateStep("result", {
        status: "error",
        detail:
          "Network test failed. Check backend URL, endpoint, or device internet.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runSyncData = async () => {
    if (busyAction || !token) return;

    const teamId = (user as any)?.team_id ?? null;
    const pendingCount = await queueCount();

    const steps: ModalStep[] = [
      { id: "upload", label: "Upload pending field reports", status: "idle" },
      { id: "areas", label: "Fetch areas", status: "idle" },
      { id: "nodes", label: "Fetch nodes", status: "idle" },
      { id: "poles", label: "Fetch poles for each node", status: "idle" },
      { id: "finish", label: "Cache saved — ready for offline", status: "idle" },
    ];

    setBusyAction("sync");
    openProcessModal("Sync Data", "Downloading all data from backend…", steps);

    try {
      // 1. Upload queue
      updateStep("upload", { status: "running", detail: pendingCount > 0 ? `Flushing ${pendingCount} pending items…` : "Checking queue…" });
      if (pendingCount > 0) {
        const res = await processSyncQueue();
        await processImageQueue();
        const remaining = await queueCount();
        setPendingSyncCount(remaining);
        updateStep("upload", {
          status: res.failed > 0 ? "error" : "success",
          detail: `${res.submitted} submitted${res.failed > 0 ? `, ${res.failed} failed` : ""}`,
        });
      } else {
        updateStep("upload", { status: "success", detail: "Nothing pending — skipped." });
      }

      // 2. Fetch areas
      updateStep("areas", { status: "running", detail: "Fetching from server…" });
      const areas = await getAreas(token, teamId);
      const areasCacheKey = teamId ? `sitemap_areas_team_${teamId}` : "sitemap_areas";
      await cacheSet(areasCacheKey, areas);
      updateStep("areas", { status: "success", detail: `${areas.length} area${areas.length !== 1 ? "s" : ""} cached.` });

      // 3. Fetch nodes for every area
      updateStep("nodes", { status: "running", detail: "Fetching nodes…" });
      let totalNodes = 0;
      const allNodes: { areaId: number; nodes: any[] }[] = [];
      for (const area of areas) {
        const res = await getNodes(area.id, token, teamId);
        const nodes = res.data;
        await cacheSet(`sitemap_nodes_${area.id}`, nodes);
        allNodes.push({ areaId: area.id, nodes });
        totalNodes += nodes.length;
        updateStep("nodes", { status: "running", detail: `${totalNodes} nodes fetched…` });
      }
      updateStep("nodes", { status: "success", detail: `${totalNodes} node${totalNodes !== 1 ? "s" : ""} cached.` });

      // 4. Fetch poles for every node (chunked 5 at a time)
      updateStep("poles", { status: "running", detail: "Fetching poles…" });
      let totalPoles = 0;
      const allNodesList = allNodes.flatMap(a => a.nodes);
      const chunkSize = 5;
      for (let i = 0; i < allNodesList.length; i += chunkSize) {
        const chunk = allNodesList.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (node) => {
          try {
            const poles = await getNodePoles(node.id, token);
            await cacheSet(`sitemap_poles_${node.id}`, poles);
            totalPoles += poles.length;
          } catch {
            // Non-fatal — continue with other nodes
          }
        }));
        updateStep("poles", { status: "running", detail: `${Math.min(i + chunkSize, allNodesList.length)}/${allNodesList.length} nodes done…` });
      }
      updateStep("poles", { status: "success", detail: `${totalPoles} pole${totalPoles !== 1 ? "s" : ""} cached.` });

      // 5. Save last sync timestamp
      const now = new Date();
      const formatted = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
      setLastSyncDate(formatted);
      await AsyncStorage.setItem("last_sync_date", formatted);

      updateStep("finish", {
        status: "success",
        detail: `${areas.length} areas · ${totalNodes} nodes · ${totalPoles} poles ready offline.`,
      });
    } catch (error: any) {
      updateStep("finish", {
        status: "error",
        detail: error?.message || "Sync failed. Check connection.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runSimpleTool = async (
    actionKey: string,
    title: string,
    subtitle: string,
    steps: ModalStep[]
  ) => {
    if (busyAction) return;

    setBusyAction(actionKey);
    openProcessModal(title, subtitle, steps);

    try {
      for (const step of steps) {
        updateStep(step.id, {
          status: "running",
          detail: "Running check...",
        });

        await wait(700);

        updateStep(step.id, {
          status: "success",
          detail: "Done.",
        });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const runFailedResync = () => {
    runSimpleTool("failed-resync", "Re-sync Failed", "Checking failed uploads.", [
      {
        id: "failed",
        label: "Finding failed sync records",
        status: "idle",
      },
      {
        id: "retry",
        label: "Preparing retry queue",
        status: "idle",
      },
      {
        id: "done",
        label: "Retry status",
        status: "idle",
      },
    ]);
  };

  const runAppLogs = () => {
    runSimpleTool("app-logs", "App Logs", "Checking recent app diagnostics.", [
      {
        id: "logs",
        label: "Reading recent logs",
        status: "idle",
      },
      {
        id: "errors",
        label: "Checking app errors",
        status: "idle",
      },
      {
        id: "done",
        label: "Log status",
        status: "idle",
      },
    ]);
  };

  const runDeviceCheck = () => {
    runSimpleTool("device-check", "Device Check", "Checking device readiness.", [
      {
        id: "storage",
        label: "Checking available storage",
        status: "idle",
      },
      {
        id: "permissions",
        label: "Checking app permissions",
        status: "idle",
      },
      {
        id: "done",
        label: "Device status",
        status: "idle",
      },
    ]);
  };

  const accountItems: ActionItem[] = [
    {
      icon: <User size={22} color="#374151" />,
      label: "Delivery\nStatus",
      onPress: () => router.push("/delivery" as any),
    },
    {
      icon: <Settings size={22} color="#374151" />,
      label: "Warehouse",
      onPress: () => router.push("/warehouse" as any),
    },
    {
      icon: <Shield size={22} color="#374151" />,
      label: "Daily\nReports",
      onPress: () => router.push("/daily-report" as any),
    },
    {
      icon: <Bell size={22} color="#374151" />,
      label: "Notifications",
    },
    {
      icon:
        busyAction === "sync" ? (
          <ActivityIndicator size="small" color="#374151" />
        ) : (
          <RefreshCw size={22} color="#374151" />
        ),
      label: busyAction === "sync" ? "Syncing..." : "Download\nData",
      onPress: runSyncData,
    },
  ];

  const toolsItems: ActionItem[] = [
    ...(isProjectManager
      ? [
        {
          icon: <List size={22} color="#3B82F6" />,
          label: "Set\nSequence",
        },
      ]
      : []),
    {
      icon:
        busyAction === "network" ? (
          <ActivityIndicator size="small" color="#3B82F6" />
        ) : (
          <Wifi size={22} color="#3B82F6" />
        ),
      label: busyAction === "network" ? "Testing..." : "Network\nTest",
      onPress: runNetworkTest,
    },
    {
      icon:
        busyAction === "failed-resync" ? (
          <ActivityIndicator size="small" color="#3B82F6" />
        ) : (
          <UploadCloud size={22} color="#3B82F6" />
        ),
      label: "Re-sync\nFailed",
      onPress: runFailedResync,
    },
    {
      icon:
        busyAction === "app-logs" ? (
          <ActivityIndicator size="small" color="#3B82F6" />
        ) : (
          <Bug size={22} color="#3B82F6" />
        ),
      label: "App\nLogs",
      onPress: runAppLogs,
    },
    {
      icon:
        busyAction === "device-check" ? (
          <ActivityIndicator size="small" color="#3B82F6" />
        ) : (
          <Smartphone size={22} color="#3B82F6" />
        ),
      label: "Device\nCheck",
      onPress: runDeviceCheck,
    },
  ];

  const renderStepIcon = (status: StepStatus) => {
    if (status === "running") {
      return <ActivityIndicator size="small" color="#0B7A5A" />;
    }

    if (status === "success") {
      return <Text style={styles.stepSuccess}>✓</Text>;
    }

    if (status === "error") {
      return <Text style={styles.stepError}>!</Text>;
    }

    return <View style={styles.stepIdleDot} />;
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: Math.max(insets.top + 8, 16) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials}</Text>
          </View>

          <View style={styles.userMeta}>
            <Text style={styles.userName}>
              {user?.first_name} {user?.last_name}
            </Text>
            <Text style={styles.userRole}>
              {roleLabel} / {subconName}
            </Text>
          </View>

          <ChevronRight size={20} color="#9CA3AF" />
        </Pressable>

        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Pending Sync</Text>
            <Text style={[styles.statValue, { color: pendingSyncCount > 0 ? "#EF4444" : "#374151" }]}>{pendingSyncCount}</Text>
            <Text style={styles.statSub}>items</Text>
          </View>

          <View style={styles.statDiv} />

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Sync Status</Text>
            <Text style={[styles.statValue, { color: "#374151", fontSize: 16 }]}>{lastSyncDate}</Text>
            <Text style={styles.statSub}>last sync</Text>
          </View>

          <View style={styles.statDiv} />

          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Today&apos;s Teardown</Text>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statSub}>completed</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>My Account</Text>

        <View style={styles.gridRow}>
          {accountItems.map((item, idx) => (
            <Pressable
              key={idx}
              style={styles.gridItem}
              onPress={item.onPress}
              disabled={!item.onPress || !!busyAction}
            >
              <View style={styles.gridIconWrap}>{item.icon}</View>
              <Text style={styles.gridLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Tools & Support</Text>

        <View style={styles.toolsRow}>
          {toolsItems.map((item, idx) => (
            <Pressable
              key={idx}
              style={styles.toolsItem}
              onPress={item.onPress}
              disabled={!item.onPress || !!busyAction}
            >
              <View style={styles.toolsIconWrap}>{item.icon}</View>
              <Text style={styles.toolsLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={styles.ticketingBtn}
          onPress={() => router.push("/tickets" as any)}
        >
          <MessageCircle size={18} color="#3B82F6" />
          <Text style={styles.ticketingTxt}>Ticketing</Text>
        </Pressable>

        <Pressable style={styles.logoutBtn} onPress={logout}>
          <LogOut size={18} color="#EF4444" />
          <Text style={styles.logoutTxt}>Log Out</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busyAction) setModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                {busyAction === "sync" ? (
                  <HardDrive size={24} color="#0B7A5A" />
                ) : busyAction === "network" ? (
                  <Wifi size={24} color="#0B7A5A" />
                ) : (
                  <HardDrive size={24} color="#0B7A5A" />
                )}
              </View>

              <View style={styles.modalTitleWrap}>
                <Text style={styles.modalTitle}>{modalTitle}</Text>
                <Text style={styles.modalSubtitle}>{modalSubtitle}</Text>
              </View>
            </View>

            <View style={styles.modalStepsWrap}>
              {modalSteps.map((step) => (
                <View key={step.id} style={styles.stepRow}>
                  <View style={styles.stepIconWrap}>
                    {renderStepIcon(step.status)}
                  </View>

                  <View style={styles.stepTextWrap}>
                    <Text style={styles.stepLabel}>{step.label}</Text>

                    {!!step.detail && (
                      <Text
                        style={[
                          styles.stepDetail,
                          step.status === "error" && styles.stepDetailError,
                        ]}
                      >
                        {step.detail}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              style={[
                styles.modalCloseBtn,
                !!busyAction && styles.modalCloseBtnDisabled,
              ]}
              disabled={!!busyAction}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.modalCloseText}>
                {busyAction ? "Please wait..." : "Close"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F6F8",
  },

  scroll: {
    paddingBottom: 120,
  },

  userRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#0B7A5A",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  avatarTxt: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "900",
  },

  userMeta: {
    flex: 1,
  },

  userName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },

  userRole: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0B7A5A",
    marginTop: 2,
  },

  statsCard: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },

  statItem: {
    flex: 1,
    alignItems: "center",
  },

  statLabel: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "600",
    marginBottom: 4,
  },

  statValue: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
  },

  statSub: {
    fontSize: 11,
    color: "#9CA3AF",
    fontWeight: "500",
    marginTop: 2,
  },

  statDiv: {
    width: 1,
    backgroundColor: "#F3F4F6",
    marginVertical: 4,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    marginHorizontal: 20,
    marginBottom: 12,
  },

  gridRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: 12,
    marginBottom: 28,
  },

  gridItem: {
    width: "20%",
    alignItems: "center",
    paddingVertical: 12,
  },

  gridIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
    backgroundColor: "#EFF6FF",
  },

  gridLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
  },

  toolsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: 12,
    marginBottom: 24,
  },

  toolsItem: {
    width: "25%",
    alignItems: "center",
    paddingVertical: 12,
  },

  toolsIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 7,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },

  toolsLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#3B82F6",
    textAlign: "center",
  },

  ticketingBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    marginBottom: 12,
  },

  ticketingTxt: {
    fontSize: 16,
    fontWeight: "700",
    color: "#3B82F6",
  },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FEE2E2",
    marginBottom: 40,
  },

  logoutTxt: {
    fontSize: 16,
    fontWeight: "700",
    color: "#EF4444",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(17, 24, 39, 0.55)",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 10,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },

  modalHeaderIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#ECFDF5",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  modalTitleWrap: {
    flex: 1,
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
  },

  modalSubtitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B7280",
    marginTop: 3,
    lineHeight: 17,
  },

  modalStepsWrap: {
    borderRadius: 18,
    backgroundColor: "#F9FAFB",
    paddingVertical: 8,
    marginBottom: 16,
  },

  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  stepIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },

  stepIdleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#D1D5DB",
  },

  stepSuccess: {
    color: "#0B7A5A",
    fontSize: 16,
    fontWeight: "900",
  },

  stepError: {
    color: "#EF4444",
    fontSize: 16,
    fontWeight: "900",
  },

  stepTextWrap: {
    flex: 1,
  },

  stepLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
  },

  stepDetail: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B7280",
    marginTop: 3,
    lineHeight: 16,
  },

  stepDetailError: {
    color: "#EF4444",
  },

  modalCloseBtn: {
    backgroundColor: "#0B7A5A",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
  },

  modalCloseBtnDisabled: {
    backgroundColor: "#9CA3AF",
  },

  modalCloseText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});