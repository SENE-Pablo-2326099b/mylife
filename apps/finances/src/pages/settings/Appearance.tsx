import { AppearanceSettings } from '../../ui/AppearanceSettings';
import { Screen } from '../../ui/Screen';
import { useAppearance } from '../../ui/appearance';
import { themeInfo } from '../../ui/themes';

export default function AppearancePage() {
  const info = themeInfo(useAppearance().theme);
  return (
    <Screen stack title="Apparence" kicker={`${info.name} · ${info.pair === info.id ? 'identité' : 'Lumen'}`} mood="settings" back="/reglages">
      <AppearanceSettings />
    </Screen>
  );
}
