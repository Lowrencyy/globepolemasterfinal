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
  const shellLift = useRef(new Animated.Value(18)).current;

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.78)).current;
  const shineX = useRef(new Animated.Value(-1)).current;

  const mainOpacity = useRef(new Animated.Value(0)).current;
  const subOpacity = useRef(new Animated.Value(0)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const mainTranslateY = useRef(new Animated.Value(18)).current;
  const subTranslateY = useRef(new Animated.Value(14)).current;
  const taglineTranslateY = useRef(new Animated.Value(10)).current;

  const ringOneScale = useRef(new Animated.Value(0.82)).current;
  const ringTwoScale = useRef(new Animated.Value(0.92)).current;
  const ringOneOpacity = useRef(new Animated.Value(0)).current;
  const ringTwoOpacity = useRef(new Animated.Value(0)).current;

  const wrapperOpacity = useRef(new Animated.Value(1)).current;
  const wrapperScale = useRef(new Animated.Value(1)).current;
  const wrapperTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    shellOpacity.setValue(0);
    shellScale.setValue(0.86);
    shellLift.setValue(18);
    logoOpacity.setValue(0);
    logoScale.setValue(0.78);
    shineX.setValue(-1);
    mainOpacity.setValue(0);
    subOpacity.setValue(0);
    taglineOpacity.setValue(0);
    mainTranslateY.setValue(18);
    subTranslateY.setValue(14);
    taglineTranslateY.setValue(10);

    wrapperOpacity.setValue(1);
    wrapperScale.setValue(1);
    wrapperTranslateY.setValue(0);

    ringOneScale.setValue(0.82);
    ringTwoScale.setValue(0.92);
    ringOneOpacity.setValue(0);
    ringTwoOpacity.setValue(0);

    const shineLoop = Animated.loop(
      Animated.timing(shineX, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
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
        Animated.timing(shellLift, {
          toValue: 0,
          duration: 550,
          easing: Easing.out(Easing.cubic),
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
          duration: 550,
          delay: 70,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOneOpacity, {
          toValue: 0,
          duration: 120,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringTwoOpacity, {
          toValue: 0,
          duration: 120,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringOneScale, {
          toValue: 1.05,
          duration: 650,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ringTwoScale, {
          toValue: 1.12,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(mainOpacity, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(mainTranslateY, {
          toValue: 0,
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(subOpacity, {
          toValue: 1,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(subTranslateY, {
          toValue: 0,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 300,
          delay: 80,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(taglineTranslateY, {
          toValue: 0,
          duration: 300,
          delay: 80,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(720),
      Animated.parallel([
        Animated.timing(wrapperScale, {
          toValue: 3.45,
          duration: 1350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(wrapperTranslateY, {
          toValue: -28,
          duration: 1350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(wrapperOpacity, {
          toValue: 0,
          duration: 1180,
          easing: Easing.inOut(Easing.ease),
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
    shellLift,
    logoOpacity,
    logoScale,
    shineX,
    mainOpacity,
    subOpacity,
    taglineOpacity,
    mainTranslateY,
    subTranslateY,
    taglineTranslateY,
    ringOneScale,
    ringTwoScale,
    ringOneOpacity,
    ringTwoOpacity,
    wrapperOpacity,
    wrapperScale,
    wrapperTranslateY,
    onDone,
  ]);

  if (!visible) return null;

  const shineTranslate = shineX.interpolate({
    inputRange: [-1, 1],
    outputRange: [-scale(130), scale(150)],
  });

  return (
    <View pointerEvents="auto" style={styles.overlay}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ringOne,
          { opacity: ringOneOpacity, transform: [{ scale: ringOneScale }] },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ringTwo,
          { opacity: ringTwoOpacity, transform: [{ scale: ringTwoScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.content,
          {
            opacity: wrapperOpacity,
            transform: [
              { translateY: wrapperTranslateY },
              { scale: wrapperScale },
            ],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.logoShell,
            {
              opacity: shellOpacity,
              transform: [{ translateY: shellLift }, { scale: shellScale }],
            },
          ]}
        >
          <View style={styles.logoShineMask}>
            <Animated.View
              style={[
                styles.logoShine,
                {
                  transform: [
                    { translateX: shineTranslate },
                    { rotate: "18deg" },
                  ],
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
            styles.subText,
            { opacity: subOpacity, transform: [{ translateY: subTranslateY }] },
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
              transform: [{ translateY: taglineTranslateY }],
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

const RING_ONE = Math.max(SW, SH) * 0.46;
const RING_TWO = Math.max(SW, SH) * 0.66;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fbfffd",
    zIndex: 9999,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  ringOne: {
    position: "absolute",
    width: RING_ONE,
    height: RING_ONE,
    borderRadius: RING_ONE / 2,
    borderWidth: 1.2,
    borderColor: "rgba(109,141,132,0.14)",
  },
  ringTwo: {
    position: "absolute",
    width: RING_TWO,
    height: RING_TWO,
    borderRadius: RING_TWO / 2,
    borderWidth: 1,
    borderColor: "rgba(109,141,132,0.08)",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    paddingHorizontal: scale(24),
    width: "100%",
  },
  logoShell: {
    width: scale(244),
    height: scale(244),
    borderRadius: scale(64),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: scale(4),
    overflow: "hidden",
  },
  logoShineMask: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  logoShine: {
    position: "absolute",
    top: -scale(10),
    bottom: -scale(10),
    width: scale(54),
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  logo: {
    width: scale(208),
    height: scale(208),
  },
  subText: {
    marginTop: scale(-6),
    fontSize: scale(28),
    fontWeight: "900",
    letterSpacing: scale(0.2),
    color: "#18392f",
    textAlign: "center",
    lineHeight: scale(32),
    maxWidth: scale(356),
  },
  tagline: {
    marginTop: scale(6),
    fontSize: scale(16),
    fontWeight: "800",
    letterSpacing: scale(-0.15),
    color: "#80958d",
    textAlign: "center",
    maxWidth: scale(340),
  },
});
