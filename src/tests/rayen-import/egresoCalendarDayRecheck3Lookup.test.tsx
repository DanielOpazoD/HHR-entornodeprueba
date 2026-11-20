// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  type RayenEncounter,
  type EgresoReportRow,
} from '@/features/rayen-import';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  getRecordForDateStrict,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import { applyConfirmedRayenImport } from '@/features/rayen-import/hooks/confirmRayenImport';

const census = '2026-11-06';
const episode: RayenEncounter = {
  encounterId: '91001',
  run: '123456785',
  firstGivenName: 'Persona',
  firstFamilyName: 'Sintética',
  room: 'Sala 1',
  bed: 'R2',
  service: 'Área Médico Quirúrgica Indiferenciada',
  admissionDatetime: '2026-11-02T10:00:00-05:00',
};
const ctx = {
  idFactory: () => 'egreso-prueba',
  syncRunId: 'sonda',
  now: new Date('2026-12-10T22:00:00Z'),
};
function record(date = census): DailyRecord {
  return {
    date,
    beds: { R2: { ...rayenToPatientData(episode, ctx.now).patient, bedId: 'R2' } },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    activeExtraBeds: [],
  };
}
function row(fechaEgreso: string, overrides: Partial<EgresoReportRow> = {}): EgresoReportRow {
  return {
    run: '12.345.678-5',
    encounterId: episode.encounterId,
    patientName: 'Persona Sintética',
    bedLabel: 'R2',
    servicio: 'Área Médico Quirúrgica',
    edad: '',
    destino: 'Domicilio',
    motivo: 'Alta hospitalaria',
    fechaEgreso,
    ...overrides,
  };
}
async function reread(applied: DailyRecord) {
  expect(await saveRecordStrict(applied)).toMatchObject({ ok: true, store: 'indexeddb' });
  const stored = await getRecordForDateStrict(applied.date);
  expect(stored).toBeTruthy();
  return migrateLegacyDataWithReport(stored!, applied.date).record;
}
const movements = (current: DailyRecord) => [...current.discharges, ...current.transfers];

import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(cleanup);
const port = {
  getAuthoritativeForDate: async () => null,
  getLocalForDateWithMeta: async () => ({
    record: null,
    hasPendingWrites: false,
    writeState: 'none',
  }),
} as unknown as import('@/application/ports/dailyRecordPort').DailyRecordRepositoryPort;
it.each([false, true])(
  'confirmación con consulta exacta posterior, histórico=%s',
  async historical => {
    const current = record();
    const invalid = row('07-11-2026 01:00', {
      encounterId: '',
      correctedCalendarDay: '2026-11-31',
      correctedTime: '01:00',
      correctedDay: census,
      exactEpisodeVerification: 'unverified',
    });
    const requests: string[][] = [];
    const replan = (base: DailyRecord) =>
      replanRayenStructure(
        base,
        {
          sourceSnapshot: {
            capturedAt: ctx.now.toISOString(),
            facilityId: 1342,
            isComplete: true,
            encounters: [{ ...episode, hasMedicalDischarge: true }],
          },
          egresoRows: [invalid],
          reportDate: census,
          isHistoricalDay: historical,
          invalidEpisodeIds: new Set(),
        },
        {
          dailyRecord: port,
          isAdmin: false,
          fetchPatientFlowReport: async () => ({ base64: '', error: 'sin trazabilidad' }),
          fetchStatisticalDischarge: async () => ({ base64: '', error: 'sin PDF' }),
          lookupEgresos: async targets => {
            requests.push(targets.map(t => t.encounterId));
            return targets.map(t => ({
              ...t,
              egreso: {
                id: 91001,
                hasAdministrativeDischarge: true,
                dateDischarge: '2026-11-07T04:00:00Z',
              },
            }));
          },
        }
      );
    const diff = await replan(current);
    let committed: Promise<DailyRecord> | undefined;
    const confirm = (applyPreviousDays: boolean) => {
      committed = applyConfirmedRayenImport({
        base: current,
        diff,
        isAdmin: false,
        applyPreviousDays,
        getFreshRecord: async () => current,
        replanDiff: () => replan(current),
        createId: ctx.idFactory,
        ensureRun: () => {
          throw Error('inesperado');
        },
        dailyRecord: port,
        applyDiff: async (fresh, final) => {
          const applied = applyCensusImportDiff(fresh, final, ctx);
          return { ...applied, record: await reread(applied.record) };
        },
      }).then(r => r.record);
    };
    render(
      createElement(RayenImportPreviewModal, {
        isOpen: true,
        diff,
        error: null,
        targetDate: census,
        onConfirm: confirm,
        onCancel: () => {},
      })
    );
    const button = screen.queryByRole('button', { name: 'Confirmar e importar' });
    const enabled = button instanceof HTMLButtonElement && !button.disabled;
    if (enabled) fireEvent.click(button);
    const saved = committed ? await committed : current;
    const facts = {
      historical,
      requests,
      enabled,
      conflicts: diff.conflicts.map(c => c.reason),
      proposed: diff.discharges.map(d => d.verification?.hospitalDischarge),
      saved: movements(saved).map(m => [m.clinicalEpisodeId, m.movementDate, m.time]),
      occupied: Boolean(saved.beds.R2?.patientName),
    };
    if (!historical) {
      expect(requests.flat()).toContain(episode.encounterId);
      expect(facts).toMatchObject({
        saved: [[episode.encounterId, census, '23:00']],
        occupied: false,
      });
    }
  }
);
