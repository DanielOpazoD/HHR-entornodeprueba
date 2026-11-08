/**
 * Storage objects only their owner may read, such as a personal signature. The service worker
 * must never keep them: Cache Storage outlives the session on a shared computer and answers
 * offline without asking the Storage rules.
 */
const PRIVATE_STORAGE_PREFIXES = ['user-signatures/'] as const;

const isFirebaseStorageOrigin = (url: URL): boolean =>
  url.origin.includes('firebasestorage.googleapis.com') ||
  url.origin.includes('firebasestorage.app');

const decodePath = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

/** The SDK requests `/v0/b/{bucket}/o/{encoded object path}`. */
export const isPrivateStorageObjectUrl = (url: URL): boolean => {
  if (!isFirebaseStorageOrigin(url)) return false;
  const path = decodePath(url.pathname);
  return PRIVATE_STORAGE_PREFIXES.some(prefix => path.includes(`/o/${prefix}`));
};

/** Removes every cached copy of a private object, in any cache this origin holds. */
export const purgePrivateStorageObjectsFromCaches = async (
  cacheStorage: CacheStorage
): Promise<void> => {
  const cacheNames = await cacheStorage.keys();
  await Promise.all(
    cacheNames.map(async cacheName => {
      const cache = await cacheStorage.open(cacheName);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter(request => isPrivateStorageObjectUrl(new URL(request.url)))
          .map(request => cache.delete(request))
      );
    })
  );
};
