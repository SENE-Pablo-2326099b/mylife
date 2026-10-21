import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { today } from '@/domain/dates';

/**
 * Today's date that follows the clock: an app left open overnight (or resumed from the background
 * the next morning) moves to the new day instead of showing yesterday's plan.
 */
export function useToday(): string {
  const [date, setDate] = useState(today);
  useEffect(() => {
    const refresh = () => setDate((d) => (d === today() ? d : today()));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    // Also roll over at midnight while the screen stays open.
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5).getTime() - now.getTime();
    const timer = setTimeout(refresh, midnight);
    return () => {
      sub.remove();
      clearTimeout(timer);
    };
  }, [date]);
  return date;
}
