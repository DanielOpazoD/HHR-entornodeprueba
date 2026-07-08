export interface UserAvatarProfile {
  uid: string;
  email: string;
  photoURL: string;
  storagePath: string;
  updatedAt: string;
}

const LOCAL_USER_AVATAR_PROFILES_KEY = 'hhr_user_avatar_profiles_v1';

export const normalizeUserAvatarUid = (uid: string): string => String(uid || '').trim();

const readLocalProfiles = (): Record<string, UserAvatarProfile> => {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_USER_AVATAR_PROFILES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, UserAvatarProfile>) : {};
  } catch {
    return {};
  }
};

export const readCachedUserAvatarProfile = (
  uidInput: string | null | undefined
): UserAvatarProfile | null => {
  const uid = normalizeUserAvatarUid(uidInput || '');
  if (!uid) {
    return null;
  }
  return readLocalProfiles()[uid] || null;
};

export const writeCachedUserAvatarProfile = (
  profile: UserAvatarProfile | null,
  uidInput: string
): void => {
  const uid = normalizeUserAvatarUid(uidInput);
  if (!uid) {
    return;
  }
  try {
    const profiles = readLocalProfiles();
    if (profile) {
      profiles[uid] = profile;
    } else {
      delete profiles[uid];
    }
    globalThis.localStorage?.setItem(LOCAL_USER_AVATAR_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // Local fallback must not block the authenticated shell.
  }
};

export const clearCachedUserAvatarProfiles = (): void => {
  try {
    globalThis.localStorage?.removeItem(LOCAL_USER_AVATAR_PROFILES_KEY);
  } catch {
    // Logout/session cleanup must not be blocked by storage availability.
  }
};
