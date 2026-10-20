import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

type Data = Record<string, unknown>;
export const accountFixture = () => {
  const documents = new Map<string, Data>();
  const users = new Map<string, Data>();
  const snapshot = (path: string) => ({
    id: path.split('/').at(-1),
    exists: documents.has(path),
    data: () => structuredClone(documents.get(path)),
  });
  const doc = (path: string) => ({ path, get: async () => snapshot(path) });
  let serial = Promise.resolve();
  const firestore = {
    doc,
    collection: (name: string) => ({
      doc: (id = randomUUID()) => doc(`${name}/${id}`),
      orderBy: (_field: string, _direction: string) => ({
        limit: (count: number) => ({
          get: async () => ({
            docs: [...documents.keys()]
              .filter(key => key.startsWith(`${name}/`))
              .map(snapshot)
              .sort((a, b) => Number(b.data()?.at) - Number(a.data()?.at))
              .slice(0, count),
          }),
        }),
      }),
      limit: (_limit: number) => ({
        get: async () => {
          const docs = [...documents.keys()]
            .filter(key => key.startsWith(`${name}/`))
            .map(snapshot);
          return { docs, size: docs.length };
        },
      }),
    }),
    runTransaction: <T>(
      callback: (tx: {
        get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>;
        create: (ref: { path: string }, data: Data) => void;
        update: (ref: { path: string }, data: Data) => void;
        set: (ref: { path: string }, data: Data) => void;
      }) => Promise<T>
    ): Promise<T> => {
      const result = serial.then(async () => {
        const writes: (() => void)[] = [];
        const result = await callback({
          get: async ref => snapshot(ref.path),
          create: (ref, data) => {
            if (documents.has(ref.path)) throw new Error('exists');
            writes.push(() => documents.set(ref.path, structuredClone(data)));
          },
          update: (ref, data) => {
            if (!documents.has(ref.path)) throw new Error('missing');
            writes.push(() =>
              documents.set(ref.path, { ...documents.get(ref.path), ...structuredClone(data) })
            );
          },
          set: (ref, data) => {
            writes.push(() => documents.set(ref.path, structuredClone(data)));
          },
        });
        writes.forEach(write => write());
        return result;
      });
      serial = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
  const auth = {
    createUser: vi.fn(async (data: Data & { uid: string }) => {
      users.set(data.uid, { ...data });
      return data;
    }),
    updateUser: vi.fn(async (uid: string, data: Data) => {
      if (!users.has(uid)) throw new Error('missing');
      users.set(uid, { ...users.get(uid), ...data });
    }),
    revokeRefreshTokens: vi.fn(async (_uid: string) => undefined),
    setCustomUserClaims: vi.fn(async (uid: string, claims: Data) => {
      users.set(uid, { ...users.get(uid), customClaims: claims });
    }),
    getUser: vi.fn(async (uid: string) => {
      if (!users.has(uid))
        throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      return users.get(uid);
    }),
    getUserByEmail: vi.fn(async (email: string) => {
      const user = [...users.values()].find(candidate => candidate.email === email);
      if (!user) throw new Error('missing');
      return user;
    }),
  };
  const now = () => Date.parse('2026-10-20T03:00:00Z');
  const context = {
    auth: {
      uid: 'google-admin',
      token: {
        email: 'daniel.opazo@hospitalhangaroa.cl',
        auth_time: now() / 1000,
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      },
    },
    rawRequest: { ip: '127.0.0.1' },
  };
  const helpers = {
    resolveRoleForEmail: vi.fn(async (_email: string, ctx: typeof context) =>
      ctx.auth.uid === 'google-admin' ? 'admin' : 'nurse_hospital'
    ),
  };
  const passwordVerifier = vi.fn(
    async ({ email, password }: { email: string; password: string }) => {
      const user = [...users.values()].find(
        candidate =>
          candidate.email === email && candidate.password === password && !candidate.disabled
      );
      if (!user) throw new Error('invalid');
      return user.uid;
    }
  );
  return { firestore, auth, helpers, now, documents, users, context, passwordVerifier };
};
