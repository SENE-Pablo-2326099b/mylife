import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { flushExpoDb } from '@/db/expoDriver';
import { parseProgramInput, readProgram, WEEKDAY_NAMES, type ParseResult } from '@/domain/program/format';
import { canonical, matchExercise, type LibraryEntry } from '@/domain/program/match';
import { summarizePlan, type ImportPlan, type PlanExercise } from '@/domain/program/plan';
import { programPrompt } from '@/domain/program/prompt';
import { READY_PROGRAMS } from '@/domain/program/ready';
import { applyPlan, exerciseLibrary, exportProgram, hasWeekPattern, planFor, type ImportResult, type PatternMode } from '@/services/programImport';
import { CAN_PICK_FILE, copyOrShare, openUrl, pickTextFile, shareProgramFile } from '@/services/programShare';
import { useSettings } from '@/state/settingsStore';
import { showToast } from '@/state/toastStore';
import { Badge, Button, Card, Chip, Disclosure, Field, Group, Row, SectionTitle, Segmented, Text, Toggle } from '@/ui/components/primitives';
import { Screen } from '@/ui/components/Screen';
import { space, useTheme } from '@/ui/theme';

/**
 * Importer un programme, sans rien ressaisir : avec l'IA gratuite de son choix (instructions à copier,
 * réponse à coller), en collant son programme tel quel (« Squat 4x8 @75% »), depuis un fichier, ou en
 * partant d'un programme prêt. Toujours un aperçu à corriger avant d'enregistrer. Aussi : exporter le sien.
 */

const AIS = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Gemini', url: 'https://gemini.google.com/app' },
  { name: 'Le Chat', url: 'https://chat.mistral.ai/chat' },
  { name: 'Claude', url: 'https://claude.ai/new' },
];
const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type Step = { kind: 'source' } | { kind: 'preview'; plan: ImportPlan; issues: string[]; from: string } | { kind: 'done'; result: ImportResult; name: string };

function StepNumber({ n }: { n: number }) {
  const t = useTheme();
  return (
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="small" tone="accent" style={{ fontWeight: '700' }}>
        {n}
      </Text>
    </View>
  );
}

function Source({ onParsed }: { onParsed: (r: ParseResult, from: string) => void }) {
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const analyse = (value: string, from: string) => {
    const r = parseProgramInput(value);
    if (r.program) onParsed(r, from);
    else setProblems(r.issues.length ? r.issues : ['Rien à importer.']);
  };
  const copyPrompt = async () => {
    const r = await copyOrShare(programPrompt(), 'Instructions pour ton IA');
    if (r === 'copied') showToast({ message: 'Instructions copiées : colle-les dans ton IA' });
    else if (r === 'failed') showToast({ message: 'Copie impossible : sélectionne le texte de l’aperçu ci-dessous' });
  };
  const exportMine = async () => {
    let file;
    try {
      file = exportProgram();
    } catch (e) {
      console.error('export', e);
      return showToast({ message: `Export impossible : ${e instanceof Error ? e.message : String(e)}` });
    }
    if (!file.sessions.length) return showToast({ message: 'Aucune séance type à exporter pour l’instant' });
    const r = await shareProgramFile(JSON.stringify(file, null, 2), 'mon-programme-myperf.json');
    if (r === 'downloaded') showToast({ message: 'Programme exporté (fichier .json)' });
    else if (r === 'failed') showToast({ message: 'Export impossible sur cet appareil' });
  };

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <View style={{ gap: space.md }}>
          <Text variant="headline">Avec ton IA, gratuite</Text>
          <Text tone="secondary">ChatGPT, Gemini, Le Chat… lit ton programme sous n’importe quelle forme (texte, PDF, capture, photo) et le met au format de MyPerf.</Text>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <StepNumber n={1} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Text>Copie les instructions.</Text>
              <Button label="Copier les instructions" icon="copy-outline" variant="secondary" onPress={() => void copyPrompt()} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <StepNumber n={2} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Text>Ouvre ton IA, colle-les, puis ajoute ton programme (texte, fichier ou photo).</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {AIS.map((a) => (
                  <Chip key={a.name} label={a.name} small icon="open-outline" onPress={() => openUrl(a.url)} />
                ))}
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <StepNumber n={3} />
            <Text style={{ flex: 1 }}>Copie sa réponse et colle-la ci-dessous.</Text>
          </View>
        </View>
      </Card>

      <View style={{ gap: space.sm }}>
        <Field
          label="Ta réponse d’IA, ou ton programme tel quel"
          value={text}
          onChangeText={(v) => {
            setText(v);
            setProblems([]);
          }}
          multiline
          placeholder={'Colle ici… ou écris une ligne par exercice :\nLundi – Push\nDéveloppé couché 4x6-8 @75%\nÉlévations latérales 3x15 repos 1min'}
          style={{ minHeight: 170, paddingVertical: space.md, textAlignVertical: 'top' }}
          accessibilityLabel="Programme à importer"
        />
        {problems.length > 0 && (
          <Card>
            {problems.slice(0, 5).map((p) => (
              <Text key={p} variant="small" tone="warning">
                {p}
              </Text>
            ))}
          </Card>
        )}
        <Button label="Voir l’aperçu" icon="eye-outline" disabled={!text.trim()} onPress={() => analyse(text, 'Programme collé')} />
        {CAN_PICK_FILE && (
          <Button
            label="Ouvrir un fichier (.json, .txt)"
            icon="document-outline"
            variant="ghost"
            onPress={() =>
              void pickTextFile().then((content) => {
                if (content !== null) {
                  setText(content);
                  analyse(content, 'Fichier');
                }
              })
            }
          />
        )}
        <Disclosure title="Voir les instructions" summary="Ce que ton IA reçoit">
          <Text variant="caption" tone="secondary" selectable>
            {programPrompt()}
          </Text>
        </Disclosure>
      </View>

      <View>
        <SectionTitle title="Ou pars d’un programme prêt" />
        <Group>
          {READY_PROGRAMS.map((p) => (
            <Row key={p.id} title={p.title} subtitle={`${p.level} · ${p.summary}`} icon="barbell-outline" onPress={() => onParsed(readProgram(p.file), p.title)} />
          ))}
        </Group>
      </View>

      <View>
        <SectionTitle title="Exporter ton programme" />
        <Card>
          <View style={{ gap: space.sm }}>
            <Text tone="secondary">Tes séances types, ta semaine type et tes 1RM dans ce même format : à garder, à envoyer à un pote, à réimporter ailleurs.</Text>
            <Button label="Exporter mon programme" icon="share-outline" variant="secondary" onPress={() => void exportMine()} />
          </View>
        </Card>
      </View>
    </View>
  );
}

function matchLabel(e: PlanExercise, names: Map<string, string>): { text: string; color: string; badge: string } {
  if (e.exerciseId === null) return { text: `Nouvel exercice : ${e.parsed.name}`, color: '#E3A33B', badge: 'Nouveau' };
  const name = names.get(e.exerciseId) ?? e.parsed.name;
  if (e.exerciseId === e.match.exerciseId && e.match.kind === 'close') return { text: name, color: '#E3A33B', badge: 'À vérifier' };
  return { text: name, color: '#3BB273', badge: e.exerciseId === e.match.exerciseId ? 'Reconnu' : 'Choisi' };
}

function ExerciseLine({ e, library, names, onChoose }: { e: PlanExercise; library: LibraryEntry[]; names: Map<string, string>; onChoose: (id: string | null) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const label = matchLabel(e, names);
  // « max » et les durées sont déjà dans les consignes (notes) : pas deux fois.
  const reps = e.parsed.amrap || e.parsed.seconds !== null || e.repMin === null ? null : e.repMax !== null && e.repMax !== e.repMin ? `${e.repMin}-${e.repMax}` : `${e.repMin}`;
  const written = e.exerciseId !== null && (names.get(e.exerciseId) ?? e.parsed.name) !== e.parsed.name;
  const suggestions = useMemo(() => {
    const q = canonical(query || e.parsed.name);
    const words = q.split(' ').filter((w) => w.length > 2);
    const scored = library
      .map((l) => ({ l, c: canonical(l.name) }))
      .filter(({ c }) => !q || c.includes(q) || words.some((w) => c.includes(w)))
      .slice(0, 8)
      .map(({ l }) => l);
    const best = matchExercise(query || e.parsed.name, library).exerciseId;
    const first = best ? library.find((l) => l.id === best) : undefined;
    return first ? [first, ...scored.filter((l) => l.id !== first.id)].slice(0, 8) : scored;
  }, [query, library, e.parsed.name]);

  return (
    <View style={{ paddingVertical: space.sm, gap: space.xs }}>
      <Row
        title={label.text}
        subtitle={`${reps === null ? `${e.sets} série${e.sets > 1 ? 's' : ''}` : `${e.sets} × ${reps}`}${e.notes ? ` · ${e.notes}` : ''}${written ? ` · écrit « ${e.parsed.name} »` : ''}`}
        right={<Badge label={label.badge} color={label.color} />}
        onPress={() => setOpen((o) => !o)}
        style={{ paddingHorizontal: 0 }}
      />
      {open && (
        <View style={{ gap: space.sm, paddingBottom: space.sm }}>
          <Field value={query} onChangeText={setQuery} placeholder="Chercher un exercice de ta bibliothèque" accessibilityLabel="Chercher un exercice" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {suggestions.map((s) => (
              <Chip
                key={s.id}
                label={s.name}
                small
                selected={e.exerciseId === s.id}
                onPress={() => {
                  onChoose(s.id);
                  setOpen(false);
                }}
              />
            ))}
            <Chip
              label={`Créer « ${e.parsed.name} »`}
              small
              icon="add"
              tone={t.gold}
              selected={e.exerciseId === null}
              onPress={() => {
                onChoose(null);
                setOpen(false);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function Preview({ plan, issues, from, onChange, onBack, onImported }: { plan: ImportPlan; issues: string[]; from: string; onChange: (p: ImportPlan) => void; onBack: () => void; onImported: (r: ImportResult) => void }) {
  const library = useMemo(() => exerciseLibrary(), []);
  const names = useMemo(() => new Map(library.map((l) => [l.id, l.name])), [library]);
  const hadPattern = useMemo(() => hasWeekPattern(), []);
  const hasDays = plan.sessions.some((s) => s.weekdays.length > 0);
  const [pattern, setPattern] = useState<PatternMode>(hadPattern ? 'add' : 'replace');
  const [oneRms, setOneRms] = useState(true);
  const summary = summarizePlan(plan);
  const setSession = (i: number, patch: Partial<ImportPlan['sessions'][number]>) => onChange({ ...plan, sessions: plan.sessions.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    const mode: PatternMode = hasDays ? pattern : 'keep';
    const result = applyPlan(plan, { pattern: mode, oneRms });
    // Sur le web, la base s'enregistre en différé : un import ne doit pas se perdre si la page se ferme juste après.
    await flushExpoDb();
    // La semaine type vient d'être posée : l'objectif de séances (et la quête Force du Personnage) la suit.
    if (mode === 'replace' && result.patternEntries > 0) useSettings.getState().update({ weeklyGoal: Math.max(1, Math.min(7, result.patternEntries)) });
    onImported(result);
  };

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <View style={{ gap: space.xs }}>
          <Text variant="label" tone="muted">
            {from}
          </Text>
          <Text variant="headline">{plan.name}</Text>
          <Text tone="secondary">
            {summary.sessions} séance{summary.sessions > 1 ? 's' : ''} · {summary.exercises} exercices · {summary.recognized} reconnus
            {summary.created > 0 ? ` · ${summary.created} nouveau${summary.created > 1 ? 'x' : ''}` : ''}
          </Text>
          <Text variant="small" tone="muted">
            Touche un exercice pour choisir un autre de ta bibliothèque. Rien n’est enregistré avant « Importer ».
          </Text>
        </View>
      </Card>

      {issues.length > 0 && (
        <Disclosure title={`${issues.length} remarque${issues.length > 1 ? 's' : ''}`} summary="Ce qui a été corrigé ou ignoré">
          {issues.map((i) => (
            <Text key={i} variant="small" tone="secondary">
              {i}
            </Text>
          ))}
        </Disclosure>
      )}

      {plan.sessions.map((s, si) => (
        <Card key={si}>
          <View style={{ gap: space.sm }}>
            <Field value={s.name} onChangeText={(name) => setSession(si, { name })} accessibilityLabel={`Nom de la séance ${si + 1}`} />
            <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
              {DAY_LETTERS.map((l, d) => (
                <Chip
                  key={d}
                  label={l}
                  small
                  selected={s.weekdays.includes(d)}
                  onPress={() => setSession(si, { weekdays: s.weekdays.includes(d) ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d].sort((a, b) => a - b) })}
                />
              ))}
              <Text variant="caption" tone="muted" style={{ alignSelf: 'center' }} accessibilityLabel={`Jours : ${s.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ') || 'aucun'}`}>
                {s.weekdays.length ? '' : 'jours : aucun'}
              </Text>
            </View>
            {s.exercises.map((e, ei) => (
              <ExerciseLine
                key={ei}
                e={e}
                library={library}
                names={names}
                onChoose={(id) => setSession(si, { exercises: s.exercises.map((x, k) => (k === ei ? { ...x, exerciseId: id } : x)) })}
              />
            ))}
          </View>
        </Card>
      ))}

      {plan.sessions.some((s) => s.weekdays.length > 0) && (
        <View style={{ gap: space.sm }}>
          <SectionTitle title="Ta semaine type" />
          <Segmented
            options={[
              { value: 'replace', label: 'Remplacer' },
              { value: 'add', label: 'Ajouter' },
              { value: 'keep', label: 'Ne pas toucher' },
            ]}
            value={pattern}
            onChange={setPattern}
          />
          <Text variant="small" tone="muted">
            {pattern === 'replace' ? 'Les jours du programme deviennent ta semaine type (ton objectif de séances suit).' : pattern === 'add' ? 'Les séances s’ajoutent aux jours déjà prévus.' : 'Les séances sont créées, ta semaine type ne change pas.'}
          </Text>
        </View>
      )}

      {plan.oneRms.length > 0 && <Toggle value={oneRms} onValueChange={setOneRms} label={`Enregistrer les ${plan.oneRms.length} 1RM du programme (sans écraser les tiens)`} />}

      <Button label={`Importer ${summary.sessions} séance${summary.sessions > 1 ? 's' : ''}`} icon="checkmark" size="lg" onPress={() => void save()} />
      <Button label="Retour" variant="ghost" onPress={onBack} />
    </View>
  );
}

export default function ProgramImportScreen() {
  const [step, setStep] = useState<Step>({ kind: 'source' });

  return (
    <Screen stack title="Importer un programme" mood="planning">
      {step.kind === 'source' && (
        <Source
          onParsed={(r, from) => {
            if (!r.program) return;
            setStep({ kind: 'preview', plan: planFor(r.program), issues: r.issues, from: r.source === 'text' && from === 'Programme collé' ? 'Programme collé (texte)' : from });
          }}
        />
      )}
      {step.kind === 'preview' && (
        <Preview
          plan={step.plan}
          issues={step.issues}
          from={step.from}
          onChange={(plan) => setStep({ ...step, plan })}
          onBack={() => setStep({ kind: 'source' })}
          onImported={(result) => {
            showToast({ message: `Programme importé : ${result.templates.length} séance${result.templates.length > 1 ? 's' : ''}` }, 4000);
            setStep({ kind: 'done', result, name: step.plan.name });
          }}
        />
      )}
      {step.kind === 'done' && (
        <Card>
          <View style={{ gap: space.md }}>
            <Text variant="headline">C’est prêt</Text>
            <Text tone="secondary">
              « {step.name} » : {step.result.templates.length} séance{step.result.templates.length > 1 ? 's' : ''} type
              {step.result.createdExercises > 0 ? `, ${step.result.createdExercises} exercice${step.result.createdExercises > 1 ? 's' : ''} ajouté${step.result.createdExercises > 1 ? 's' : ''} à ta bibliothèque` : ''}
              {step.result.patternEntries > 0 ? `, ${step.result.patternEntries} jour${step.result.patternEntries > 1 ? 's' : ''} dans ta semaine type` : ''}
              {step.result.oneRms > 0 ? `, ${step.result.oneRms} 1RM` : ''}.
            </Text>
            <Button label="Voir mes séances" icon="calendar-outline" onPress={() => router.replace('/planning?vue=programme')} />
            <Button label="Importer un autre programme" variant="ghost" onPress={() => setStep({ kind: 'source' })} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
