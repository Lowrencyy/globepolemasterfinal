import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  User,
  Monitor,
} from "lucide-react-native";
import { addMessageToTicket } from "@/lib/ticket-store";

const GREEN = "#0B7A5A";
const RED = "#EF4444";

export default function SupportCallScreen() {
  const router = useRouter();
  const { id, concern } = useLocalSearchParams<{
    id: string;
    concern: string;
  }>();

  const [connected, setConnected] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [screenShared, setScreenShared] = useState(false);
  const [didShareScreen, setDidShareScreen] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [ending, setEnding] = useState(false);

  // Simulate call connection latency
  useEffect(() => {
    const timer = setTimeout(() => {
      setConnected(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Call duration counter
  useEffect(() => {
    let interval: any = null;
    if (connected) {
      interval = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [connected]);

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  async function handleEndCall() {
    if (ending) return;
    setEnding(true);

    if (id && connected) {
      const durationStr = formatTime(seconds);
      const shareTag = didShareScreen ? " · 🖥️ Screen Shared" : "";
      await addMessageToTicket(
        id,
        `📞 Secure Support Call ended (Duration: ${durationStr}${shareTag})`,
        "user"
      );
    } else if (id) {
      await addMessageToTicket(id, "📞 Support Call cancelled before connect", "user");
    }

    router.back();
  }

  // Simulated WebRTC stream placeholder URLs
  const remoteVideoUrl =
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80";
  const localVideoUrl =
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80";

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />

      <View style={styles.wrapper}>
        {/* Immersive Main Viewport */}
        {screenShared ? (
          <View style={StyleSheet.absoluteFill}>
            {/* Tiled background representing the lineman's active screencast broadcast */}
            <Image
              source={{
                uri: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=600&q=80",
              }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
            <View style={styles.screencastOverlay} />

            <View style={styles.screencastNoticeBox}>
              <View style={styles.liveIndicatorRow}>
                <View style={styles.pulsingRedDot} />
                <Text style={styles.liveIndicatorText}>
                  LIVE SCREEN BROADCASTING
                </Text>
              </View>
              <Text style={styles.screencastTitle}>Sharing Mobile Desktop</Text>
              <Text style={styles.screencastSub}>
                Backend support engineers can view your app sitemap and camera viewport live.
              </Text>
            </View>

            {/* Local Phone PIP Frame */}
            <View style={styles.pipFrame}>
              <Image
                source={{ uri: localVideoUrl }}
                style={styles.pipImage}
                resizeMode="cover"
              />
              <View style={styles.pipIndicator} />
            </View>
          </View>
        ) : videoOn && connected ? (
          <View style={StyleSheet.absoluteFill}>
            {/* Simulated Remote Admin WebRTC Feed */}
            <Image
              source={{ uri: remoteVideoUrl }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
            <View style={styles.videoOverlay} />

            {/* Local Phone Camera Picture-in-Picture */}
            <View style={styles.pipFrame}>
              <Image
                source={{ uri: localVideoUrl }}
                style={styles.pipImage}
                resizeMode="cover"
              />
              <View style={styles.pipIndicator} />
            </View>
          </View>
        ) : (
          <View style={styles.audioWaveContainer}>
            {/* Glowing Pulsing Rings Representation */}
            <View style={[styles.glowRing, styles.ringOuter]} />
            <View style={[styles.glowRing, styles.ringInner]} />

            <View style={styles.avatarCircle}>
              <User size={48} color="#FFFFFF" />
            </View>

            <Text style={styles.supportLabel}>Backend Engineering Support</Text>
            <Text style={styles.tunnelType}>Secured P2P WebRTC Tunnel</Text>
          </View>
        )}

        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          {/* Top Status Layout Info */}
          <View style={styles.topInfo}>
            <Text style={styles.ticketIdBadge}>TICKET {id || "#TCK"}</Text>
            <Text style={styles.concernText} numberOfLines={1}>
              {concern || "Connecting Support Tunnel"}
            </Text>

            <View style={styles.statusPill}>
              <View
                style={[
                  styles.statusDot,
                  connected
                    ? { backgroundColor: "#10B981" }
                    : { backgroundColor: "#F59E0B" },
                ]}
              />
              <Text style={styles.statusText}>
                {connected ? formatTime(seconds) : "Establishing connection..."}
              </Text>
            </View>
          </View>

          {/* Bottom Dock Call Controls */}
          <View style={styles.controlsDock}>
            {/* Mute Toggle */}
            <TouchableOpacity
              style={[styles.controlBtn, !micOn && styles.controlBtnOff]}
              activeOpacity={0.7}
              onPress={() => setMicOn(!micOn)}
            >
              {micOn ? (
                <Mic size={20} color="#FFFFFF" />
              ) : (
                <MicOff size={20} color="#EF4444" />
              )}
              <Text style={styles.controlLabel}>
                {micOn ? "Mute" : "Unmute"}
              </Text>
            </TouchableOpacity>

            {/* Video Toggle */}
            <TouchableOpacity
              style={[styles.controlBtn, videoOn && styles.controlBtnActive]}
              activeOpacity={0.7}
              onPress={() => setVideoOn(!videoOn)}
            >
              {videoOn ? (
                <Video size={20} color="#10B981" />
              ) : (
                <VideoOff size={20} color="#94A3B8" />
              )}
              <Text style={styles.controlLabel}>
                {videoOn ? "Video On" : "Video Off"}
              </Text>
            </TouchableOpacity>

            {/* Screen Share Toggle */}
            <TouchableOpacity
              style={[
                styles.controlBtn,
                screenShared && styles.controlBtnActive,
              ]}
              activeOpacity={0.7}
              onPress={() => {
                setScreenShared(!screenShared);
                setDidShareScreen(true);
              }}
            >
              <Monitor
                size={20}
                color={screenShared ? "#10B981" : "#FFFFFF"}
              />
              <Text style={styles.controlLabel}>
                {screenShared ? "Sharing" : "Share"}
              </Text>
            </TouchableOpacity>

            {/* Speaker Toggle */}
            <TouchableOpacity
              style={[styles.controlBtn, !speakerOn && styles.controlBtnOff]}
              activeOpacity={0.7}
              onPress={() => setSpeakerOn(!speakerOn)}
            >
              {speakerOn ? (
                <Volume2 size={20} color="#FFFFFF" />
              ) : (
                <VolumeX size={20} color="#94A3B8" />
              )}
              <Text style={styles.controlLabel}>
                {speakerOn ? "Speaker" : "Earcap"}
              </Text>
            </TouchableOpacity>

            {/* End Call Button */}
            <TouchableOpacity
              style={styles.endBtn}
              activeOpacity={0.8}
              onPress={handleEndCall}
              disabled={ending}
            >
              <PhoneOff size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#0B0F19",
  },
  safeArea: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },

  topInfo: {
    alignItems: "center",
  },
  ticketIdBadge: {
    fontSize: 12,
    fontWeight: "900",
    color: GREEN,
    letterSpacing: 1.5,
  },
  concernText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 4,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 12,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#E2E8F0",
  },

  audioWaveContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  glowRing: {
    position: "absolute",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(11, 122, 90, 0.25)",
  },
  ringOuter: {
    width: 260,
    height: 260,
    backgroundColor: "rgba(11, 122, 90, 0.03)",
  },
  ringInner: {
    width: 180,
    height: 180,
    backgroundColor: "rgba(11, 122, 90, 0.08)",
  },
  avatarCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: GREEN,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  supportLabel: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: 32,
  },
  tunnelType: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 4,
  },

  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  screencastOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(11, 15, 25, 0.82)",
  },
  screencastNoticeBox: {
    position: "absolute",
    top: 220,
    left: 24,
    right: 24,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
  },
  liveIndicatorRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 6,
    marginBottom: 16,
  },
  pulsingRedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: RED,
  },
  liveIndicatorText: {
    fontSize: 11,
    fontWeight: "900",
    color: RED,
    letterSpacing: 1,
  },
  screencastTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
  },
  screencastSub: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },

  pipFrame: {
    position: "absolute",
    top: 120,
    right: 16,
    width: 90,
    height: 130,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: GREEN,
    elevation: 10,
  },
  pipImage: {
    width: "100%",
    height: "100%",
  },
  pipIndicator: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },

  controlsDock: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  controlBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  controlBtnOff: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
  },
  controlBtnActive: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
  },
  controlLabel: {
    position: "absolute",
    bottom: -18,
    fontSize: 10,
    fontWeight: "700",
    color: "#94A3B8",
  },
  endBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: RED,
    elevation: 6,
    shadowColor: RED,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
