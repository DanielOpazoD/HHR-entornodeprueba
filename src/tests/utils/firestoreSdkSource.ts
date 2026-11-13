import { doc, onSnapshot } from 'firebase/firestore';

/** Fixed sleep these waits replaced after `disableNetwork`/`enableNetwork`; now only their cap. */
export const FIRESTORE_NETWORK_WAIT_MS = 10_000;

/**
 * Resolves once a fresh listener on `path` says where the SDK reads it from now: only its cache
 * (network disabled) or the server (network back). It ends as soon as that is observed; a
 * listener error leaves the full cap, as the old sleep did.
 */
export const waitForFirestoreSdkSource = (
  db: unknown,
  path: string,
  source: 'cache' | 'server',
  capMs = FIRESTORE_NETWORK_WAIT_MS
) =>
  new Promise<void>(resolve => {
    let finished = false;
    const listener: { stop?: () => void } = {};
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(cap);
      listener.stop?.();
      resolve();
    };
    const cap = setTimeout(done, capMs);
    listener.stop = onSnapshot(
      doc(db as never, path),
      { includeMetadataChanges: true },
      snapshot => {
        if (snapshot.metadata.fromCache === (source === 'cache')) done();
      },
      () => undefined
    );
    if (finished) listener.stop();
  });
