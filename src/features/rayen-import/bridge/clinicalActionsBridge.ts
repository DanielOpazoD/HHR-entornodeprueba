export interface ClinicalAntecedentEntry {
  id: string;
  source: string;
  date: string;
  diagnosis: string;
  facility: string;
  type: string;
}
export interface ClinicalAntecedentDetail {
  reason: string;
  history: string;
  professional: string;
  attachments: Array<{ id: string; label: string }>;
}
export interface ClinicalActionResult {
  ok: boolean;
  opened?: boolean;
  error?: string;
  entries?: ClinicalAntecedentEntry[];
  warnings?: string[];
  unavailableSources?: Array<'Primaria' | 'Secundaria'>;
  detail?: ClinicalAntecedentDetail;
}

export const requestClinicalAction = (
  encId: string,
  operation: 'prescription' | 'list' | 'detail' | 'attachment' | 'urgency',
  entryId?: string,
  signal?: AbortSignal
): Promise<ClinicalActionResult> =>
  new Promise(resolve => {
    if (!/^\d+$/.test(encId) || signal?.aborted) {
      resolve({ ok: false, error: 'Consulta clínica cancelada o episodio inválido.' });
      return;
    }
    const reqId = `clinical-action-${crypto.randomUUID()}`;
    let settled = false;
    // eslint-disable-next-line prefer-const -- cleanup can run before timer assignment
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: ClinicalActionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ ok: false, error: 'Consulta cancelada.' });
    const onMessage = (event: MessageEvent): void => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'HHR_RAYEN_CLINICAL_ACTION_RESULT' ||
        event.data.reqId !== reqId
      )
        return;
      const data = event.data;
      const entries = Array.isArray(data.entries)
        ? data.entries.filter(
            (row: unknown): row is ClinicalAntecedentEntry =>
              Boolean(row) &&
              typeof row === 'object' &&
              ['id', 'source', 'date', 'diagnosis', 'facility', 'type'].every(
                key => typeof (row as Record<string, unknown>)[key] === 'string'
              )
          )
        : undefined;
      const validAttachments =
        data.detail?.attachments === undefined ||
        (Array.isArray(data.detail.attachments) &&
          data.detail.attachments.every(
            (value: unknown) =>
              Boolean(value) &&
              typeof value === 'object' &&
              typeof (value as Record<string, unknown>).id === 'string' &&
              typeof (value as Record<string, unknown>).label === 'string'
          ));
      const detail =
        data.detail &&
        ['reason', 'history', 'professional'].every(key => typeof data.detail[key] === 'string') &&
        validAttachments
          ? { ...data.detail, attachments: data.detail.attachments ?? [] }
          : undefined;
      finish({
        ok: data.ok === true,
        opened: data.opened === true,
        error: typeof data.error === 'string' ? data.error : undefined,
        entries,
        detail,
        warnings: Array.isArray(data.warnings)
          ? data.warnings.filter((value: unknown) => typeof value === 'string')
          : undefined,
        unavailableSources: Array.isArray(data.unavailableSources)
          ? data.unavailableSources.filter(
              (value: unknown): value is 'Primaria' | 'Secundaria' =>
                value === 'Primaria' || value === 'Secundaria'
            )
          : undefined,
      });
    };
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: 'La extensión no respondió a la consulta clínica. Revisa tu conexión con Eloísa.',
        }),
      90000
    );
    try {
      window.postMessage(
        { type: 'HHR_RAYEN_CLINICAL_ACTION_REQUEST', reqId, encId, operation, entryId },
        window.location.origin
      );
    } catch {
      finish({ ok: false, error: 'No se pudo consultar la extensión Eloísa.' });
    }
  });
