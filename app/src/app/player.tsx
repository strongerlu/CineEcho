import Slider from '@react-native-community/slider';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerState, useSettings } from '../lib/hooks';
import { player } from '../lib/player';
import { GAP_OPTIONS, RATE_OPTIONS } from '../lib/storage';
import { colors, formatClock } from '../lib/theme';
import type { LoopMode } from '../lib/types';

const LOOP_LABEL: Record<LoopMode, string> = { none: '不循环', movie: '单部循环', list: '列表循环' };
const LOOP_ORDER: LoopMode[] = ['none', 'movie', 'list'];

function cycle<T>(list: T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const state = usePlayerState();
  const [settings, update] = useSettings();
  /** Slider value while the user is dragging; null otherwise. */
  const [drag, setDrag] = useState<number | null>(null);

  if (!state.movie) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>没有正在播放的电影</Text>
      </View>
    );
  }

  const active = state.playing || state.inGap;
  const shown = drag ?? state.position;
  const shownIndex = drag === null ? state.index : player.indexAt(drag);

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
      <Stack.Screen options={{ title: '' }} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={3}>{state.movie.title}</Text>
        <Text style={styles.counter}>
          第 {shownIndex + 1} / {state.count} 句{state.inGap ? '  · 停顿中' : ''}{state.finished ? '  · 已播完' : ''}
        </Text>
      </View>

      <Pressable
        accessibilityLabel={active ? '暂停' : '播放'}
        onPress={() => player.toggle()}
        style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}
      >
        <Text style={styles.playIcon}>{active ? '❚❚' : '▶'}</Text>
      </Pressable>

      <View>
        <Slider
          accessibilityLabel="播放进度"
          style={styles.slider}
          minimumValue={0}
          maximumValue={Math.max(state.duration, 1)}
          value={drag ?? state.position}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accent}
          onSlidingStart={(v) => setDrag(v)}
          onValueChange={(v) => setDrag((d) => (d === null ? d : v))}
          onSlidingComplete={(v) => {
            player.seekToTime(v);
            setDrag(null);
          }}
        />
        <View style={styles.timeRow}>
          <Text style={styles.time}>{formatClock(shown)}</Text>
          <Text style={styles.time}>{formatClock(state.duration)}</Text>
        </View>
      </View>
      <View style={styles.chips}>
        <Chip label={`语速 ${settings.rate}x`} onPress={() => update({ rate: cycle(RATE_OPTIONS, settings.rate) })} />
        <Chip label={`停顿 ${settings.gapSeconds}s`} onPress={() => update({ gapSeconds: cycle(GAP_OPTIONS, settings.gapSeconds) })} />
        <Chip label={LOOP_LABEL[settings.loopMode]} onPress={() => update({ loopMode: cycle(LOOP_ORDER, settings.loopMode) })} />
      </View>
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { color: colors.muted, fontSize: 16 },
  info: { alignItems: 'center', marginTop: 12 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  counter: { color: colors.muted, fontSize: 17, marginTop: 10 },
  playBtn: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { fontSize: 80, color: '#000', fontWeight: '900' },
  slider: { width: '100%', height: 48 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  time: { color: colors.muted, fontSize: 15, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  chip: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
