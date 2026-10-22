import type Anthropic from '@anthropic-ai/sdk';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RichText } from '@/features/coach/RichText';
import { toolInput, visibleText, type Msg, type ProposedChange } from '@/services/coach/agent';
import { toolActivityLabel, WRITE_TOOL_NAMES } from '@/services/coach/tools';
import { useCoach } from '@/state/coachStore';
import { Glass } from '@/ui/components/Glass';
import { Button, Card, Field, IconButton, Tap, Text } from '@/ui/components/primitives';
import { Screen } from '@/ui/components/Screen';
import { family, radius, space, useTheme } from '@/ui/theme';

const SUGGESTIONS = [
  'Quelle est ma séance du jour, avec quelles charges ?',
  'Fais le bilan de ma dernière semaine',
  'Prépare mon prochain cycle : les charges prévues te semblent bonnes ?',
  'Mes lifts principaux progressent-ils ?',
  'Mon volume biceps et triceps est-il dans la cible ?',
];

function ApiKeySetup() {
  const t = useTheme();
  const setApiKey = useCoach((s) => s.setApiKey);
  const [value, setValue] = useState('');
  const valid = value.trim().startsWith('sk-ant-') && value.trim().length > 20;
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name="sparkles" size={20} color={t.accent} />
        <Text variant="title">Connecter le coach</Text>
      </View>
      <Text tone="secondary">
        Le coach utilise Claude (Anthropic) avec ta propre clé API. Il lit ton programme, tes séances et tes stats, et te propose des
        ajustements que tu valides avant qu’ils s’appliquent. Sur le web, c’est la même clé que l’assistant de MyFinances : une seule saisie.
      </Text>
      <Field
        label="Clé API Anthropic"
        value={value}
        onChangeText={setValue}
        placeholder="sk-ant-…"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label="Enregistrer la clé" icon="key-outline" disabled={!valid} onPress={() => void setApiKey(value)} />
      <Text variant="caption" tone="muted">
        La clé reste sur ce téléphone (coffre sécurisé), jamais dans les exports. Les échanges sont facturés sur ton compte Anthropic.
      </Text>
      <Text variant="small" tone="accent" onPress={() => void Linking.openURL('https://platform.claude.com/settings/keys')}>
        Créer une clé sur platform.claude.com
      </Text>
    </Card>
  );
}

function Bubble({ m }: { m: Msg }) {
  const t = useTheme();
  if (typeof m.content !== 'string' && m.content.every((b) => b.type === 'tool_result')) return null;
  const text = visibleText(m);
  const tools =
    m.role === 'assistant' && typeof m.content !== 'string'
      ? m.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use')
      : [];
  const reads = tools.filter((b) => !WRITE_TOOL_NAMES.has(b.name));
  return (
    <View style={{ gap: 6, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
      {text !== '' &&
        (m.role === 'user' ? (
          <View style={{ maxWidth: '86%', backgroundColor: t.accentSoft, borderRadius: radius.lg, borderBottomRightRadius: radius.xs, paddingHorizontal: space.md, paddingVertical: space.sm + 2 }}>
            <Text selectable>{text}</Text>
          </View>
        ) : (
          <Glass radius={radius.lg} contentStyle={{ paddingHorizontal: space.md + 2, paddingVertical: space.md }}>
            <RichText text={text} />
          </Glass>
        ))}
      {reads.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {reads.map((b) => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 26, borderRadius: radius.pill, backgroundColor: t.surfaceAlt }}>
              <Ionicons name="reader-outline" size={12} color={t.textMuted} />
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {toolActivityLabel(b.name, toolInput(b.input))}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function ChangeCard({ change }: { change: ProposedChange }) {
  const t = useTheme();
  const decision = useCoach((s) => s.decisions[change.toolUseId]);
  const busy = useCoach((s) => s.busy);
  const decide = useCoach((s) => s.decide);
  return (
    <Card tone="accent" style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name="create-outline" size={18} color={t.accent} />
        <Text variant="label" tone="accent">
          Proposition
        </Text>
      </View>
      <Text variant="bodyStrong">{change.title}</Text>
      {change.details.map((d) => (
        <Text key={d} variant="small" tone="secondary">
          • {d}
        </Text>
      ))}
      {change.reason !== '' && (
        <Text variant="small" tone="muted">
          {change.reason}
        </Text>
      )}
      {decision === undefined ? (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
          <Button label="Refuser" variant="secondary" size="sm" style={{ flex: 1 }} disabled={busy} onPress={() => void decide(change.toolUseId, false)} />
          <Button label="Appliquer" icon="checkmark" size="sm" style={{ flex: 1 }} disabled={busy} onPress={() => void decide(change.toolUseId, true)} />
        </View>
      ) : (
        <Text variant="small" tone={decision ? 'accent' : 'muted'}>
          {decision ? 'Validé' : 'Refusé'}
        </Text>
      )}
    </Card>
  );
}

export default function CoachScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const apiKey = useCoach((s) => s.apiKey);
  const messages = useCoach((s) => s.messages);
  const pending = useCoach((s) => s.pending);
  const busy = useCoach((s) => s.busy);
  const error = useCoach((s) => s.error);
  const notice = useCoach((s) => s.notice);
  const applied = useCoach((s) => s.applied);
  const send = useCoach((s) => s.send);
  const retry = useCoach((s) => s.retry);
  const reset = useCoach((s) => s.reset);
  const mode = useCoach((s) => s.mode);
  const setMode = useCoach((s) => s.setMode);
  // Opened from a screen with a question ready (exercise, session summary, stagnation alert):
  // prefilled, never sent automatically — the user reads, edits and decides (each message costs).
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [draft, setDraft] = useState(typeof q === 'string' ? q : '');
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (useCoach.getState().apiKey === undefined) void useCoach.getState().init();
  }, []);

  const submit = (text: string) => {
    if (text.trim() === '' || busy || pending !== null) return;
    setDraft('');
    void send(text);
  };

  const ready = typeof apiKey === 'string';
  const empty = messages.length === 0;

  return (
    <Screen
      stack
      title="Coach IA"
      mood="today"
      scroll={false}
      maxWidth={760}
      right={ready && !empty ? <IconButton icon="refresh" label="Nouvelle conversation" color={t.text} onPress={reset} /> : undefined}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {apiKey === undefined && <ActivityIndicator color={t.accent} style={{ marginTop: space.xl }} />}
          {apiKey === null && <ApiKeySetup />}
          {ready && empty && (
            <View style={{ gap: space.md }}>
              <Text tone="secondary">
                Pose une question sur ton programme, tes séances ou ta progression. Le coach lit tes données ; ses propositions de changement
                attendent ta validation.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {SUGGESTIONS.map((s) => (
                  <Tap
                    key={s}
                    onPress={() => submit(s)}
                    accessibilityLabel={s}
                    scaleTo={0.97}
                    highlightRadius={radius.lg}
                    style={{ maxWidth: '100%', paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: radius.lg, backgroundColor: t.glass.pane.fill, borderWidth: 1, borderColor: t.glass.pane.rim }}>
                    <Text variant="small" style={{ fontFamily: family.semibold }}>
                      {s}
                    </Text>
                  </Tap>
                ))}
              </View>
            </View>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {pending?.changes.map((c) => (
            <ChangeCard key={c.toolUseId} change={c} />
          ))}
          {applied.length > 0 && pending === null && !busy && (
            <Text variant="caption" tone="accent">
              {applied[applied.length - 1]}
            </Text>
          )}
          {busy && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <ActivityIndicator size="small" color={t.accent} />
              <Text variant="small" tone="secondary">
                Le coach réfléchit…
              </Text>
            </View>
          )}
          {notice !== null && (
            <Text variant="small" tone="muted">
              {notice}
            </Text>
          )}
          {error !== null && (
            <Card tone="danger" style={{ gap: space.sm }}>
              <Text tone="danger">{error}</Text>
              <Button label="Réessayer" variant="secondary" size="sm" icon="refresh" onPress={() => void retry()} />
            </Card>
          )}
        </ScrollView>

        {ready && (
          <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: Math.max(insets.bottom, space.md), width: '100%', maxWidth: 760, alignSelf: 'center', gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm }}>
              {/* Model switch: Sonnet by default (fast, cheap), Opus for a deeper look. Visible so the user always knows what they are paying for. */}
              <Tap
                onPress={() => setMode(mode === 'deep' ? 'auto' : 'deep')}
                accessibilityRole="switch"
                accessibilityState={{ checked: mode === 'deep' }}
                accessibilityLabel="Analyse poussée (Opus, plus coûteux)"
                scaleTo={0.95}
                highlightRadius={radius.pill}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: space.sm + 2,
                  height: 26,
                  borderRadius: radius.pill,
                  backgroundColor: mode === 'deep' ? `${t.gold}22` : t.glass.pane.fill,
                  borderWidth: 1,
                  borderColor: mode === 'deep' ? `${t.gold}66` : t.glass.pane.rim,
                }}>
                <Ionicons name={mode === 'deep' ? 'bulb' : 'flash'} size={13} color={mode === 'deep' ? t.gold : t.textSecondary} />
                <Text variant="caption" style={{ color: mode === 'deep' ? t.gold : t.textSecondary, fontFamily: family.semibold }}>
                  {mode === 'deep' ? 'Analyse poussée' : 'Réponse rapide'}
                </Text>
              </Tap>
            </View>
            <Glass level="float" radius={radius.xl} contentStyle={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs, padding: 6, paddingLeft: space.md }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={pending !== null ? 'Valide ou refuse la proposition' : 'Écris au coach…'}
                placeholderTextColor={t.textMuted}
                selectionColor={t.accent}
                multiline
                maxFontSizeMultiplier={1.3}
                editable={pending === null}
                style={[
                  { flex: 1, minHeight: 40, maxHeight: 140, paddingVertical: 10, color: t.text, fontFamily: family.regular, fontSize: 15 },
                  Platform.OS === 'web' && { outlineWidth: 0, outlineColor: 'transparent' },
                ]}
              />
              <Tap
                onPress={() => submit(draft)}
                disabled={draft.trim() === '' || busy || pending !== null}
                accessibilityLabel="Envoyer"
                scaleTo={0.9}
                highlightRadius={20}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: draft.trim() === '' || busy || pending !== null ? t.surfaceAlt : t.accent,
                }}>
                <Ionicons name="arrow-up" size={20} color={draft.trim() === '' || busy || pending !== null ? t.textMuted : t.onAccent} />
              </Tap>
            </Glass>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
