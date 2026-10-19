import { updateSettings } from '../../db/seed';
import { useSettings } from '../../hooks';
import { ThemePicker } from '../../ui/extras';
import { Card, Divider, Reveal, SectionTitle, ToggleRow } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { isThemeId, themeInfo } from '../../ui/themes';

export default function AppearancePage() {
  const s = useSettings();
  const theme = isThemeId(s.theme) ? s.theme : 'nuit';
  const pair = themeInfo(themeInfo(theme).pair);
  return (
    <Screen stack title="Apparence" kicker="Lumen · verre et lumière" mood="settings" back="/reglages">
      <Reveal index={0}>
        <SectionTitle className="!mt-0">Thème</SectionTitle>
        <ThemePicker value={theme} onChange={(id) => void updateSettings({ theme: id })} />
      </Reveal>
      <Reveal index={1}>
        <SectionTitle>Comportement</SectionTitle>
        <Card className="py-2">
          <ToggleRow
            label="Suivre le téléphone"
            hint={`Passe sur ${pair.name} quand ton téléphone est en mode ${pair.scheme === 'light' ? 'clair' : 'sombre'}.`}
            checked={s.followSystem}
            onChange={(followSystem) => void updateSettings({ followSystem })}
          />
          <Divider />
          <ToggleRow label="Retour haptique" hint="Légère vibration au toucher (Android)." checked={s.haptics} onChange={(haptics) => void updateSettings({ haptics })} />
          <Divider />
          <ToggleRow label="Réduire les animations" hint="Coupe la dérive des halos et les apparitions. Le réglage du système est aussi respecté." checked={s.reduceMotion} onChange={(reduceMotion) => void updateSettings({ reduceMotion })} />
        </Card>
      </Reveal>
    </Screen>
  );
}
