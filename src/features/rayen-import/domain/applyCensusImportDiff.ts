/**
 * Applies a (reviewed) `CensusImportDiff` onto a `DailyRecord`, returning the next
 * record plus what was applied/skipped. Pure and deterministic given `idFactory`
 * and `now` — no persistence here (that is the use-case's job).
 *
 * Defensive by design: it never overwrites an occupied bed. Any op whose target is
 * still occupied is skipped and reported, so neither preview nor auto mode can clobber
 * a patient. Movement records are appended to discharges[] / transfers[] / cma[].
 */

import { CensusManager } from '@/domain/CensusManager';
import { BEDS } from '@/constants/beds';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { CensusImportDiff, DischargeEntry } from '../contracts/censusImportDiff';

const BED_NAME = new Map(BEDS.map(bed => [bed.id, bed.name]));
const BED_TYPE = new Map<string, string>(BEDS.map(bed => [bed.id, bed.type]));

const isOccupied = (patient: PatientData | undefined): patient is PatientData =>
  !!patient && !!patient.patientName?.trim() && !patient.isBlocked;

const hhmm = (now: Date): string => now.toTimeString().slice(0, 5);

const asSpecialty = (value: PatientData['specialty']): string =>
  typeof value === 'string' ? value : String(value);

export interface ApplyContext {
  /** Generates unique ids for the movement records. */
  idFactory: () => string;
  /** Reference "now" for timestamps (defaults to new Date()). */
  now?: Date;
}

export interface SkippedOp {
  kind: 'admission' | 'move' | 'update';
  bedId: string;
  reason: string;
}

export interface ApplyResult {
  record: DailyRecord;
  applied: { admissions: number; updates: number; moves: number; discharges: number };
  skipped: SkippedOp[];
}

const buildDischarge = (
  patient: PatientData,
  entry: DischargeEntry,
  record: DailyRecord,
  ctx: Required<ApplyContext>
): DischargeData => ({
  id: ctx.idFactory(),
  movementDate: record.date,
  admissionDate: patient.admissionDate || undefined,
  bedName: BED_NAME.get(entry.bedId) ?? entry.bedId,
  bedId: entry.bedId,
  bedType: BED_TYPE.get(entry.bedId) ?? '',
  patientName: patient.patientName,
  rut: patient.rut,
  diagnosis: patient.pathology,
  specialty: asSpecialty(patient.specialty),
  time: hhmm(ctx.now),
  status: entry.status,
  dischargeType: entry.status === 'Vivo' ? 'Domicilio (Habitual)' : undefined,
  age: patient.age || undefined,
  insurance: patient.insurance,
  origin: patient.origin,
  isRapanui: patient.isRapanui,
  originalData: { ...patient },
  clinicalEpisodeId: patient.clinicalEpisodeId,
});

const buildTransfer = (
  patient: PatientData,
  entry: DischargeEntry,
  record: DailyRecord,
  ctx: Required<ApplyContext>
): TransferData => ({
  id: ctx.idFactory(),
  movementDate: record.date,
  admissionDate: patient.admissionDate || undefined,
  bedName: BED_NAME.get(entry.bedId) ?? entry.bedId,
  bedId: entry.bedId,
  bedType: BED_TYPE.get(entry.bedId) ?? '',
  patientName: patient.patientName,
  rut: patient.rut,
  diagnosis: patient.pathology,
  specialty: asSpecialty(patient.specialty),
  time: hhmm(ctx.now),
  evacuationMethod: '',
  receivingCenter: '',
  age: patient.age || undefined,
  insurance: patient.insurance,
  origin: patient.origin,
  isRapanui: patient.isRapanui,
  originalData: { ...patient },
  clinicalEpisodeId: patient.clinicalEpisodeId,
});

const buildCma = (
  patient: PatientData,
  entry: DischargeEntry,
  ctx: Required<ApplyContext>
): CMAData => ({
  ...CensusManager.formatCMAData(patient, entry.bedId),
  id: ctx.idFactory(),
  timestamp: ctx.now.toISOString(),
  dischargeTime: hhmm(ctx.now),
  clinicalEpisodeId: patient.clinicalEpisodeId,
});

export const applyCensusImportDiff = (
  current: DailyRecord,
  diff: CensusImportDiff,
  context: ApplyContext
): ApplyResult => {
  const ctx: Required<ApplyContext> = {
    idFactory: context.idFactory,
    now: context.now ?? new Date(),
  };
  const nextBeds: Record<string, PatientData> = { ...current.beds };
  const discharges: DischargeData[] = [...current.discharges];
  const transfers: TransferData[] = [...current.transfers];
  const cma: CMAData[] = [...current.cma];
  const skipped: SkippedOp[] = [];
  const applied = { admissions: 0, updates: 0, moves: 0, discharges: 0 };

  // 1) Discharges: vacate the bed and append the matching movement record.
  for (const entry of diff.discharges) {
    const patient = isOccupied(current.beds[entry.bedId]) ? current.beds[entry.bedId] : undefined;
    if (patient) delete nextBeds[entry.bedId];
    const subject = patient ?? undefined;
    if (!subject) continue; // nothing to discharge (already gone)
    if (entry.kind === 'cma') cma.push(buildCma(subject, entry, ctx));
    else if (entry.kind === 'traslado') transfers.push(buildTransfer(subject, entry, current, ctx));
    else discharges.push(buildDischarge(subject, entry, current, ctx));
    applied.discharges += 1;
  }

  // 2) Moves: capture sources from the ORIGINAL record, free them, then place targets.
  const moveOps = diff.moves
    .map(move => ({ move, source: current.beds[move.fromBedId] }))
    .filter(op => isOccupied(op.source));
  for (const { move } of moveOps) delete nextBeds[move.fromBedId];
  for (const { move, source } of moveOps) {
    if (isOccupied(nextBeds[move.toBedId])) {
      skipped.push({ kind: 'move', bedId: move.toBedId, reason: 'Cama destino ocupada.' });
      nextBeds[move.fromBedId] = source; // restore, do not lose the patient
      continue;
    }
    nextBeds[move.toBedId] = { ...source, bedId: move.toBedId };
    applied.moves += 1;
  }

  // 3) Admissions: only into a free bed.
  for (const entry of diff.admissions) {
    if (isOccupied(nextBeds[entry.bedId])) {
      skipped.push({ kind: 'admission', bedId: entry.bedId, reason: 'Cama ocupada.' });
      continue;
    }
    nextBeds[entry.bedId] = entry.patient;
    applied.admissions += 1;
  }

  // 4) Updates: merge only the changed Rayen-sourced fields, preserving app-managed data.
  for (const entry of diff.updates) {
    const existing = nextBeds[entry.bedId];
    if (!isOccupied(existing)) {
      skipped.push({ kind: 'update', bedId: entry.bedId, reason: 'Sin paciente en la cama.' });
      continue;
    }
    const merged = { ...existing } as unknown as Record<string, unknown>;
    for (const change of entry.changes) {
      merged[change.field] = change.to;
    }
    nextBeds[entry.bedId] = merged as unknown as PatientData;
    applied.updates += 1;
  }

  const record: DailyRecord = {
    ...current,
    beds: nextBeds,
    discharges,
    transfers,
    cma,
    lastUpdated: ctx.now.toISOString(),
  };

  return { record, applied, skipped };
};
