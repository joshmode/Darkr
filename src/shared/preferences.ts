import {
  cloneDefaultPreferences,
  normalizePreferences,
} from "./config";
import type { DarkrPreferences } from "./types";

export const PREFERENCES_STORAGE_KEY = "darkr.preferences.v1";
export const ONBOARDING_STORAGE_KEY = "darkr.onboarding.v1";

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function loadPreferences(
  storage: StorageAreaLike,
): Promise<DarkrPreferences> {
  try {
    const stored = await storage.get(PREFERENCES_STORAGE_KEY);
    return normalizePreferences(stored[PREFERENCES_STORAGE_KEY]);
  } catch {
    return cloneDefaultPreferences();
  }
}

export async function savePreferences(
  storage: StorageAreaLike,
  preferences: DarkrPreferences,
): Promise<void> {
  await storage.set({
    [PREFERENCES_STORAGE_KEY]: normalizePreferences(preferences),
  });
}

export function preferencesFromStorageChange(
  changes: Record<string, { newValue?: unknown }>,
): DarkrPreferences | null {
  const change = changes[PREFERENCES_STORAGE_KEY];
  if (!change) {
    return null;
  }
  return normalizePreferences(change.newValue);
}

export async function needsOnboarding(
  storage: StorageAreaLike,
): Promise<boolean> {
  try {
    const stored = await storage.get(ONBOARDING_STORAGE_KEY);
    return stored[ONBOARDING_STORAGE_KEY] !== true;
  } catch {
    return false;
  }
}

export async function completeOnboarding(
  storage: StorageAreaLike,
): Promise<void> {
  await storage.set({ [ONBOARDING_STORAGE_KEY]: true });
}
