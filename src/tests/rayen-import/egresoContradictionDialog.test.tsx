// @vitest-environment jsdom
// Recheck probe of W20-EGR1 (PR #1819): the review dialog cannot confirm an egreso whose episode
// carries contradictory official evidence. Synthetic data only.
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
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
function plan(
  current: DailyRecord,
  encounters: RayenEncounter[] = [{ ...episode, hasMedicalDischarge: true }],
  isComplete = true
) {
  const snapshot: RayenCensusSnapshot = {
    capturedAt: ctx.now.toISOString(),
    facilityId: 1342,
    isComplete,
    encounters,
  };
  return reconcileCensus(current, snapshot, { reference: ctx.now });
}
async function reread(applied: DailyRecord) {
  expect(await saveRecordStrict(applied)).toMatchObject({ ok: true, store: 'indexeddb' });
  const stored = await getRecordForDateStrict(applied.date);
  expect(stored).toBeTruthy();
  return migrateLegacyDataWithReport(stored!, applied.date).record;
}
const movements = (current: DailyRecord) => [...current.discharges, ...current.transfers];

it('la fila contradictoria no puede confirmarse como alta desde el diálogo', async () => {
  const base = record();
  const checked = applyEgresoReport(
    plan(base),
    [
      row('06-11-2026 23:00'),
      row('07-11-2026 01:00', {
        exactEpisodeVerification: 'verified',
        correctedDay: census,
        correctedTime: '01:00',
        correctedCalendarDay: '2026-11-31',
      }),
    ],
    base
  );
  let committed: Promise<DailyRecord> | undefined;
  const confirm = (applyPreviousDays: boolean) => {
    committed = applyConfirmedRayenImport({
      base,
      diff: checked,
      isAdmin: false,
      applyPreviousDays,
      getFreshRecord: async () => base,
      replanDiff: async () => checked,
      createId: ctx.idFactory,
      ensureRun: () => {
        throw Error('día previo inesperado');
      },
      dailyRecord: {} as import('@/application/ports/dailyRecordPort').DailyRecordRepositoryPort,
      applyDiff: async (current, diff) => {
        const result = applyCensusImportDiff(current, diff, ctx);
        return { ...result, record: await reread(result.record) };
      },
    }).then(result => result.record);
  };
  render(
    createElement(RayenImportPreviewModal, {
      isOpen: true,
      diff: checked,
      error: null,
      targetDate: census,
      onConfirm: confirm,
      onCancel: () => {},
    })
  );
  const button = screen.queryByRole('button', { name: 'Confirmar e importar' });
  const enabled = button instanceof HTMLButtonElement && !button.disabled;
  if (enabled) fireEvent.click(button);
  const saved = committed ? await committed : base;
  const facts = {
    enabled,
    conflicts: checked.conflicts.map(c => c.reason),
    proposed: checked.discharges.map(d => d.verification?.hospitalDischarge),
    events: movements(saved).map(m => [m.movementDate, m.time]),
    bedOccupied: Boolean(saved.beds.R2?.patientName),
  };
  expect(facts.events).toEqual([]);
  expect(facts.bedOccupied).toBe(true);
});
