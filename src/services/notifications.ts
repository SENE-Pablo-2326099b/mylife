import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

/**
 * Loaded lazily: Expo Go on Android no longer ships expo-notifications and importing it there
 * throws at module load, which would take every screen down with it. In Expo Go the rest timer
 * simply has no background notification (the in-app bar and haptics still work).
 */
let mod: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = Platform.OS === 'android' && isRunningInExpoGo() ? null : (require('expo-notifications') as NotificationsModule);
  } catch {
    mod = null;
  }
  return mod;
}

/**
 * Local "rest over" notification, only used when the app is backgrounded during rest.
 * Permission is requested from Settings only — never as a popup mid-workout.
 */
let configured = false;

function configure(): NotificationsModule | null {
  const Notifications = notifications();
  if (configured || Notifications === null) return Notifications;
  configured = true;
  Notifications.setNotificationHandler({
    // In foreground the in-app timer bar + haptics already signal the end.
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('rest', {
      name: 'Fin de repos',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
  }
  return Notifications;
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const Notifications = configure();
    if (Notifications === null) return false;
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function scheduleRestEnd(seconds: number): Promise<string | null> {
  try {
    const Notifications = configure();
    if (Notifications === null) return null;
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted || seconds <= 1) return null;
    return await Notifications.scheduleNotificationAsync({
      content: { title: 'Repos terminé', body: 'Série suivante 💪', sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(seconds),
        channelId: 'rest',
      },
    });
  } catch {
    return null;
  }
}

export async function cancelRestEnd(id: string | null): Promise<void> {
  if (id === null) return;
  try {
    await notifications()?.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered or never scheduled: nothing to do.
  }
}
