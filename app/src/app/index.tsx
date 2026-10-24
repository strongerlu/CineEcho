import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fetchMovies } from '../lib/api';
import {
  cancelDownload,
  deleteLocalMovie,
  downloadMovie,
  getDownloadState,
  listLocalMovies,
  posterSource,
  syncLocalMovie,
} from '../lib/downloads';
import { useDownloadsVersion, usePlayerState, useSettings } from '../lib/hooks';
import { player } from '../lib/player';
import { colors, formatDuration, formatSize } from '../lib/theme';
import type { LocalMovie, PosterSource, RemoteMovie } from '../lib/types';

interface Row {
  id: string;
  title: string;
  remote?: RemoteMovie;
  local?: LocalMovie;
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const [settings] = useSettings();
  const downloadsVersion = useDownloadsVersion();
  const playerState = usePlayerState();
  const [remote, setRemote] = useState<RemoteMovie[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    if (!settings.serverUrl) return;
    setLoading(true);
    try {
      const movies = await fetchMovies();
      setRemote(movies);
      setError(null);
      movies.forEach((m) => void syncLocalMovie(m));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? '登录已失效，请在设置中重新登录' : '离线模式：仅显示已下载的电影');
    } finally {
      setLoading(false);
    }
  }, [settings.serverUrl]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const rows = useMemo<Row[]>(() => {
    const local = listLocalMovies();
    const map = new Map<string, Row>();
    for (const m of remote ?? []) map.set(m.id, { id: m.id, title: m.title, remote: m });
    for (const l of local) map.set(l.id, { ...(map.get(l.id) ?? { id: l.id, title: l.title }), local: l });
    return [...map.values()];
    // downloadsVersion invalidates the local library listing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, downloadsVersion]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const openPlayer = async (id: string) => {
    try {
      await player.load(id, { autoplay: true });
      router.push('/player');
    } catch (e) {
      Alert.alert('无法播放', e instanceof Error ? e.message : String(e));
    }
  };

  const onPress = (row: Row) => {
    const dl = getDownloadState(row.id);
    if (row.local) return void openPlayer(row.id);
    if (dl && !dl.error) {
      Alert.alert('取消下载？', row.title, [
        { text: '继续下载', style: 'cancel' },
        { text: '取消下载', style: 'destructive', onPress: () => cancelDownload(row.id) },
      ]);
      return;
    }
    if (row.remote?.status === 'ready') void downloadMovie(row.remote);
  };

  const onLongPress = (row: Row) => {
    if (!row.local) return;
    Alert.alert('删除本地缓存？', `${row.title}\n删除后需重新下载才能播放`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          if (playerState.movie?.id === row.id) player.unload();
          deleteLocalMovie(row.id);
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={12}>
                <Text style={styles.headerBtn}>设置</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      {!settings.serverUrl && (
        <Pressable style={styles.banner} onPress={() => router.push('/settings')}>
          <Text style={styles.bannerText}>先在“设置”中填写服务器地址和密码 →</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {rows.length > 0 && (
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="搜索电影名称"
          placeholderTextColor={colors.muted}
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
      )}
      <FlatList
        data={visibleRows}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={colors.muted} />}
        contentContainerStyle={visibleRows.length ? undefined : styles.emptyWrap}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Text style={styles.empty}>{rows.length ? `没有找到“${query.trim()}”` : '还没有电影。在管理后台上传音频和字幕。'}</Text>
          )
        }
        renderItem={({ item }) => (
          <MovieRow
            row={item}
            nowPlaying={playerState.movie?.id === item.id}
            onPress={() => onPress(item)}
            onLongPress={() => onLongPress(item)}
          />
        )}
      />
      {playerState.movie && (
        <Pressable style={styles.nowPlaying} onPress={() => router.push('/player')}>
          <Text style={styles.nowPlayingText} numberOfLines={1}>
            {playerState.playing ? '▶︎ ' : '❚❚ '}
            {playerState.movie.title}  ·  {playerState.index + 1}/{playerState.count}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function MovieRow({ row, nowPlaying, onPress, onLongPress }: { row: Row; nowPlaying: boolean; onPress: () => void; onLongPress: () => void }) {
  const dl = getDownloadState(row.id);
  const info = row.local ?? row.remote;
  let status: { text: string; color: string };
  if (dl?.error) status = { text: `下载失败：${dl.error}`, color: colors.danger };
  else if (dl) status = { text: `下载中 ${dl.total ? Math.floor((dl.done / dl.total) * 100) : 0}%`, color: colors.accent };
  else if (row.local) status = { text: nowPlaying ? '正在播放' : '已下载 · 点击播放', color: colors.ok };
  else if (row.remote?.status === 'ready') status = { text: '点击下载', color: colors.accent };
  else if (row.remote?.status === 'failed') status = { text: '服务器处理失败', color: colors.danger };
  else status = { text: `服务器处理中 ${row.remote?.progress ?? 0}%`, color: colors.muted };

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Poster row={row} />
      <View style={styles.rowBody}>
        <Text style={styles.title} numberOfLines={2}>{row.title}</Text>
        {info && info.segmentCount > 0 && (
          <Text style={styles.meta}>
            {info.segmentCount} 句 · {formatDuration(info.duration)} · {formatSize(info.sizeBytes)}
          </Text>
        )}
        <Text style={[styles.status, { color: status.color }]}>{status.text}</Text>
      </View>
    </Pressable>
  );
}

function Poster({ row }: { row: Row }) {
  const [source, setSource] = useState<PosterSource | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const remotePosterAt = row.remote?.posterAt;
  const localPosterFile = row.local?.posterFile;

  useEffect(() => {
    let alive = true;
    posterSource(row.remote, row.local)
      .then((s) => alive && setSource(s))
      .catch(() => alive && setSource(null));
    return () => {
      alive = false;
    };
    // Only re-resolve when the poster version or local file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, remotePosterAt, localPosterFile]);

  if (source && source.uri !== failedUri) {
    return <Image source={source} style={styles.poster} resizeMode="cover" onError={() => setFailedUri(source.uri)} />;
  }
  return (
    <View style={[styles.poster, styles.posterEmpty]}>
      <Text style={styles.posterLetter}>{row.title.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerBtn: { color: colors.accent, fontSize: 17 },
  banner: { margin: 16, padding: 16, borderRadius: 12, backgroundColor: colors.card },
  bannerText: { color: colors.accent, fontSize: 16 },
  error: { color: colors.muted, textAlign: 'center', padding: 8 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  empty: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  rowBody: { flex: 1 },
  poster: { width: 64, height: 96, borderRadius: 8, backgroundColor: colors.border },
  posterEmpty: { alignItems: 'center', justifyContent: 'center' },
  posterLetter: { color: colors.muted, fontSize: 28, fontWeight: '800' },
  search: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    color: colors.text,
    fontSize: 17,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 14, marginTop: 6 },
  status: { fontSize: 15, marginTop: 8, fontWeight: '600' },
  nowPlaying: { margin: 12, padding: 16, borderRadius: 14, backgroundColor: colors.accent },
  nowPlayingText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
