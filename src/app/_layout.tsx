import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { setDb } from '@/db/db';
import { upgradeLegacyS4 } from '@/db/repos/cycles';
import { NEEDS_PREPARE, openExpoDb, prepareExpoDb } from '@/db/expoDriver';
import { migrate } from '@/db/migrations';
import { seedIfEmpty } from '@/db/seed';
import { seedPersonalIfFresh, upgradePersonalData } from '@/import/importer';
import { runAutoBackupIfDue } from '@/services/autoBackup';
import { SessionSummarySheet } from '@/features/workout/SessionSummary';
import { useEntry } from '@/state/entryStore';
import { useRestTimer } from '@/state/restTimerStore';
import { useSettings } from '@/state/settingsStore';
import { Text } from '@/ui/components/primitives';
import { Backdrop } from '@/ui/components/Backdrop';
import { ToastHost } from '@/ui/components/ToastHost';
import { REST_BAR_HEIGHT, useBreakpoint } from '@/ui/responsive';
import { BOOT_BG, space, useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

/** Opens + migrates the local database synchronously before the first frame. */
function bootstrap(): string | null {
  try {
    const db = setDb(openExpoDb());
    migrate(db);
    // First launch: load the real program + history (programme-reel.md, historique-seances.csv).
    if (seedPersonalIfFresh() === null) seedIfEmpty();
    upgradePersonalData();
    upgradeLegacyS4();
    useSettings.getState().hydrate();
    useRestTimer.getState().hydrate();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function Toasts() {
  const insets = useSafeAreaInsets();
  const bp = useBreakpoint();
  const keypadOpen = useEntry((s) => s.focus !== null);
  // Above the dock, and above the rest timer capsule when it is running.
  const resting = useRestTimer((s) => s.endAt !== null);
  const base = bp === 'expanded' ? space.xl : insets.bottom + 96 + (resting ? REST_BAR_HEIGHT + 8 : 0);
  return <ToastHost bottom={keypadOpen ? base + 330 : base} />;
}

function AppStack() {
  const t = useTheme();
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg);
  }, [t.bg]);
  // Scenes are transparent: the light field (Backdrop) shows through every screen.
  const navTheme = {
    ...(t.scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(t.scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: t.accent,
      background: 'transparent',
      card: 'transparent',
      text: t.text,
      border: t.border,
      notification: t.accent,
    },
  };
  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={t.scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: t.bg, overflow: 'hidden' }}>
        <Backdrop />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
            animation: 'fade_from_bottom',
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="exercise-picker" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="exercise-edit" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
        </Stack>
        <Toasts />
        <SessionSummarySheet />
      </View>
    </ThemeProvider>
  );
}

type BootState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const initial = (): BootState => {
  if (NEEDS_PREPARE) return { kind: 'loading' };
  const error = bootstrap();
  return error === null ? { kind: 'ready' } : { kind: 'error', message: error };
};

export default function RootLayout() {
  const [boot, setBoot] = useState(initial);
  const [fontsLoaded, fontError] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // A missing font must never block training: fall back to system fonts.
  const fontsReady = fontsLoaded || fontError !== null;
  useEffect(() => {
    if (boot.kind === 'loading') {
      prepareExpoDb()
        .then(() => {
          const error = bootstrap();
          setBoot(error === null ? { kind: 'ready' } : { kind: 'error', message: error });
        })
        .catch((e: unknown) => setBoot({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    if (fontsReady) void SplashScreen.hideAsync();
  }, [boot.kind, fontsReady]);
  // Daily safety copy of the whole database, off the first frame's critical path.
  useEffect(() => {
    if (boot.kind !== 'ready') return;
    const id = setTimeout(() => runAutoBackupIfDue(), 4000);
    return () => clearTimeout(id);
  }, [boot.kind]);

  if (boot.kind === 'loading' || !fontsReady) return <View style={{ flex: 1, backgroundColor: BOOT_BG }} />;
  const error = boot.kind === 'error' ? boot.message : null;

  if (error !== null) {
    return (
      <View style={{ flex: 1, backgroundColor: BOOT_BG, justifyContent: 'center', padding: space.xl, gap: space.md }}>
        <Text variant="title">Impossible d’ouvrir la base de données</Text>
        <Text tone="secondary">{error}</Text>
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStack />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
