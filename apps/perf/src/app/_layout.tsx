import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Sora_600SemiBold } from '@expo-google-fonts/sora/600SemiBold';
import { Sora_700Bold } from '@expo-google-fonts/sora/700Bold';
import { loadAsync, useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useLayoutEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { setDb } from '@/db/db';
import { upgradeLegacyS4 } from '@/db/repos/cycles';
import { NEEDS_PREPARE, openExpoDb, prepareExpoDb } from '@/db/expoDriver';
import { migrate } from '@/db/migrations';
import { seedIfEmpty } from '@/db/seed';
import { AccountGate } from '@/features/account/AccountGate';
import { personalImporter } from '@/import/personal';
import { runAutoBackupIfDue } from '@/services/autoBackup';
import { SessionSummarySheet } from '@/features/workout/SessionSummary';
import { useEntry } from '@/state/entryStore';
import { useRestTimer } from '@/state/restTimerStore';
import { useSettings } from '@/state/settingsStore';
import { Text } from '@/ui/components/primitives';
import { Backdrop } from '@/ui/components/Backdrop';
import { ToastHost } from '@/ui/components/ToastHost';
import { REST_BAR_HEIGHT, useBreakpoint } from '@/ui/responsive';
import { IDENTITY_FONTS } from '@/ui/fonts';
import { applyIdentity, BOOT_BG, identity, space, useShownTheme, useTheme } from '@/ui/theme';
import { themeInfo } from '@/ui/themes';
import { cloudBoot } from '@/services/cloud';
import { installSyncTriggers } from '@/services/cloud/sqliteStore';

void SplashScreen.preventAutoHideAsync();

/** Opens + migrates the local database synchronously before the first frame. */
function bootstrap(): string | null {
  try {
    const db = setDb(openExpoDb());
    migrate(db);
    // Synchro MyLife : déclencheurs de suivi recréés d'après le schéma (inactifs tant que pas de compte).
    installSyncTriggers(db);
    // Premier lancement : base vide + bibliothèque générique. Le programme personnel de l'auteur n'existe
    // que dans un build privé (import/personal.ts) : jamais chez un nouvel utilisateur.
    const personal = personalImporter();
    if (personal === null || personal.seedPersonalIfFresh() === null) seedIfEmpty();
    personal?.upgradePersonalData();
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
        <AccountGate />
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

/**
 * Web : la base se prépare une seule fois, même si l'effet de démarrage se relance (polices chargées
 * entre-temps). Une seconde préparation remplaçait la base ouverte par une base vide pendant que la
 * synchro lisait déjà la première (« no such table: sync_queue » au premier lancement).
 */
let booting: Promise<BootState> | null = null;
function bootOnce(): Promise<BootState> {
  booting ??= prepareExpoDb()
    .then((): BootState => {
      const error = bootstrap();
      return error === null ? { kind: 'ready' } : { kind: 'error', message: error };
    })
    .catch((e: unknown): BootState => ({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  return booting;
}

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
  // Identité du thème : ses polices d'abord, puis rayons et familles, puis la bascule de tout l'écran.
  const themeId = useSettings((s) => s.settings.theme);
  const style = themeInfo(themeId).style;
  const [styleFonts, styleFontError] = useFonts(IDENTITY_FONTS[style]);
  const styleReady = styleFonts || styleFontError !== null;
  const [everReady, setEverReady] = useState(false);
  if (styleReady && !everReady) setEverReady(true);
  if (styleReady && identity.style !== style) applyIdentity(style, styleFonts);
  const shown = useShownTheme((s) => s.id);
  useLayoutEffect(() => {
    if (styleReady && shown !== themeId) useShownTheme.setState({ id: themeId });
  }, [styleReady, shown, themeId]);
  useEffect(() => {
    if (boot.kind === 'loading') {
      void bootOnce().then(setBoot);
      return;
    }
    if (fontsReady) void SplashScreen.hideAsync();
  }, [boot.kind, fontsReady]);
  // Compte MyLife : récupère ce que les autres appareils ont fait, puis synchronise au fil de l'eau.
  useEffect(() => {
    if (boot.kind === 'ready') cloudBoot();
  }, [boot.kind]);
  // Les polices des autres identités, une fois l'app lancée : aperçus fidèles et bascule immédiate.
  useEffect(() => {
    if (boot.kind !== 'ready') return;
    const id = setTimeout(() => {
      for (const fonts of Object.values(IDENTITY_FONTS)) void loadAsync(fonts).catch(() => undefined);
    }, 2500);
    return () => clearTimeout(id);
  }, [boot.kind]);
  // Daily safety copy of the whole database, off the first frame's critical path.
  useEffect(() => {
    if (boot.kind !== 'ready') return;
    const id = setTimeout(() => runAutoBackupIfDue(), 4000);
    return () => clearTimeout(id);
  }, [boot.kind]);

  if (boot.kind === 'loading' || !fontsReady || !everReady) return <View style={{ flex: 1, backgroundColor: BOOT_BG }} />;
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
