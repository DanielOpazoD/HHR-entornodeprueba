import React from 'react';
import type { CudyrScore } from '@/types/domain/cudyr';
import { PatientData } from '@/features/cudyr/contracts/cudyrPatientContracts';
import { BedDefinition } from '@/types/domain/beds';
import clsx from 'clsx';
import { buildCudyrRowViewModel } from '@/features/cudyr/controllers/cudyrRowViewController';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';

interface CudyrRowProps {
  bed: BedDefinition;
  patient: PatientData | undefined;
  onScoreChange: (bedId: string, field: keyof CudyrScore, value: number) => void;
  readOnly?: boolean;
  isCrib?: boolean;
  eligibilityBlocked?: boolean;
  eligibilityBlockedReason?: string;
  censusDate: string;
}

// Reusable Header Cell for Vertical Text
export const VerticalHeader = ({ text, colorClass }: { text: string; colorClass: string }) => (
  <th
    className={clsx(
      'border border-slate-300 p-0 w-6 align-bottom h-44 relative print:h-24 print:bg-white',
      colorClass
    )}
  >
    <div className="h-full w-full flex items-center justify-center overflow-hidden">
      <span
        className="block whitespace-nowrap text-[10px] font-bold leading-none tracking-tight uppercase print:text-[5px] print:transform-none"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {text}
      </span>
    </div>
  </th>
);

const ScoreInput: React.FC<{
  bedId: string;
  field: keyof CudyrScore;
  value?: number;
  onScoreChange: (bedId: string, field: keyof CudyrScore, value: number) => void;
  readOnly?: boolean;
}> = ({ bedId, field, value, onScoreChange, readOnly }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    if (valStr === '') {
      onScoreChange(bedId, field, 0);
      return;
    }
    const num = parseInt(valStr);
    if (!isNaN(num) && num >= 0 && num <= 3) {
      onScoreChange(bedId, field, num);
    }
  };

  return (
    <input
      type="number"
      min="0"
      max="3"
      className={clsx(
        'w-full h-full text-center bg-transparent border-0 p-1 text-xs focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-medium',
        readOnly && 'cursor-not-allowed opacity-60'
      )}
      value={value ?? ''}
      onClick={e => (e.target as HTMLInputElement).select()}
      onChange={handleChange}
      disabled={readOnly}
    />
  );
};

export const CudyrRow: React.FC<CudyrRowProps> = ({
  bed,
  patient,
  onScoreChange,
  readOnly = false,
  isCrib = false,
  eligibilityBlocked = false,
  eligibilityBlockedReason,
  censusDate,
}) => {
  const viewModel = buildCudyrRowViewModel({
    bed,
    patient,
    readOnly,
    isCrib,
    eligibilityBlocked,
    eligibilityBlockedReason,
  });

  if (!viewModel.isOccupied) {
    return (
      <tr
        className={clsx(
          'border-b border-slate-300 hover:bg-slate-100 transition-colors',
          viewModel.rowBgClass
        )}
      >
        <td
          className={clsx(
            'border-r border-slate-300 p-1 text-center font-bold',
            viewModel.bedTextClass
          )}
        >
          {bed.name}
        </td>
        <td colSpan={17} className="p-2 text-center text-slate-400 italic text-[10px]">
          {viewModel.emptyStateLabel}
        </td>
      </tr>
    );
  }

  const occupiedPatient = patient!;
  // The imported category can include official author, time and 14-item detail from Gestión de Camas.
  const candidateImportedCudyr = occupiedPatient.evaluationScores?.cudyr ?? null;
  const importedCudyr =
    candidateImportedCudyr &&
    importedCudyrBelongsToCensus(candidateImportedCudyr, censusDate) &&
    /^[A-D][1-3]$/i.test(candidateImportedCudyr.category.trim())
      ? candidateImportedCudyr
      : null;
  const importedCudyrTooltip = importedCudyr
    ? [
        `CUDYR ${importedCudyr.category} importado desde ${importedCudyr.source}.`,
        importedCudyr.author
          ? `Profesional: ${importedCudyr.author}${importedCudyr.authorRole ? ` (${importedCudyr.authorRole})` : ''}.`
          : 'Profesional no informado por la fuente.',
        importedCudyr.recordedAt
          ? `Registrado: ${formatDateTimeCL(importedCudyr.recordedAt)}.`
          : 'Hora de registro no informada por la fuente.',
        importedCudyr.items?.length
          ? `${importedCudyr.items.length} variables oficiales disponibles.`
          : 'Solo categoría compuesta; sin desglose de variables.',
      ].join('\n')
    : undefined;

  return (
    <tr
      className={clsx(
        'border-b border-slate-300 hover:bg-slate-100 transition-colors',
        viewModel.rowBgClass
      )}
    >
      <td
        className={clsx(
          'border-r border-slate-300 p-1 text-center font-bold',
          viewModel.bedTextClass
        )}
      >
        {bed.name}
      </td>
      <td
        className={clsx(
          'border-r border-slate-300 p-1 truncate font-medium w-[100px] max-w-[100px] print:w-[88px] print:max-w-[88px] print:whitespace-nowrap print:overflow-visible',
          viewModel.patientCellClass
        )}
        title={viewModel.patientTitle}
      >
        {/* Show name on screen, RUT when printing */}
        <span className={clsx('print:hidden', viewModel.showBlockedLabel && 'font-semibold')}>
          {occupiedPatient.patientName}
        </span>
        {viewModel.showBlockedLabel && (
          <span className="print:hidden block text-[9px] font-semibold uppercase tracking-wide text-amber-700">
            {viewModel.blockedLabel}
          </span>
        )}
        {importedCudyr && (
          <span
            className="print:hidden block text-[9px] font-semibold uppercase tracking-wide text-indigo-700"
            title={importedCudyrTooltip}
          >
            Importado Eloísa ⓘ
          </span>
        )}
        <span className="hidden print:inline text-[10px]">{occupiedPatient.rut || '-'}</span>
      </td>

      {/* Dependency Inputs */}
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
        <ScoreInput
          bedId={bed.id}
          field="changeClothes"
          value={viewModel.scores?.changeClothes}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
        <ScoreInput
          bedId={bed.id}
          field="mobilization"
          value={viewModel.scores?.mobilization}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
        <ScoreInput
          bedId={bed.id}
          field="feeding"
          value={viewModel.scores?.feeding}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
        <ScoreInput
          bedId={bed.id}
          field="elimination"
          value={viewModel.scores?.elimination}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
        <ScoreInput
          bedId={bed.id}
          field="psychosocial"
          value={viewModel.scores?.psychosocial}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
        <ScoreInput
          bedId={bed.id}
          field="surveillance"
          value={viewModel.scores?.surveillance}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>

      {/* Risk Inputs */}
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="vitalSigns"
          value={viewModel.scores?.vitalSigns}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="fluidBalance"
          value={viewModel.scores?.fluidBalance}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="oxygenTherapy"
          value={viewModel.scores?.oxygenTherapy}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="airway"
          value={viewModel.scores?.airway}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="proInterventions"
          value={viewModel.scores?.proInterventions}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="skinCare"
          value={viewModel.scores?.skinCare}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="pharmacology"
          value={viewModel.scores?.pharmacology}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>
      <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
        <ScoreInput
          bedId={bed.id}
          field="invasiveElements"
          value={viewModel.scores?.invasiveElements}
          onScoreChange={onScoreChange}
          readOnly={viewModel.rowReadOnly}
        />
      </td>

      {/* Results - P.DEP and P.RIES first (hidden on print), then CAT */}
      <td className="border-r border-slate-300 p-1 text-center text-xs text-blue-800 font-bold bg-blue-50/30 print:hidden">
        {viewModel.displayedDepScore}
      </td>
      <td className="border-r border-slate-300 p-1 text-center text-xs text-red-800 font-bold bg-red-50/30 print:hidden">
        {viewModel.displayedRiskScore}
      </td>
      <td className="p-1 text-center print:p-0.5">
        <span
          className={clsx(
            'px-2 py-0.5 rounded font-bold text-xs block w-full shadow-sm print:px-1 print:text-[10px]',
            importedCudyr ? 'bg-indigo-100 text-indigo-800' : viewModel.badgeColor
          )}
          title={importedCudyr ? importedCudyrTooltip : undefined}
        >
          {importedCudyr ? importedCudyr.category : viewModel.finalCat}
        </span>
      </td>
    </tr>
  );
};
