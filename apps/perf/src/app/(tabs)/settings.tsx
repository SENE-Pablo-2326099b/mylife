import Constants from "expo-constants";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { formatClock } from "@/domain/dates";
import { formatWeight } from "@/domain/math";
import { MUSCLES, type ExerciseCategory, type Intention, type Muscle } from "@/domain/types";
import { PERSONAL_BUILD, personalImporter } from "@/import/personal";
import { backupBeforeReplace, lastAutoBackupAt, shareLatestAutoBackup } from "@/services/autoBackup";
import { exportCsv, exportJson, importJson } from "@/services/exportService";
import { requestNotificationPermission } from "@/services/notifications";
import { useCloud } from "@/services/cloud";
import { openFinances } from "@/services/mylifeApps";
import { useCoach } from "@/state/coachStore";
import { useSettings } from "@/state/settingsStore";
import { showToast } from "@/state/toastStore";
import { useWorkoutStore } from "@/state/workoutStore";
import {
  Button,
  Card,
  Chip,
  Group,
  Disclosure,
  Row,
  SectionTitle,
  StepperRow,
  Text,
  Toggle,
} from "@/ui/components/primitives";
import { Columns } from "@/ui/components/layout";
import { Screen } from "@/ui/components/Screen";
import { Sheet } from "@/ui/components/Sheet";
import { ThemePicker } from "@/features/settings/ThemePicker";
import { MUSCLE_LABEL } from "@/ui/labels";
import { themeInfo } from "@/ui/themes";
import { space } from "@/ui/theme";

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Row
      title={title}
      subtitle={subtitle}
      right={<Toggle value={value} onValueChange={onChange} label={title} />}
    />
  );
}

const fmtRest = (s: number) => formatClock(s);
const PLATE_CHOICES = [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5] as const;
const FLOORS: readonly { key: ExerciseCategory; label: string }[] = [
  { key: "main", label: "Lifts principaux" },
  { key: "compound", label: "Polyarticulaires" },
  { key: "isolation", label: "Isolation" },
];
const INTENTIONS: readonly { key: Intention; label: string }[] = [
  { key: "power", label: "Puissance" },
  { key: "strength", label: "Force" },
  { key: "hypertrophy", label: "Hypertrophie" },
];

export default function SettingsScreen() {
  const cloud = useCloud();
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [importing, setImporting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [targeting, setTargeting] = useState(false);
  const autoAt = lastAutoBackupAt();

  const run = (label: string, task: () => Promise<void>) => () => {
    task().catch((e: unknown) =>
      showToast({
        message: `${label} : ${e instanceof Error ? e.message : "échec"}`,
      }),
    );
  };

  const setFloor = (cat: ExerciseCategory, v: number) =>
    update({
      rest: { ...settings.rest, floors: { ...settings.rest.floors, [cat]: v } },
    });
  const setIntention = (i: Intention, v: number) =>
    update({
      rest: {
        ...settings.rest,
        byIntention: { ...settings.rest.byIntention, [i]: v },
      },
    });

  return (
    <Screen title="Réglages" subtitle="Préférences" mood="settings">
      <Columns weights={[1, 1]}>
        <View>
          <SectionTitle title="Apparence" />
          <ThemePicker
            value={settings.theme}
            onChange={(theme) => update({ theme })}
          />
          <Group style={{ marginTop: space.md }}>
            <ToggleRow
              title="Suivre le téléphone"
              subtitle={
                themeInfo(settings.theme).pair === settings.theme
                  ? `${themeInfo(settings.theme).name} n’a qu’un mode : ce réglage s’applique aux thèmes Lumen`
                  : `Clair ou sombre selon le téléphone (${themeInfo(settings.theme).name} ↔ ${themeInfo(themeInfo(settings.theme).pair).name})`
              }
              value={settings.followSystem}
              onChange={(followSystem) => update({ followSystem })}
            />
          </Group>

          <SectionTitle title="Données" />
          <Group>
            <Row
              icon="lock-closed-outline"
              title="Compte MyLife"
              subtitle={!cloud.session ? "Synchroniser téléphone et ordinateur (chiffré)" : !cloud.joined ? `${cloud.session.login} · à relier à cet appareil` : `${cloud.session.login} · ${cloud.error ? "erreur de synchro" : "synchronisé"}`}
              onPress={() => router.push("/account")}
            />
            <Row
              icon="wallet-outline"
              title="Ouvrir MyFinances"
              subtitle="Ton budget et tes placements, même compte"
              onPress={openFinances}
            />
            <Row
              icon="download-outline"
              title="Exporter tout (JSON)"
              subtitle="Sauvegarde complète, réimportable"
              onPress={run("Export", exportJson)}
            />
            <Row
              icon="shield-checkmark-outline"
              title="Sauvegarde automatique"
              subtitle={
                Platform.OS === "web"
                  ? "Sur le téléphone : une copie par jour (5 gardées)"
                  : autoAt === null
                    ? "Une copie par jour sur le téléphone (5 gardées)"
                    : `Dernière copie : ${new Date(autoAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · toucher pour la partager`
              }
              onPress={() => {
                void shareLatestAutoBackup().then((ok) => {
                  if (!ok) showToast({ message: "Pas encore de copie automatique sur cet appareil" });
                });
              }}
            />
            <Row
              icon="cloud-upload-outline"
              title="Restaurer une sauvegarde"
              subtitle="Remplace les données actuelles"
              onPress={() => setImporting(true)}
            />
          </Group>
          <Disclosure title="Plus d’options de données">
            <Group>
              <Row
                icon="grid-outline"
                title="Exporter les séries (CSV)"
                subtitle="Pour un tableur"
                onPress={run("Export", exportCsv)}
              />
              {PERSONAL_BUILD && (
                <Row
                  icon="reload-outline"
                  title="Recharger mon programme"
                  subtitle="programme-reel.md + historique du Bloc 1 (remplace les données)"
                  onPress={() => setReloading(true)}
                />
              )}
            </Group>
          </Disclosure>
          <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
            Toutes les données restent sur ce téléphone. Pense à exporter de
            temps en temps.
          </Text>

          <SectionTitle title="Séance" />
          <Group>
            <ToggleRow
              title="Écran toujours allumé"
              subtitle="Pendant une séance en cours"
              value={settings.keepAwake}
              onChange={(keepAwake) => update({ keepAwake })}
            />
            <ToggleRow
              title="Repos automatique"
              subtitle="Le timer part dès qu’une série est validée"
              value={settings.restAutoStart}
              onChange={(restAutoStart) => update({ restAutoStart })}
            />
            <ToggleRow
              title="Notification de fin de repos"
              subtitle="Quand l’app est en arrière-plan"
              value={settings.restNotifications}
              onChange={(on) => {
                if (!on) return update({ restNotifications: false });
                void requestNotificationPermission().then((granted) => {
                  update({ restNotifications: granted });
                  if (!granted)
                    showToast({
                      message:
                        "Notifications refusées dans les réglages du téléphone",
                    });
                });
              }}
            />
          </Group>
        </View>
        <View>
          <SectionTitle title="Objectifs" />
          <Card style={{ gap: space.md }}>
            <StepperRow
              label="Séances par semaine"
              hint="Pour la régularité (Stats)"
              value={settings.weeklyGoal}
              min={1}
              max={7}
              onChange={(weeklyGoal) => update({ weeklyGoal })}
            />
            <StepperRow
              label="Poids de corps visé"
              hint="Projection dans le suivi corporel"
              value={settings.bodyweightGoal ?? 70}
              step={0.5}
              min={40}
              max={150}
              format={(v) => `${formatWeight(v)} kg`}
              onChange={(bodyweightGoal) => update({ bodyweightGoal })}
            />
          </Card>
          <Group style={{ marginTop: space.md }}>
            <Row
              icon="stats-chart-outline"
              title="Volume visé par muscle"
              subtitle={
                Object.entries(settings.volumeTargets)
                  .filter(([, v]) => v > 0)
                  .map(([m, v]) => `${MUSCLE_LABEL[m as Muscle] ?? m} ${v}`)
                  .join(" · ") || "Aucun objectif"
              }
              onPress={() => setTargeting(true)}
            />
            <Row
              icon="body-outline"
              title="Suivi corporel"
              subtitle="Poids de corps, mensurations"
              onPress={() => router.push("/body")}
            />
          </Group>

          <SectionTitle title="Coach IA" />
          <Group>
            <Row
              icon="sparkles-outline"
              title="Ouvrir le coach"
              subtitle="Rapide (Sonnet) par défaut, « Analyse poussée » (Opus) au besoin"
              onPress={() => router.push("/coach")}
            />
            <Row
              icon="key-outline"
              title="Retirer la clé API"
              subtitle="Supprime la clé Anthropic de ce téléphone"
              onPress={() => {
                void useCoach
                  .getState()
                  .setApiKey(null)
                  .then(() => showToast({ message: "Clé API retirée" }));
              }}
            />
          </Group>

          <Disclosure title="Charges et disques" summary={`incrément ${formatWeight(settings.increment)} kg`}>
            <Card style={{ gap: space.md }}>
              <StepperRow
                label="Incrément de charge"
                hint="Par défaut, pour tous les exercices"
                value={settings.increment}
                step={0.25}
                min={0.25}
                max={10}
                format={(v) => `${formatWeight(v)} kg`}
                onChange={(increment) => update({ increment })}
              />
              <StepperRow
                label="Backoff par défaut"
                hint="Nouveaux exercices"
                value={settings.defaultBackoffPercent}
                step={0.05}
                min={0.5}
                max={0.95}
                format={(v) => `${Math.round(v * 100)} %`}
                onChange={(defaultBackoffPercent) =>
                  update({ defaultBackoffPercent })
                }
              />
              <StepperRow
                label="Barre à vide"
                hint="Pour le calculateur de disques"
                value={settings.barWeight}
                step={2.5}
                min={5}
                max={30}
                format={(v) => `${formatWeight(v)} kg`}
                onChange={(barWeight) => update({ barWeight })}
              />
              <Text variant="label" tone="secondary">
                Disques disponibles
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {PLATE_CHOICES.map((p) => {
                  const on = settings.plates.includes(p);
                  return (
                    <Chip
                      key={p}
                      label={`${String(p).replace(".", ",")} kg`}
                      selected={on}
                      onPress={() =>
                        update({
                          plates: on
                            ? settings.plates.filter((x) => x !== p)
                            : [...settings.plates, p].sort((a, b) => b - a),
                        })
                      }
                    />
                  );
                })}
              </View>
            </Card>
          </Disclosure>

          <Disclosure title="Temps de repos" summary={`principaux ${fmtRest(settings.rest.floors.main)}`}>
            <Card style={{ gap: space.sm }}>
              <Text variant="small" tone="secondary">
                Repos = valeur de l’intention, jamais sous le plancher de la
                catégorie d’exercice.
              </Text>
              <Text variant="label" tone="secondary" style={{ marginTop: space.sm }}>
                Planchers par catégorie
              </Text>
              {FLOORS.map(({ key, label }) => (
                <StepperRow
                  key={key}
                  label={label}
                  value={settings.rest.floors[key]}
                  step={15}
                  min={0}
                  max={900}
                  format={fmtRest}
                  onChange={(v) => setFloor(key, v)}
                />
              ))}
              <Text variant="label" tone="secondary" style={{ marginTop: space.sm }}>
                Par intention
              </Text>
              {INTENTIONS.map(({ key, label }) => (
                <StepperRow
                  key={key}
                  label={label}
                  value={settings.rest.byIntention[key]}
                  step={15}
                  min={15}
                  max={900}
                  format={fmtRest}
                  onChange={(v) => setIntention(key, v)}
                />
              ))}
              <StepperRow
                label="Après un échauffement"
                value={settings.rest.warmup}
                step={15}
                min={0}
                max={300}
                format={fmtRest}
                onChange={(warmup) =>
                  update({ rest: { ...settings.rest, warmup } })
                }
              />
            </Card>
          </Disclosure>
        </View>
      </Columns>

      <Text
        variant="caption"
        tone="muted"
        style={{ marginTop: space.xl, textAlign: "center" }}
      >
        MyPerf {Constants.expoConfig?.version ?? ""}
      </Text>

      <Sheet
        visible={targeting}
        onClose={() => setTargeting(false)}
        title="Volume visé par muscle"
      >
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Text variant="small" tone="secondary">
            Séries effectives par semaine (muscle secondaire = ½). 0 = pas
            d’objectif. Ton programme : triceps ~9, biceps ~13.
          </Text>
          {MUSCLES.map((m) => (
            <StepperRow
              key={m}
              label={MUSCLE_LABEL[m]}
              value={settings.volumeTargets[m] ?? 0}
              min={0}
              max={30}
              format={(v) => (v === 0 ? "–" : String(v))}
              onChange={(v) =>
                update({ volumeTargets: { ...settings.volumeTargets, [m]: v } })
              }
            />
          ))}
        </View>
      </Sheet>
      <Sheet
        visible={importing}
        onClose={() => setImporting(false)}
        title="Restaurer une sauvegarde"
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text tone="secondary">
            Toutes les données actuelles seront remplacées par celles du
            fichier. Exporte d’abord si tu as un doute.
          </Text>
          <Button
            label="Choisir le fichier et remplacer"
            variant="danger"
            icon="cloud-upload-outline"
            onPress={() => {
              setImporting(false);
              const saved = backupBeforeReplace();
              importJson()
                .then((n) => {
                  if (n === null) return;
                  useSettings.getState().hydrate();
                  useWorkoutStore.setState({ docs: {} });
                  showToast(
                    {
                      message: `Sauvegarde restaurée (${n} éléments)${saved ? " — copie des données d’avant gardée sur le téléphone" : ""}`,
                    },
                    6000,
                  );
                })
                .catch((e: unknown) =>
                  showToast({
                    message: `Import impossible : ${e instanceof Error ? e.message : "fichier invalide"}`,
                  }),
                );
            }}
          />
          <Button
            label="Annuler"
            variant="secondary"
            onPress={() => setImporting(false)}
          />
        </View>
      </Sheet>
      <Sheet
        visible={reloading}
        onClose={() => setReloading(false)}
        title="Recharger mon programme"
      >
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text tone="secondary">
            Efface les séances, templates, cycles et mesures actuels, puis
            recharge le programme réel (5 séances types, Bloc 1 + 3 cycles) et
            l’historique du 8 sept. au 4 oct. Les réglages sont conservés.
          </Text>
          <Button
            label="Exporter d’abord (JSON)"
            variant="secondary"
            icon="download-outline"
            onPress={run("Export", exportJson)}
          />
          <Button
            label="Effacer et recharger"
            variant="danger"
            icon="reload-outline"
            onPress={() => {
              setReloading(false);
              const saved = backupBeforeReplace();
              try {
                const r = personalImporter()!.replaceWithPersonalData();
                useWorkoutStore.setState({ docs: {} });
                showToast(
                  {
                    message: `${r.workouts} séances, ${r.csvSets + r.recoveredSets} séries chargées${saved ? " — copie des données d’avant gardée sur le téléphone" : ""}`,
                  },
                  6000,
                );
              } catch (e: unknown) {
                showToast({
                  message: `Échec : ${e instanceof Error ? e.message : "erreur"} — rien n’a été modifié`,
                });
              }
            }}
          />
          <Button
            label="Annuler"
            variant="secondary"
            onPress={() => setReloading(false)}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
