import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { login, normalizeServerUrl } from '../lib/api';
import { useSettings } from '../lib/hooks';
import { GAP_OPTIONS, RATE_OPTIONS, setToken } from '../lib/storage';
import { colors } from '../lib/theme';
import type { LoopMode } from '../lib/types';

const LOOP_OPTIONS: { value: LoopMode; label: string }[] = [
  { value: 'none', label: '不循环' },
  { value: 'movie', label: '单部循环' },
  { value: 'list', label: '列表循环' },
];

export default function SettingsScreen() {
  const [settings, update] = useSettings();
  const [url, setUrl] = useState(settings.serverUrl);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onLogin = async () => {
    const serverUrl = normalizeServerUrl(url);
    if (!serverUrl || !password) return Alert.alert('请填写服务器地址和密码');
    setBusy(true);
    try {
      const token = await login(serverUrl, password);
      await setToken(token);
      update({ serverUrl });
      setPassword('');
      router.back();
    } catch (e) {
      Alert.alert('登录失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>服务器</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="例如 https://cineecho.example.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="密码"
        placeholderTextColor={colors.muted}
        secureTextEntry
      />
      <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={onLogin} disabled={busy}>
        {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>登录并保存</Text>}
      </Pressable>
      {settings.serverUrl ? <Text style={styles.hint}>当前服务器：{settings.serverUrl}</Text> : null}

      <Text style={styles.section}>语速</Text>
      <Options
        options={RATE_OPTIONS.map((r) => ({ value: r, label: `${r}x` }))}
        value={settings.rate}
        onChange={(rate) => update({ rate })}
      />

      <Text style={styles.section}>句间停顿</Text>
      <Options
        options={GAP_OPTIONS.map((g) => ({ value: g, label: `${g}s` }))}
        value={settings.gapSeconds}
        onChange={(gapSeconds) => update({ gapSeconds })}
      />

      <Text style={styles.section}>循环模式</Text>
      <Options options={LOOP_OPTIONS} value={settings.loopMode} onChange={(loopMode) => update({ loopMode })} />

      <Text style={styles.hint}>
        开车时可用锁屏、蓝牙耳机、车机或方向盘的“上一曲 / 下一曲”按句跳转，锁屏会显示当前这句英文。
      </Text>
    </ScrollView>
  );
}

function Options<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.options}>
      {options.map((o) => (
        <Pressable
          key={String(o.value)}
          onPress={() => onChange(o.value)}
          style={[styles.option, o.value === value && styles.optionActive]}
        >
          <Text style={[styles.optionText, o.value === value && styles.optionTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  section: { color: colors.muted, fontSize: 14, marginTop: 24, marginBottom: 10, fontWeight: '600' },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 13, marginTop: 12, lineHeight: 19 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  optionActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { color: colors.text, fontSize: 15 },
  optionTextActive: { color: '#000', fontWeight: '700' },
});
