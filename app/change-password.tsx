import { useAuth } from "@/context/auth-context";
import api from "@/lib/api";
import { router, Stack } from "expo-router";
import { Eye, EyeOff, Lock } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ChangePasswordScreen() {
  const { clearPasswordReset, logout } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!newPassword.trim()) {
      Alert.alert("Required", "Please enter a new password.");
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert("Too Short", "Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Mismatch", "Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await api.post("/skycable/auth/change-password", {
        password: newPassword,
        password_confirmation: confirmPassword,
        password_reset_required: true,
      });
      await clearPasswordReset();
      router.replace("/(tabs)");
    } catch (err: any) {
      // Log full response so we can see what the backend actually expects
      console.log("[CHANGE_PASSWORD_ERROR]", JSON.stringify(err?.response ?? err?.message));

      // Laravel returns validation errors as: { message, errors: { field: [msgs] } }
      const data = err?.response?.data;
      let msg = data?.message || err?.message || "Could not change password.";

      if (data?.errors) {
        const firstField = Object.values(data.errors as Record<string, string[]>)[0];
        if (firstField?.length) msg = firstField[0];
      }

      Alert.alert("Error", msg + `\n\n(Status: ${err?.response?.status ?? "no response"})`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <SafeAreaView style={s.root}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.iconWrap}>
              <Lock size={32} color="#0B7A5A" />
            </View>

            <Text style={s.title}>Change Your Password</Text>
            <Text style={s.sub}>
              Your account requires a password change before you can continue.
              Please set a new password below.
            </Text>

            <Text style={s.label}>New Password</Text>
            <View style={s.inputWrap}>
              <TextInput
                style={s.input}
                placeholder="Min. 8 characters"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showNew}
                value={newPassword}
                onChangeText={setNewPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowNew(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {showNew ? <EyeOff size={18} color="#94A3B8" /> : <Eye size={18} color="#94A3B8" />}
              </TouchableOpacity>
            </View>

            <Text style={s.label}>Confirm Password</Text>
            <View style={s.inputWrap}>
              <TextInput
                style={s.input}
                placeholder="Re-enter new password"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showConfirm}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={() => setShowConfirm(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                {showConfirm ? <EyeOff size={18} color="#94A3B8" /> : <Eye size={18} color="#94A3B8" />}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[s.btn, loading && { opacity: 0.65 }]}
              activeOpacity={0.8}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={s.btnText}>Set New Password</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={s.logoutBtn} onPress={logout} activeOpacity={0.7}>
              <Text style={s.logoutText}>Log out instead</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F6F8" },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 28, paddingVertical: 48 },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "#ECFDF5",
    borderWidth: 1.5,
    borderColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 24,
  },
  title: { fontSize: 24, fontWeight: "900", color: "#111827", textAlign: "center", marginBottom: 10 },
  sub: { fontSize: 14, fontWeight: "500", color: "#6B7280", textAlign: "center", lineHeight: 22, marginBottom: 36 },
  label: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
    gap: 10,
  },
  input: { flex: 1, fontSize: 15, fontWeight: "500", color: "#111827", padding: 0 },
  btn: {
    backgroundColor: "#0B7A5A",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
    shadowColor: "#0B7A5A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  btnText: { fontSize: 16, fontWeight: "800", color: "#FFFFFF" },
  logoutBtn: { marginTop: 20, alignItems: "center" },
  logoutText: { fontSize: 13, fontWeight: "600", color: "#94A3B8" },
});
