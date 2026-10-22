import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { refreshCloud, syncCloud, useCloud } from '@/services/cloud';
import { Button, Card, Text } from '@/ui/components/primitives';
import { space, useTheme } from '@/ui/theme';
import { MYLIFE_APPS } from '@/vendor/lumen';

import { AccountForms } from './forms';
import { Join } from './Join';

const BRAND = MYLIFE_APPS.find((a) => a.id === 'perf')!;

/**
 * Pas de compte, pas d'app : tant qu'aucune session MyLife n'est ouverte sur l'appareil, ce portail couvre
 * l'app (même règle dans les trois apps). Une fois connecté, il reste jusqu'à ce que l'appareil soit relié
 * au compte : jamais un écran avec les données d'un autre compte, même un instant. Ensuite il disparaît ;
 * la session est gardée sur l'appareil, donc l'app s'ouvre ensuite sans réseau.
 */
export function AccountGate() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { session, checked, joined, choice, error, syncing } = useCloud();
  useEffect(() => {
    void refreshCloud();
  }, []);
  if (session !== null && joined) return null;
  // Session pas encore lue : un fond uni, jamais le formulaire qui clignote chez quelqu'un de connecté.
  if (!checked) return <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, zIndex: 50 }]} />;
  if (session !== null)
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, zIndex: 50 }]}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <Brand />
          {choice ? (
            <Join />
          ) : (
            <Card>
              <View style={{ gap: space.md }}>
                <Text variant="headline">{error ? 'Ton espace n’est pas prêt' : 'Préparation de ton espace…'}</Text>
                <Text tone="secondary">{error ?? `Connecté en tant que ${session.login}. Récupération de tes données, chiffrées.`}</Text>
                {error !== null && <Button label={syncing ? 'Nouvel essai…' : 'Réessayer'} icon="refresh" onPress={() => void syncCloud()} disabled={syncing} />}
              </View>
            </Card>
          )}
        </ScrollView>
      </View>
    );
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, zIndex: 50 }]}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Brand />
        <AccountForms />
      </ScrollView>
    </View>
  );
}

function Brand() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: BRAND.colors[1], alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="barbell" size={28} color="#fff" />
      </View>
      <View>
        <Text variant="large">MyPerf</Text>
        <Text variant="small" tone="secondary">
          {BRAND.tagline}
        </Text>
      </View>
    </View>
  );
}
