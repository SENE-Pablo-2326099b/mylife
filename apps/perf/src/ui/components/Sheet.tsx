import { BlurView } from 'expo-blur';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { springs } from '../motion';
import { useBreakpoint } from '../responsive';
import { LIVE_BLUR, radius, space, useTheme } from '../theme';
import { Glass } from './Glass';
import { Icon, Tap, Text, type IconName } from './primitives';

/**
 * A lens of glass floating over the app. On phones it rises from the bottom and can be thrown
 * back down (drag with resistance, velocity-aware); on large screens it is a centred panel that
 * settles into focus. The world behind dims and blurs — depth, not a black curtain.
 */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useBreakpoint() === 'expanded';
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  // Derived state: mount as soon as it becomes visible; unmount after the exit animation.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      drag.set(0);
      progress.set(withSpring(1, springs.soft));
    } else {
      progress.set(
        withTiming(0, { duration: 200 }, (done) => {
          if (done === true) scheduleOnRN(setMounted, false);
        }),
      );
    }
  }, [visible, progress, drag]);

  const pan = Gesture.Pan()
    .enabled(!wide)
    .activeOffsetY(8)
    .onUpdate((e) => {
      // Rubber band upward, free downward.
      drag.set(e.translationY > 0 ? e.translationY : e.translationY * 0.15);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) scheduleOnRN(onClose);
      else drag.set(withSpring(0, springs.liquid));
    });

  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panel = useAnimatedStyle(() =>
    wide
      ? {
          opacity: progress.value,
          transform: [{ scale: interpolate(progress.value, [0, 1], [0.94, 1]) }, { translateY: interpolate(progress.value, [0, 1], [24, 0]) }],
        }
      : {
          transform: [
            {
              translateY: interpolate(progress.value, [0, 1], [700, 0]) + drag.value,
            },
          ],
        },
  );

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, scrim]}>
          {LIVE_BLUR && <BlurView intensity={14} tint={t.blurTint} style={StyleSheet.absoluteFill} />}
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }]} onPress={onClose} accessibilityLabel="Fermer" />
        </Animated.View>
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            justifyContent: wide ? 'center' : 'flex-end',
            alignItems: 'center',
            padding: wide ? space.xl : space.sm,
          }}
        >
          <Animated.View
            style={[
              {
                width: '100%',
                maxWidth: wide ? 520 : 640,
                maxHeight: '88%',
                marginBottom: wide ? 0 : Math.max(insets.bottom - 4, 0),
              },
              panel,
            ]}
          >
            {/* The gesture sits on a plain inner view: on web, a detector wrapping the animated view takes over its ref and the slide-in never applies. */}
            <GestureDetector gesture={pan}>
              <View collapsable={false} style={{ maxHeight: '100%' }}>
                <Glass level="lens" radius={radius.xl + 4} contentStyle={{ overflow: 'hidden', maxHeight: '100%' }}>
                  <View
                    style={{
                      alignItems: 'center',
                      paddingTop: space.sm + 2,
                      paddingBottom: space.xs,
                    }}
                  >
                    {!wide && (
                      <View
                        style={{
                          width: 38,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor: t.textMuted,
                          opacity: 0.5,
                        }}
                      />
                    )}
                  </View>
                  {title !== undefined && (
                    <Text
                      variant="title"
                      style={{
                        paddingHorizontal: space.lg + 2,
                        paddingTop: space.xs,
                        paddingBottom: space.sm,
                      }}
                      numberOfLines={2}
                    >
                      {title}
                    </Text>
                  )}
                  <ScrollView keyboardShouldPersistTaps="handled" bounces={false} contentContainerStyle={{ paddingBottom: space.md }}>
                    {children}
                  </ScrollView>
                </Glass>
              </View>
            </GestureDetector>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export interface SheetAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
  hidden?: boolean;
}

/** Rows of actions (icon + label), as in an action sheet; each closes the sheet first. */
export function ActionList({ actions, onClose }: { actions: readonly SheetAction[]; onClose: () => void }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: space.sm, gap: 2 }}>
      {actions
        .filter((a) => a.hidden !== true)
        .map((a) => (
          <Tap
            key={a.label}
            onPress={() => {
              onClose();
              a.onPress();
            }}
            scaleTo={0.98}
            highlightRadius={radius.md}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.md,
              height: 54,
              borderRadius: radius.md,
            }}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: a.destructive === true ? t.dangerSoft : t.surfaceAlt,
              }}
            >
              <Icon name={a.icon} size={18} color={a.destructive === true ? t.danger : t.text} />
            </View>
            <Text variant="bodyStrong" tone={a.destructive === true ? 'danger' : 'default'}>
              {a.label}
            </Text>
          </Tap>
        ))}
    </View>
  );
}

export function ActionSheet({
  visible,
  onClose,
  title,
  actions,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  actions: readonly SheetAction[];
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ActionList actions={actions} onClose={onClose} />
    </Sheet>
  );
}
