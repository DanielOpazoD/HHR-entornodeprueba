import type { Page, Route } from '@playwright/test';

interface AuthorityCallablePayload {
  date: string;
  patch: Record<string, unknown>;
  mode: 'shadow' | 'enforced';
  syncContract?: {
    mutationId?: string;
  };
  intentionalBedClear?: {
    bedId: string;
    target?: 'bed' | 'clinicalCrib';
    confirmedAssociatedCrib?: {
      clinicalEpisodeId?: string;
      rut?: string;
      patientName?: string;
    } | null;
  };
}

interface RejectOptions {
  status?: 'ABORTED' | 'FAILED_PRECONDITION' | 'PERMISSION_DENIED';
  httpStatus?: number;
  message?: string;
}

export interface PendingAuthorityCall {
  payload: AuthorityCallablePayload;
  succeed: () => Promise<void>;
  reject: (options?: RejectOptions) => Promise<void>;
}

export interface DailyRecordAuthorityRouteController {
  nextCall: () => Promise<PendingAuthorityCall>;
}

const clone = <T>(value: T): T => structuredClone(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const setValueAtPath = (target: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.').filter(Boolean);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = clone(value);
};

const applyAuthorityPatch = (
  currentRecord: Record<string, unknown>,
  payload: AuthorityCallablePayload,
  sequence: number
): Record<string, unknown> => {
  const nextRecord = clone(currentRecord);
  Object.entries(payload.patch).forEach(([path, value]) => setValueAtPath(nextRecord, path, value));

  const currentMeta = isPlainObject(nextRecord.meta) ? nextRecord.meta : {};
  const currentRevision = Number(currentMeta.revision);
  const nextRevision = Number.isFinite(currentRevision) ? currentRevision + 1 : sequence;
  const baseTimestamp = Date.parse(String(currentRecord.lastUpdated || ''));
  const nextTimestamp = new Date(
    Number.isFinite(baseTimestamp) ? baseTimestamp + sequence : Date.now()
  ).toISOString();

  nextRecord.date = payload.date;
  nextRecord.lastUpdated = nextTimestamp;
  nextRecord.meta = {
    ...currentMeta,
    revision: nextRevision,
  };
  return nextRecord;
};

const callableHeaders = {
  'access-control-allow-headers':
    'Authorization, Content-Type, Firebase-Instance-ID-Token, X-Firebase-AppCheck',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-origin': '*',
};

const updateBrowserAuthorityShadow = async (
  page: Page,
  date: string,
  record: Record<string, unknown>
): Promise<void> => {
  await page.evaluate(
    ({ dateStr, authoritativeRecord }) => {
      const runtimeWindow = window as Window & {
        __HHR_E2E_OVERRIDE__?: Record<string, unknown>;
        __HHR_E2E_SET_REMOTE_AUTHORITY__?: (date: string, record: unknown) => void;
      };
      if (runtimeWindow.__HHR_E2E_SET_REMOTE_AUTHORITY__) {
        runtimeWindow.__HHR_E2E_SET_REMOTE_AUTHORITY__(dateStr, authoritativeRecord);
      } else {
        runtimeWindow.__HHR_E2E_OVERRIDE__ = {
          ...(runtimeWindow.__HHR_E2E_OVERRIDE__ || {}),
          [dateStr]: authoritativeRecord,
        };
        localStorage.setItem(
          'hhr_e2e_remote_override_shadow',
          JSON.stringify({ date: dateStr, record: authoritativeRecord })
        );
      }
    },
    { dateStr: date, authoritativeRecord: record }
  );
};

export const installDailyRecordAuthorityRoute = async (
  page: Page,
  initialRecord: Record<string, unknown>
): Promise<DailyRecordAuthorityRouteController> => {
  let remoteRecord = clone(initialRecord);
  let sequence = 0;
  const queuedCalls: PendingAuthorityCall[] = [];
  const waitingConsumers: Array<(call: PendingAuthorityCall) => void> = [];

  const publishCall = (call: PendingAuthorityCall) => {
    const consumer = waitingConsumers.shift();
    if (consumer) {
      consumer(call);
    } else {
      queuedCalls.push(call);
    }
  };

  const handlePost = async (route: Route): Promise<void> => {
    const body = route.request().postDataJSON() as { data?: AuthorityCallablePayload };
    if (!body?.data?.date || !isPlainObject(body.data.patch)) {
      await route.fulfill({
        status: 400,
        headers: callableHeaders,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { status: 'INVALID_ARGUMENT', message: 'Invalid E2E authority payload.' },
        }),
      });
      return;
    }

    await new Promise<void>(resolve => {
      let settled = false;
      const payload = body.data!;
      const settle = async (action: () => Promise<void>) => {
        if (settled) throw new Error('E2E authority call was already settled.');
        settled = true;
        try {
          await action();
        } finally {
          resolve();
        }
      };

      publishCall({
        payload,
        succeed: () =>
          settle(async () => {
            sequence += 1;
            remoteRecord = applyAuthorityPatch(remoteRecord, payload, sequence);
            await updateBrowserAuthorityShadow(page, payload.date, remoteRecord);
            const meta = isPlainObject(remoteRecord.meta) ? remoteRecord.meta : {};
            await route.fulfill({
              status: 200,
              headers: callableHeaders,
              contentType: 'application/json',
              body: JSON.stringify({
                data: {
                  success: true,
                  date: payload.date,
                  mode: payload.mode,
                  authorityStatus: 'ok',
                  revision: meta.revision,
                  mutationId: payload.syncContract?.mutationId,
                  recordState: {
                    lastUpdated: remoteRecord.lastUpdated,
                    meta,
                    record: remoteRecord,
                  },
                  violations: [],
                },
              }),
            });
          }),
        reject: (options = {}) =>
          settle(() =>
            route.fulfill({
              status: options.httpStatus ?? 403,
              headers: callableHeaders,
              contentType: 'application/json',
              body: JSON.stringify({
                error: {
                  status: options.status ?? 'PERMISSION_DENIED',
                  message: options.message ?? 'E2E authority rejected the guarded mutation.',
                },
              }),
            })
          ),
      });
    });
  };

  await page.route('**/patchDailyRecordWithClinicalAuthority', async route => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: callableHeaders });
      return;
    }
    await handlePost(route);
  });

  return {
    nextCall: () => {
      const queued = queuedCalls.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise(resolve => waitingConsumers.push(resolve));
    },
  };
};
