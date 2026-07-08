/**
 * Dev-only diagnostic: when a remote Firestore read fails on localhost, the most
 * common cause is that the Google sign-in did not complete (COOP popup) or that
 * `localhost` is not an authorized auth domain — leaving the daily census unable to
 * sync. This surfaces a single actionable hint instead of a bare "remote fetch
 * failed" warning, so the next developer does not have to rediscover it.
 *
 * Gated on `import.meta.env.MODE === 'development'`, which targets ONLY the `vite`
 * dev server — not vitest ('test') and not production builds.
 */
export const LOCAL_SYNC_HINT_MESSAGE =
  '[dev] Firestore remote read failed on localhost — the daily census may not sync. ' +
  'Likely the Google sign-in did not complete. Check: (1) you are signed in; ' +
  '(2) `localhost` is in Firebase Auth → Authorized domains; ' +
  '(3) set VITE_AUTH_PREFER_REDIRECT_ON_LOCALHOST=true in .env.development.local ' +
  '(COOP can break the popup). See docs/FIREBASE_POLICY.md.';

export const isLocalhostHostname = (hostname: string | undefined): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1';

/** Pure: should the localhost sync hint be emitted for this runtime mode + host? */
export const shouldHintLocalSync = (
  mode: string | undefined,
  hostname: string | undefined
): boolean => mode === 'development' && isLocalhostHostname(hostname);

/**
 * Build a once-only emitter. `shouldHint` and `warn` are injected so the gating and
 * the single-fire guard are unit-testable without touching import.meta or window.
 */
export const createLocalSyncHint = ({
  shouldHint,
  warn,
}: {
  shouldHint: () => boolean;
  warn: (message: string) => void;
}): (() => void) => {
  let emitted = false;
  return () => {
    if (emitted || !shouldHint()) return;
    emitted = true;
    warn(LOCAL_SYNC_HINT_MESSAGE);
  };
};
