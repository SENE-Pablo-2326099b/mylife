import { setAppearance, useAppearance } from './appearance';
import { ThemePicker } from './extras';
import { Card, Divider, SectionTitle, ToggleRow } from './primitives';
import { Reveal } from './Screen';
import { themeInfo } from './themes';

/** Réglages d'apparence de MyLife : les mêmes dans toutes les apps, appliqués à toutes à la fois. */
export function AppearanceSettings() {
  const a = useAppearance();
  const info = themeInfo(a.theme);
  const pair = themeInfo(info.pair);
  const single = info.pair === a.theme;
  return (
    <>
      <Reveal index={0}>
        <SectionTitle className="!mt-0">Thème</SectionTitle>
        <p className="t-small -mt-1 mb-3 text-secondary">Le même thème habille toutes tes apps MyLife.</p>
        <ThemePicker value={a.theme} onChange={(theme) => setAppearance({ theme })} />
      </Reveal>
      <Reveal index={1}>
        <SectionTitle>Comportement</SectionTitle>
        <Card className="py-2">
          <ToggleRow
            label="Suivre le téléphone"
            hint={
              single
                ? `${info.name} n’a qu’un mode (${info.scheme === 'light' ? 'clair' : 'sombre'}) : ce réglage s’applique aux thèmes Lumen.`
                : `Passe sur ${pair.name} quand ton téléphone est en mode ${pair.scheme === 'light' ? 'clair' : 'sombre'}.`
            }
            checked={a.followSystem}
            onChange={(followSystem) => setAppearance({ followSystem })}
          />
          <Divider />
          <ToggleRow label="Retour haptique" hint="Légère vibration au toucher (Android)." checked={a.haptics} onChange={(haptics) => setAppearance({ haptics })} />
          <Divider />
          <ToggleRow
            label="Réduire les animations"
            hint="Coupe la dérive des halos et les apparitions. Le réglage du système est aussi respecté."
            checked={a.reduceMotion}
            onChange={(reduceMotion) => setAppearance({ reduceMotion })}
          />
        </Card>
      </Reveal>
    </>
  );
}
