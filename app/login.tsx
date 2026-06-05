import { Redirect, router } from "expo-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import OnboardingScreen, { isOnboardingDone } from "./onboarding";
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRef } from "react";

const LOGO = require("@/assets/images/telcovantage-logo.png");

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const { login, isLoggedIn, mustChangePassword } = useAuth();
  const screenOpacity = useRef(new Animated.Value(0)).current;
  const screenTranslateY = useRef(new Animated.Value(16)).current;
  const screenScale = useRef(new Animated.Value(0.985)).current;

  useEffect(() => {
    isOnboardingDone().then((done) => {
      if (!done) {
        setNeedsOnboarding(true);
      }
      setCheckingOnboarding(false);
    });
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenOpacity, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(screenTranslateY, {
        toValue: 0,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.timing(screenScale, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
    ]).start();
  }, [screenOpacity, screenTranslateY, screenScale]);

  if (isLoggedIn && mustChangePassword) return <Redirect href="/change-password" />;
  if (isLoggedIn) return <Redirect href="/(tabs)" />;

  if (checkingOnboarding) return null;


  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Login Failed", "Please enter your email and password.");
      return;
    }

    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      Animated.parallel([
        Animated.timing(screenOpacity, {
          toValue: 0,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(screenTranslateY, {
          toValue: -14,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(screenScale, {
          toValue: 0.985,
          duration: 320,
          useNativeDriver: true,
        }),
      ]).start(() => {
        router.replace({
          pathname: "/loading",
          params: { next: result.mustChangePassword ? "/change-password" : "/(tabs)" },
        } as any);
      });
    } catch (err: any) {
      Alert.alert("Login Failed", err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: screenOpacity,
        transform: [{ translateY: screenTranslateY }, { scale: screenScale }],
      }}
    >
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.rightCurve} />
          <View style={styles.leftLine} />
          <View style={styles.bottomCircle} />

          <View style={styles.container}>
            <View style={styles.logoSection}>
              <Image source={LOGO} style={styles.logo} resizeMode="contain" />
              <Text style={styles.welcomeText}>Welcome Back</Text>
              <Text style={styles.subtitle}>
                Login to continue your practice
              </Text>
            </View>

            <View style={styles.formSection}>
              <View style={styles.inputWrapper}>
                <Text style={styles.icon}>✉</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#B8C1CC"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={email}
                  onChangeText={setEmail}
                />
              </View>

              <View style={styles.inputWrapper}>
                <Text style={styles.icon}>🔒</Text>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="Password"
                  placeholderTextColor="#B8C1CC"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.showPasswordBtn}
                >
                  <Text style={styles.showPasswordText}>
                    {showPassword ? "HIDE" : "SHOW"}
                  </Text>
                </Pressable>
              </View>

              <Pressable style={styles.forgotWrapper}>
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </Pressable>

              <Pressable
                style={[styles.loginButton, loading && styles.loginButtonDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                <Text style={styles.loginText}>{loading ? "LOGGING IN..." : "LOGIN"}</Text>
              </Pressable>

              <View style={styles.signupRow}>
                <Text style={styles.signupLabel}>
                  Don&apos;t have an account?
                </Text>
                <Pressable>
                  <Text style={styles.signupText}> Sign up</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        transparent
        visible={needsOnboarding}
        animationType="fade"
        onRequestClose={() => {}}
      >
        <OnboardingScreen onFinish={() => setNeedsOnboarding(false)} />
      </Modal>
    </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 42,
    justifyContent: "center",
    minHeight: 760,
  },
  rightCurve: {
    position: "absolute",
    right: -112,
    top: 82,
    width: 230,
    height: 345,
    borderRadius: 140,
    borderWidth: 8,
    borderColor: "#D9F6FE",
  },
  leftLine: {
    position: "absolute",
    left: -60,
    top: 335,
    width: 180,
    height: 8,
    borderRadius: 8,
    backgroundColor: "#D9F6FE",
  },
  bottomCircle: {
    position: "absolute",
    bottom: -95,
    left: -80,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#F1FBFE",
  },
  logoSection: {
    alignItems: "center",
    marginBottom: 38,
  },
  logo: {
    width: 205,
    height: 105,
    marginBottom: 18,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: "800",
    color: "#061B33",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: "#8A97A5",
    fontWeight: "500",
  },
  formSection: {
    width: "100%",
  },
  inputWrapper: {
    height: 50,
    borderWidth: 1,
    borderColor: "#D7DEE6",
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 14,
    backgroundColor: "#FFFFFF",
    shadowColor: "#061B33",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  icon: {
    width: 28,
    fontSize: 14,
    color: "#13B5EA",
    textAlign: "center",
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 14,
    color: "#061B33",
    paddingVertical: 0,
    marginLeft: 8,
  },
  passwordInput: {
    paddingRight: 8,
  },
  showPasswordBtn: {
    height: 50,
    justifyContent: "center",
    paddingLeft: 8,
    paddingRight: 4,
  },
  showPasswordText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#13B5EA",
    letterSpacing: 0.4,
  },
  forgotWrapper: {
    alignSelf: "flex-end",
    marginTop: 8,
    marginBottom: 18,
  },
  forgotText: {
    color: "#13B5EA",
    fontSize: 12,
    fontWeight: "700",
  },
  loginButton: {
    height: 42,
    borderRadius: 8,
    backgroundColor: "#12AEE5",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#12AEE5",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  signupRow: {
    marginTop: 26,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  signupLabel: {
    fontSize: 13,
    color: "#8A97A5",
  },
  signupText: {
    fontSize: 13,
    color: "#13B5EA",
    fontWeight: "800",
  },
});
