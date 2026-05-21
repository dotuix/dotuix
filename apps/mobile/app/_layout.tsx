import { useEffect, useState, useCallback } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import AnimatedSplash from "@/components/SplashScreen";

// Keep the native splash visible until we're ready to show the animated one
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [appReady, setAppReady] = useState(false);
  const [showAnimatedSplash, setShowAnimatedSplash] = useState(true);

  useEffect(() => {
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setAppReady(true));
  }, []);

  const handleSplashComplete = useCallback(() => {
    setShowAnimatedSplash(false);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="viewer"
          options={{ animation: "slide_from_bottom" }}
        />
      </Stack>
      {showAnimatedSplash && appReady && (
        <AnimatedSplash onAnimationComplete={handleSplashComplete} />
      )}
    </GestureHandlerRootView>
  );
}
