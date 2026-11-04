// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import '../../../extension/fichamedico-alert-entry-runtime.js';

const { create } = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoAlertEntryRuntime: {
      create: (deps: Record<string, unknown>) => {
        fetchAlertEntries: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
    };
  }
).HhrFichaMedicoAlertEntryRuntime;

const TODAY = '2026-11-03';
const session = {
  info: {
    token: 't',
    apiOrigin: 'https://ficha.example',
    practitionerId: '77',
    role: 'Enfermera(o)',
  },
};
const runtime = (overrides: Record<string, unknown> = {}) => {
  const deps = {
    authorize: vi.fn().mockResolvedValue(true),
    resolveSession: vi.fn().mockResolvedValue(session),
    readJson: vi.fn().mockResolvedValue({ status: 200, data: [] }),
    clinicalDayAt: () => TODAY,
    classify: () => 'source_unavailable',
    ...overrides,
  };
  return { deps, read: create(deps).fetchAlertEntries };
};

describe('Ficha Médico alert entries for the census bundle', () => {
  it('reads the episode alerts as the nursing reader and keeps only the fields HHR uses', async () => {
    const entry = {
      guid: 'g-1',
      observation: 'Nota sintética',
      startDateTime: '2026-11-03T08:00:00-05:00',
      endDateTime: null,
      archived: false,
      deleted: false,
      deletedDateTime: null,
      isSigned: true,
      visitor: false,
      authorHealthCarePractitionerName: 'Profesional Sintético',
      authorHealthCarePractitionerRoleName: 'Enfermera(o)',
      authorHealthCarePractitionerId: 5,
      encounterId: 123456,
    };
    const { deps, read } = runtime({
      readJson: vi.fn().mockResolvedValue({ status: 200, data: [entry, null] }),
    });

    const result = await read({ encId: '123456', fecha: TODAY, sender: { tab: { id: 1 } } });

    expect(deps.readJson).toHaveBeenCalledWith({
      info: session.info,
      path: '/api/encounter/entrySummary/alertEntry/123456/2/77',
      cache: 'no-store',
    });
    const { authorHealthCarePractitionerId: _id, encounterId: _encounter, ...kept } = entry;
    expect(result).toEqual({ ok: true, alerts: [kept] });
  });

  it('does not read Eloísa for a day other than the clinical day in progress', async () => {
    const { deps, read } = runtime();
    await expect(read({ encId: '123456', fecha: '2026-11-02' })).resolves.toEqual({
      ok: true,
      skipped: true,
      alerts: [],
    });
    expect(deps.authorize).not.toHaveBeenCalled();
    expect(deps.readJson).not.toHaveBeenCalled();
  });

  it('refuses an episode the tab is not authorized for', async () => {
    const { deps, read } = runtime({ authorize: vi.fn().mockResolvedValue(false) });
    await expect(read({ encId: '123456', fecha: TODAY })).resolves.toMatchObject({
      errorCode: 'episode_not_authorized',
    });
    expect(deps.readJson).not.toHaveBeenCalled();
  });

  it('treats 204 as no alerts and an HTTP failure as a failed read', async () => {
    const empty = runtime({ readJson: vi.fn().mockResolvedValue({ status: 204, data: null }) });
    await expect(empty.read({ encId: '123456', fecha: TODAY })).resolves.toEqual({
      ok: true,
      alerts: [],
    });
    const failing = runtime({
      readJson: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('HTTP 500'), { kind: 'http', status: 500 })),
    });
    await expect(failing.read({ encId: '123456', fecha: TODAY })).resolves.toEqual({
      error: 'Eloísa respondió HTTP 500 al leer las alertas.',
      errorCode: 'source_unavailable',
    });
  });
});
