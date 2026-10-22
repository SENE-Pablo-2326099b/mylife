import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import Animated, { FadeOutDown, ReduceMotion, ZoomIn } from 'react-native-reanimated';

import { useToast } from '@/state/toastStore';

import { radius, shade, space, useTheme } from '../theme';
import { Glass } from './Glass';
import { Tap, Text } from './primitives';

/** A floating glass capsule: feedback that never blocks, with an optional undo. */
export function ToastHost({ bottom }: { bottom: number }) {
  const t = useTheme();
  const toast = useToast((s) => s.toast);
  const dismiss = useToast((s) => s.dismiss);
  if (toast === null) return null;
  const gold = toast.tone === 'gold';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center', paddingHorizontal: space.lg }}>
      <Animated.View
        key={toast.id}
        entering={ZoomIn.springify().damping(16).stiffness(220).withInitialValues({ transform: [{ scale: 0.85 }] }).reduceMotion(ReduceMotion.System)}
        exiting={FadeOutDown.duration(160).reduceMotion(ReduceMotion.System)}
        style={{ maxWidth: 520, alignSelf: 'stretch', alignItems: 'center' }}>
        <Glass
          level="float"
          radius={radius.pill}
          style={gold ? { boxShadow: shade(`0px 10px 30px ${t.gold}55`) } : undefined}
          contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, paddingLeft: gold ? space.md : space.lg + 2, paddingRight: space.xs }}>
          {gold && (
            <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.goldSoft }}>
              <Ionicons name="trophy" size={17} color={t.gold} />
            </View>
          )}
          <Text variant="bodyStrong" style={{ flexShrink: 1, paddingVertical: space.sm, paddingRight: space.sm }}>
            {toast.message}
          </Text>
          {toast.actionLabel !== undefined && (
            <Tap
              onPress={() => {
                toast.onAction?.();
                dismiss();
              }}
              hitSlop={8}
              highlightRadius={radius.pill}
              style={{ paddingHorizontal: space.md + 2, height: 40, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: t.accentSoft }}>
              <Text variant="bodyStrong" tone="accent">
                {toast.actionLabel}
              </Text>
            </Tap>
          )}
        </Glass>
      </Animated.View>
    </View>
  );
}
