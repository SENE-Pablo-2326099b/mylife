import { AppearanceSettings } from '../ui/AppearanceSettings';
import { Screen } from '../ui/Screen';
import { useAppearance } from '../ui/appearance';
import { themeInfo } from '../ui/themes';

export function AppearancePage() {
  const info = themeInfo(useAppearance().theme);
  return (
    <Screen title="Apparence" kicker={`${info.name} · ${info.pair === info.id ? 'identité' : 'Lumen'}`} mood="settings">
      <AppearanceSettings />
    </Screen>
  );
}
