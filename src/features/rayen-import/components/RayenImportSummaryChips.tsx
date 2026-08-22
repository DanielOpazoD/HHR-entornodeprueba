import React from 'react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { Chip } from './RayenImportDiffReviewParts';

interface RayenImportSummaryChipsProps {
  diff: CensusImportDiff;
  presentedUpdates: number;
  historicalConflicts: number;
  blockingConflicts: number;
  bedCollisions: number;
}

export const RayenImportSummaryChips: React.FC<RayenImportSummaryChipsProps> = ({
  diff,
  presentedUpdates,
  historicalConflicts,
  blockingConflicts,
  bedCollisions,
}) => (
  <div className="flex flex-wrap gap-2">
    <Chip label="Ingresos" value={diff.summary.admissions} tone="green" />
    <Chip label="Actualizaciones" value={presentedUpdates} tone="blue" />
    <Chip label="Movimientos de cama" value={diff.summary.moves} tone="teal" />
    <Chip label="Egresos" value={diff.summary.discharges} tone="amber" />
    <Chip
      label="Pend. alta administrativa"
      value={diff.summary.pendingAdministrativeDischarges}
      tone="indigo"
    />
    <Chip label="Sin cambios" value={diff.summary.unchanged} tone="gray" />
    {historicalConflicts > 0 && (
      <Chip label="Por revisar" value={historicalConflicts} tone="amber" />
    )}
    {blockingConflicts > 0 && <Chip label="Conflictos" value={blockingConflicts} tone="red" />}
    {bedCollisions > 0 && <Chip label="Decisiones de cama" value={bedCollisions} tone="red" />}
    {(diff.reportEgresos?.length ?? 0) > 0 && (
      <Chip label="Egresos no sincronizados" value={diff.reportEgresos?.length ?? 0} tone="amber" />
    )}
  </div>
);
