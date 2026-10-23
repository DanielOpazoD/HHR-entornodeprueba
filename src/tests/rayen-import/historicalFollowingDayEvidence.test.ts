// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { previousCensusEgresoCandidates } from '@/features/rayen-import/domain/previousCensusEgresoCandidates';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { planRayenCensusImport } from '@/features/rayen-import/importRayenCensusUseCase';
import { applyEgresoReport } from '@/features/rayen-import/domain/applyEgresoReport';
import type { EgresoLookupTarget } from '@/features/rayen-import/contracts/egresoLookup';

it('uses following-day mother/RN discharges only to establish their presence at the previous close', async () => {
  const day = '2026-08-12';
  const mother = DataFactory.createMockPatient('H4C2', {
    patientName: 'Madre Sintética',
    rut: '8.260.364-6',
    clinicalEpisodeId: '1001',
    admissionDate: day,
    admissionTime: '14:04',
    clinicalCrib: DataFactory.createMockPatient('H4C2', {
      patientName: 'RN de Madre Sintética',
      rut: '',
      neonatalMaternalRut: '8.260.364-6',
      clinicalEpisodeId: '1002',
      admissionDate: day,
      admissionTime: '15:00',
      bedMode: 'Cuna',
      handoffNoteNightShift: 'Texto neonatal conservado',
    }),
  });
  const record = DataFactory.createMockDailyRecord(day, { beds: { H4C2: mother } });
  const before = structuredClone(record);
  const rows = [mother.patientName, mother.clinicalCrib!.patientName].map(patientName => ({
    run: mother.rut,
    patientName,
    bedLabel: 'H4C2',
    servicio: 'Área Médico Quirúrgica',
    edad: '',
    motivo: 'Alta hospitalaria',
    destino: 'Domicilio',
    fechaEgreso: '13-08-2026 16:28',
  }));
  expect(previousCensusEgresoCandidates(record, rows, day)).toEqual([]);
  const candidates = previousCensusEgresoCandidates(record, rows, day, true);
  expect(candidates.map(candidate => candidate.encounterId).sort()).toEqual(['1001', '1002']);

  const reports: Record<string, string> = {
    '1001': `Informe Estadístico de Egreso Hospitalario
1.RUN:
8 2 6 0 3 6 4 - 6
24 INGRESO 1 4 - 0 4 1 2 - 0 8 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
29 EGRESO 1 4 - 2 8 1 3 - 0 8 - 2 6 Domicilio 4 0 4`,
    '1002': `Informe Estadístico de Egreso Hospitalario
5 2 6 SEXO M
2. RUN Materno/progenitor(a)
1.RUN:
-
No de Pasaporte u otro documento
1. Masculino
8 2 6 0 3 6 4 6 54 IDENTIDAD DE GÉNERO 01
24 INGRESO 1 5 - 0 0 1 2 - 0 8 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
29 EGRESO 1 4 - 2 8 1 3 - 0 8 - 2 6 Domicilio 4 0 4`,
  };
  const lookupEgresos = vi.fn(async (targets: EgresoLookupTarget[]) =>
    targets.map(target => ({
      run: target.run,
      encounterId: target.encounterId,
      egreso: reports[target.encounterId] ? { id: target.encounterId } : undefined,
    }))
  );
  const enriched = await enrichReportOnlyDischarges(rows, day, {
    allReportDays: true,
    previousCensusCandidates: candidates,
    lookupEgresos,
    fetchStatisticalDischarge: async episode => ({
      base64: Buffer.from(episode).toString('base64'),
    }),
    extractText: async bytes => reports[new TextDecoder().decode(bytes)],
  });
  expect(enriched).toHaveLength(2);
  expect(enriched.every(row => row.exactEpisodeVerification === 'verified')).toBe(true);
  expect(enriched.every(row => row.correctedDay === '2026-08-13')).toBe(true);
  const reconstruction = await reconstructHistoricalSnapshotAtClose(
    day,
    { capturedAt: '2026-08-14T12:00:00Z', facilityId: 1342, isComplete: true, encounters: [] },
    record,
    enriched,
    {
      fetchReport: async () => ({ base64: 'QQ==' }),
      extractText: async () =>
        'Flujo del Paciente RUN: 82603646\n12/08/2026 14:04:00 Servicio Estación Habitación 4 Básica C2',
    }
  );
  expect(reconstruction.conflicts).toEqual([]);
  expect(reconstruction.snapshot.encounters.map(encounter => encounter.encounterId).sort()).toEqual(
    ['1001', '1002']
  );
  const plan = planRayenCensusImport({
    current: record,
    snapshot: reconstruction.snapshot,
    reference: new Date('2026-08-14T12:00:00Z'),
  });
  expect(plan.diff.conflicts).toEqual([]);
  expect(plan.diff.discharges).toEqual([]);
  expect(plan.diff.admissions).toEqual([]);
  const withSourceDischarges = applyEgresoReport(plan.diff, enriched, record);
  expect(withSourceDischarges.discharges).toEqual([]);
  expect(withSourceDischarges.reportEgresos ?? []).toEqual([]);
  expect(record).toEqual(before);
});
