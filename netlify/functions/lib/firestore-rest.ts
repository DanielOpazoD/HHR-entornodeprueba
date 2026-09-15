/**
 * Cliente Firestore REST mínimo para funciones Netlify: cada llamada viaja
 * con el ID token del usuario autenticado, de modo que las Security Rules
 * evalúan la escritura como ese usuario (la función nunca es más privilegiada
 * que quien la invoca).
 */

export type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  nullValue?: null;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, FirestoreValue> };
  arrayValue?: { values?: FirestoreValue[] };
};

export interface FirestoreRestDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

type FetchLike = typeof fetch;

export const resolveFirebaseProjectId = (env: NodeJS.ProcessEnv): string | null => {
  const explicitProjectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (explicitProjectId) return explicitProjectId;

  const firebaseConfig = env.FIREBASE_CONFIG?.trim();
  if (!firebaseConfig) return null;
  try {
    const parsed = JSON.parse(firebaseConfig) as { projectId?: string };
    return parsed.projectId?.trim() || null;
  } catch {
    return null;
  }
};

const documentsBase = (env: NodeJS.ProcessEnv): string | null => {
  const projectId = resolveFirebaseProjectId(env);
  if (!projectId) return null;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
};

export const decodeFirestoreValue = (value: FirestoreValue | undefined): unknown => {
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue ?? '';
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue ?? 0);
  if ('doubleValue' in value) return Number(value.doubleValue ?? 0);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values ?? []).map(item => decodeFirestoreValue(item));
  }
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields ?? {}).map(([key, nested]) => [
        key,
        decodeFirestoreValue(nested),
      ])
    );
  }
  return undefined;
};

export const decodeFirestoreDocument = (
  document: FirestoreRestDocument | null
): Record<string, unknown> | null => {
  if (!document?.fields) return null;
  return Object.fromEntries(
    Object.entries(document.fields).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
};

const encodeFirestoreValue = (value: unknown): FirestoreValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(item => encodeFirestoreValue(item)) } };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
            key,
            encodeFirestoreValue(nested),
          ])
        ),
      },
    };
  }
  return { stringValue: String(value) };
};

export const encodeFirestoreFields = (
  data: Record<string, unknown>
): Record<string, FirestoreValue> =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)])
  );

export interface FirestoreRestClient {
  getDocument(path: string): Promise<Record<string, unknown> | null>;
  /** Crea el documento; devuelve 'exists' si ya existía (dedup por id). */
  createDocument(
    collectionPath: string,
    documentId: string,
    data: Record<string, unknown>
  ): Promise<'created' | 'exists'>;
  setDocument(path: string, data: Record<string, unknown>): Promise<void>;
  /** Cuenta documentos que cumplen filtros de igualdad (presupuesto). */
  countWhere(
    collectionPath: string,
    filters: Array<{ field: string; value: string | number | boolean }>,
    extra?: { sinceField?: string; sinceValue?: string }
  ): Promise<number>;
}

export const createFirestoreRestClient = ({
  bearerToken,
  env = process.env,
  fetchImpl = fetch,
}: {
  bearerToken: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}): FirestoreRestClient => {
  const base = documentsBase(env);
  if (!base) throw new Error('Missing Firebase project configuration.');

  const authHeaders = { Authorization: `Bearer ${bearerToken}` };

  return {
    getDocument: async path => {
      const response = await fetchImpl(`${base}/${path}`, { headers: authHeaders });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`Firestore read failed (${response.status}) for ${path}`);
      }
      return decodeFirestoreDocument((await response.json()) as FirestoreRestDocument);
    },

    createDocument: async (collectionPath, documentId, data) => {
      const response = await fetchImpl(
        `${base}/${collectionPath}?documentId=${encodeURIComponent(documentId)}`,
        {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: encodeFirestoreFields(data) }),
        }
      );
      if (response.status === 409 || response.status === 412) return 'exists';
      if (!response.ok) {
        const body = await response.text();
        if (body.includes('ALREADY_EXISTS')) return 'exists';
        throw new Error(`Firestore create failed (${response.status}) for ${collectionPath}`);
      }
      return 'created';
    },

    setDocument: async (path, data) => {
      const response = await fetchImpl(`${base}/${path}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: encodeFirestoreFields(data) }),
      });
      if (!response.ok) {
        throw new Error(`Firestore write failed (${response.status}) for ${path}`);
      }
    },

    countWhere: async (collectionPath, filters, extra) => {
      const structuredQuery = {
        structuredQuery: {
          from: [{ collectionId: collectionPath.split('/').pop() }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                ...filters.map(filter => ({
                  fieldFilter: {
                    field: { fieldPath: filter.field },
                    op: 'EQUAL',
                    value: encodeFirestoreValue(filter.value),
                  },
                })),
                ...(extra?.sinceField && extra.sinceValue !== undefined
                  ? [
                      {
                        fieldFilter: {
                          field: { fieldPath: extra.sinceField },
                          op: 'GREATER_THAN_OR_EQUAL',
                          value: encodeFirestoreValue(extra.sinceValue),
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
        },
      };
      const parentPath = collectionPath.split('/').slice(0, -1).join('/');
      const response = await fetchImpl(`${base}/${parentPath}:runQuery`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(structuredQuery),
      });
      if (!response.ok) {
        throw new Error(`Firestore query failed (${response.status}) for ${collectionPath}`);
      }
      const rows = (await response.json()) as Array<{ document?: FirestoreRestDocument }>;
      return rows.filter(row => row.document).length;
    },
  };
};
