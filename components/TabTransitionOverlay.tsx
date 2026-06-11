import React, { useEffect, useRef } from "react";
import { Image } from "expo-image";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

const { width: SW, height: SH } = Dimensions.get("window");
const scale = (size: number) => Math.round((SW / 390) * size);

type Props = {
  visible: boolean;
  onDone?: () => void;
};

export default function TabTransitionOverlay({ visible, onDone }: Props) {
  const shellOpacity = useRef(new Animated.Value(0)).current;
  const shellScale = useRef(new Animated.Value(0.86)).current;

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.78)).current;
  const shineOpacity = useRef(new Animated.Value(0.12)).current;

  const subOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const subScale = useRef(new Animated.Value(0.92)).current;
  const taglineScale = useRef(new Animated.Value(0.94)).current;

  const wrapperOpacity = useRef(new Animated.Value(1)).current;
  const wrapperScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;

    shellOpacity.setValue(0);
    shellScale.setValue(0.86);
    logoOpacity.setValue(0);
    logoScale.setValue(0.78);
    shineOpacity.setValue(0.12);
    subOpacity.setValue(0);
    taglineOpacity.setValue(0);
    subScale.setValue(0.92);
    taglineScale.setValue(0.94);

    wrapperOpacity.setValue(1);
    wrapperScale.setValue(1);

    const shineLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shineOpacity, {
          toValue: 0.28,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shineOpacity, {
          toValue: 0.12,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    shineLoop.start();

    Animated.sequence([
      Animated.parallel([
        Animated.timing(shellOpacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(shellScale, {
          toValue: 1,
          duration: 550,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 300,
          delay: 70,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 760,
          delay: 70,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(subOpacity, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
        Animated.timing(subScale, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 420,
          delay: 40,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
        Animated.timing(taglineScale, {
          toValue: 1,
          duration: 420,
          delay: 40,
          easing: Easing.out(Easing.exp),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(1180),
      Animated.parallel([
        Animated.timing(wrapperScale, {
          toValue: 3.05,
          duration: 1620,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(wrapperOpacity, {
          toValue: 0,
          duration: 1480,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      shineLoop.stop();
      onDone?.();
    });
  }, [
    visible,
    shellOpacity,
    shellScale,
    logoOpacity,
    logoScale,
    shineOpacity,
    subOpacity,
    taglineOpacity,
    subScale,
    taglineScale,
    wrapperOpacity,
    wrapperScale,
    onDone,
  ]);

  if (!visible) return null;

  return (
    <View pointerEvents="auto" style={styles.overlay}>
      <Animated.View
        style={[
          styles.content,
          {
            opacity: wrapperOpacity,
            transform: [{ scale: wrapperScale }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.logoShell,
            {
              opacity: shellOpacity,
              transform: [{ scale: shellScale }],
            },
          ]}
        >
          <View style={styles.logoShineMask}>
            <Animated.View
              style={[
                styles.logoShine,
                {
                  opacity: shineOpacity,
                },
              ]}
            />
          </View>
          <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
            <Image
              source={require("@/assets/images/telco-mainlogo.png")}
              style={styles.logo}
              contentFit="contain"
            />
          </Animated.View>
        </Animated.View>

        <Animated.Text
          style={[
            styles.mainText,
            { opacity: subOpacity, transform: [{ scale: subScale }] },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          TELCOVANTAGE POLE MASTER V2.0
        </Animated.Text>
        <Animated.Text
          style={[
            styles.tagline,
            {
              opacity: taglineOpacity,
              transform: [{ scale: taglineScale }],
            },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          Powered By : Telcovantage Developers
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fbfffd",
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    paddingHorizontal: scale(24),
    width: "100%",
  },
  logoShell: {
    width: scale(272),
    height: scale(272),
    borderRadius: scale(64),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: scale(-12),
    overflow: "hidden",
  },
  logoShineMask: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  logoShine: {
    position: "absolute",
    top: scale(24),
    left: scale(52),
    right: scale(52),
    height: scale(118),
    borderRadius: scale(999),
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  logo: {
    width: scale(234),
    height: scale(234),
  },
  mainText: {
    marginTop: scale(-8),
    fontSize: scale(32),
    fontWeight: "900",
    letterSpacing: scale(-0.5),
    color: "#18392f",
    textAlign: "center",
    lineHeight: scale(34),
    maxWidth: scale(366),
  },
  tagline: {
    marginTop: scale(2),
    fontSize: scale(18),
    fontWeight: "900",
    letterSpacing: scale(-0.2),
    color: "#72867f",
    textAlign: "center",
    maxWidth: scale(350),
  },
});
