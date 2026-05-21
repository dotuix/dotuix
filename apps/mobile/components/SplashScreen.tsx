/**
 * components/SplashScreen.tsx
 * Animated splash screen for dotuix viewer.
 * Pattern mirrors tadween/app — logo spring + expanding rings + title shimmer + tagline + fade-out.
 */
import { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Easing,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const { width, height } = Dimensions.get("window");

interface SplashScreenProps {
  onAnimationComplete: () => void;
}

export default function SplashScreen({
  onAnimationComplete,
}: SplashScreenProps) {
  const logoScale = useRef(new Animated.Value(0.3)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoRotate = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(30)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(20)).current;
  const shimmerPosition = useRef(new Animated.Value(-width)).current;
  const ringScale = useRef(new Animated.Value(0.5)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const ring2Scale = useRef(new Animated.Value(0.5)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const contentFadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const seq = Animated.parallel([
      // Logo — spring entrance
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
          easing: Easing.out(Easing.cubic),
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(logoRotate, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.out(Easing.back(1.5)),
        }),
      ]),

      // Ring 1 — pulse expand
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.timing(ringOpacity, {
            toValue: 0.5,
            duration: 300,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
          Animated.timing(ringScale, {
            toValue: 1.5,
            duration: 700,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
        ]),
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),

      // Ring 2 — pulse expand (wider)
      Animated.sequence([
        Animated.delay(350),
        Animated.parallel([
          Animated.timing(ring2Opacity, {
            toValue: 0.35,
            duration: 300,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
          Animated.timing(ring2Scale, {
            toValue: 2.1,
            duration: 800,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
        ]),
        Animated.timing(ring2Opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),

      // Title slide up
      Animated.sequence([
        Animated.delay(400),
        Animated.parallel([
          Animated.timing(titleOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
          Animated.timing(titleTranslateY, {
            toValue: 0,
            duration: 650,
            useNativeDriver: true,
            easing: Easing.out(Easing.back(1.2)),
          }),
        ]),
      ]),

      // Tagline slide up
      Animated.sequence([
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(taglineOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
          Animated.timing(taglineTranslateY, {
            toValue: 0,
            duration: 550,
            useNativeDriver: true,
            easing: Easing.out(Easing.cubic),
          }),
        ]),
      ]),

      // Title shimmer sweep
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(shimmerPosition, {
          toValue: width,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.cubic),
        }),
      ]),

      // Fade everything out
      Animated.sequence([
        Animated.delay(2000),
        Animated.timing(contentFadeOut, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
          easing: Easing.in(Easing.cubic),
        }),
      ]),
    ]);

    seq.start(() => onAnimationComplete());
  }, [
    logoOpacity,
    logoScale,
    logoRotate,
    titleOpacity,
    titleTranslateY,
    taglineOpacity,
    taglineTranslateY,
    shimmerPosition,
    ringOpacity,
    ringScale,
    ring2Opacity,
    ring2Scale,
    contentFadeOut,
    onAnimationComplete,
  ]);

  const logoRotateInterp = logoRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["-15deg", "0deg"],
  });

  return (
    <View style={s.container}>
      <LinearGradient
        colors={["#1e3a5f", "#0f172a", "#0c1a2e", "#0a1628"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.gradient}
      >
        {/* Background decoration circles */}
        <View style={s.bgDecor}>
          <View style={[s.decorCircle, s.dc1]} />
          <View style={[s.decorCircle, s.dc2]} />
          <View style={[s.decorCircle, s.dc3]} />
        </View>

        <Animated.View style={[s.content, { opacity: contentFadeOut }]}>
          {/* Pulse rings */}
          <Animated.View
            style={[
              s.ring,
              { opacity: ringOpacity, transform: [{ scale: ringScale }] },
            ]}
          />
          <Animated.View
            style={[
              s.ring,
              s.ring2,
              { opacity: ring2Opacity, transform: [{ scale: ring2Scale }] },
            ]}
          />

          {/* Logo */}
          <Animated.View
            style={[
              s.logoWrap,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }, { rotate: logoRotateInterp }],
              },
            ]}
          >
            <View style={s.logoInner}>
              <Image
                source={require("@/assets/icon.png")}
                style={s.logoImage}
                resizeMode="contain"
              />
            </View>
          </Animated.View>

          {/* App name with shimmer */}
          <Animated.View
            style={[
              s.titleWrap,
              {
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslateY }],
              },
            ]}
          >
            <Text style={s.title}>dotuix</Text>
            <Animated.View
              style={[
                s.shimmer,
                { transform: [{ translateX: shimmerPosition }] },
              ]}
            >
              <LinearGradient
                colors={[
                  "transparent",
                  "rgba(147,197,253,0.45)",
                  "transparent",
                ]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={s.shimmerGrad}
              />
            </Animated.View>
          </Animated.View>

          {/* Tagline */}
          <Animated.View
            style={[
              s.taglineWrap,
              {
                opacity: taglineOpacity,
                transform: [{ translateY: taglineTranslateY }],
              },
            ]}
          >
            <View style={s.taglineLine} />
            <Text style={s.tagline}>viewer</Text>
            <View style={s.taglineLine} />
          </Animated.View>
        </Animated.View>

        {/* Bottom label */}
        <Animated.View
          style={[
            s.bottomBrand,
            { opacity: Animated.multiply(taglineOpacity, contentFadeOut) },
          ]}
        >
          <Text style={s.bottomText}>OPEN · RUN · SHARE</Text>
        </Animated.View>
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  gradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  bgDecor: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  decorCircle: {
    position: "absolute",
    borderRadius: 1000,
    backgroundColor: "rgba(96, 165, 250, 0.04)",
  },
  dc1: {
    width: width * 1.5,
    height: width * 1.5,
    top: -width * 0.5,
    right: -width * 0.5,
  },
  dc2: {
    width: width * 1.2,
    height: width * 1.2,
    bottom: -width * 0.3,
    left: -width * 0.4,
  },
  dc3: {
    width: width * 0.8,
    height: width * 0.8,
    top: height * 0.3,
    right: -width * 0.3,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: "rgba(96, 165, 250, 0.5)",
  },
  ring2: {
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.25)",
  },
  logoWrap: {
    marginBottom: 32,
  },
  logoInner: {
    width: 100,
    height: 100,
    borderRadius: 22,
    backgroundColor: "#0f172a",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#60a5fa",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.3)",
    overflow: "hidden",
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 22,
  },
  titleWrap: {
    overflow: "hidden",
    position: "relative",
  },
  title: {
    fontSize: 52,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 4,
    textShadowColor: "rgba(59, 130, 246, 0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 60,
  },
  shimmerGrad: {
    flex: 1,
    width: 60,
  },
  taglineWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  taglineLine: {
    width: 24,
    height: 1,
    backgroundColor: "rgba(96, 165, 250, 0.5)",
    marginHorizontal: 12,
  },
  tagline: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(148, 163, 184, 0.9)",
    letterSpacing: 4,
    textTransform: "uppercase",
  },
  bottomBrand: {
    position: "absolute",
    bottom: 60,
  },
  bottomText: {
    fontSize: 11,
    fontWeight: "400",
    color: "rgba(148, 163, 184, 0.5)",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
});
