import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Platform } from 'react-native';

import { Dock, Sidebar } from '@/features/navigation/Navigation';
import { useKeypadShortcuts } from '@/features/workout/Keypad';
import { useBreakpoint } from '@/ui/responsive';

/**
 * Navigation adapts instead of shrinking: a floating glass dock on phones and tablets (it turns
 * into the keypad while logging), a glass sidebar on desktop.
 */
export default function TabsLayout() {
  const bp = useBreakpoint();
  const wide = bp === 'expanded';
  useKeypadShortcuts();
  return (
    <Tabs
      tabBar={(props: BottomTabBarProps) => (wide ? <Sidebar {...props} /> : <Dock {...props} />)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        sceneStyle: { backgroundColor: 'transparent' },
        // Android: instant switch. Cross-fading two full screens of glass stutters there.
        animation: Platform.OS === 'android' ? 'none' : 'shift',
      }}>
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="planning" options={{ title: 'Planning' }} />
      <Tabs.Screen name="exercises" options={{ title: 'Exercices' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="settings" options={{ title: 'Réglages' }} />
    </Tabs>
  );
}
