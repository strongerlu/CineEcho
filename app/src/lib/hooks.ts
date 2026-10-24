import { useCallback, useSyncExternalStore } from 'react';
import { downloadsVersion, subscribeDownloads } from './downloads';
import { player } from './player';
import { loadSettings, saveSettings } from './storage';
import type { Settings } from './types';

export function usePlayerState() {
  return useSyncExternalStore(player.subscribe, player.getState);
}

let settingsSnapshot: Settings | null = null;
const settingsListeners = new Set<() => void>();

function getSettingsSnapshot(): Settings {
  settingsSnapshot ??= loadSettings();
  return settingsSnapshot;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettingsSnapshot(), ...patch };
  saveSettings(next);
  settingsSnapshot = next;
  player.applySettings(next);
  settingsListeners.forEach((l) => l());
  return next;
}

function subscribeSettings(l: () => void) {
  settingsListeners.add(l);
  return () => {
    settingsListeners.delete(l);
  };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettingsSnapshot);
  const update = useCallback((patch: Partial<Settings>) => {
    updateSettings(patch);
  }, []);
  return [settings, update];
}

/** Re-renders whenever download progress or the local library changes. */
export function useDownloadsVersion(): number {
  return useSyncExternalStore(subscribeDownloads, downloadsVersion);
}
