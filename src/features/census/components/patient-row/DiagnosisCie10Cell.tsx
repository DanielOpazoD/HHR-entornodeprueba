import clsx from 'clsx';
import { TerminologySuggestor } from '@/components/shared/TerminologySuggestor';
import { getCIE10Description } from '@/services/terminology/terminologyService';
import { ClinicalInitialBlockEditor } from './ClinicalInitialBlockEditor';
import { DiagnosisCodeBadge } from './DiagnosisCodeBadge';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type { BaseCellProps, DebouncedTextHandler } from './inputCellTypes';
import type { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';

export interface DiagnosisCie10CellProps {
  data: BaseCellProps['data'];
  isSubRow: boolean;
  readOnly: boolean;
  readOnlyReason?: string;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: (fields: Partial<PatientData>) => void;
  canShowClinicalInitialBlockEditor: boolean;
  freshnessPause: ReturnType<typeof useClinicalFieldFreshnessPause>;
}

/**
 * Owns the CIE-10 search catalogue. It lives in its own module so the census table can
 * render without downloading it: the stored description already covers plain display,
 * and the catalogue is only needed once this cell is actually shown.
 */
const DiagnosisCie10Cell = ({
  data,
  isSubRow,
  readOnly,
  readOnlyReason,
  onChange,
  onMultipleUpdate,
  canShowClinicalInitialBlockEditor,
  freshnessPause,
}: DiagnosisCie10CellProps) => (
  <td
    className="census-diagnosis-cell py-0.5 px-1 border-r border-slate-200 min-w-[160px]"
    title={readOnlyReason}
    onMouseDownCapture={freshnessPause.acknowledge}
    onFocusCapture={freshnessPause.acknowledge}
  >
    <div className="relative w-full flex flex-col gap-0.5">
      <TerminologySuggestor
        className={clsx(
          'w-full border rounded transition-all duration-200 focus:ring-2 focus:outline-none text-[13px] h-7',
          'border-slate-200 focus:ring-medical-500/20 focus:border-medical-500',
          isSubRow && 'text-xs h-6',
          freshnessPause.pauseClassName
        )}
        placeholder="Buscar diagnóstico CIE-10..."
        value={
          data.cie10Description || (data.cie10Code ? getCIE10Description(data.cie10Code) : '') || ''
        }
        cie10Code={data.cie10Code}
        freeTextValue={data.pathology}
        onChange={(text, concept) => {
          if (concept) {
            if (onMultipleUpdate) {
              onMultipleUpdate({
                cie10Code: concept.code,
                cie10Description: concept.display,
              });
            } else {
              onChange('cie10Code')(concept.code);
              onChange('cie10Description')(concept.display);
            }
          } else {
            onChange('cie10Description')(text);
            if (text === '') {
              onChange('cie10Code')('');
            }
          }
        }}
        disabled={readOnly}
        title={readOnlyReason}
      />

      {canShowClinicalInitialBlockEditor && (
        <ClinicalInitialBlockEditor
          data={data}
          alignRightClassName={data.cie10Code ? 'right-20' : 'right-1'}
          onChange={onChange}
          onMultipleUpdate={onMultipleUpdate}
        />
      )}

      {data.cie10Code && (
        <span className="absolute right-1 top-1 inline-flex items-center gap-1">
          <DiagnosisCodeBadge
            code={data.cie10Code}
            description={data.cie10Description || data.pathology}
          />
          {!readOnly && (
            <button
              type="button"
              aria-label="Eliminar código CIE-10"
              title="Eliminar código CIE-10"
              className="text-slate-500 hover:text-red-600 leading-none"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                if (onMultipleUpdate) {
                  onMultipleUpdate({
                    cie10Code: '',
                    cie10Description: '',
                  });
                } else {
                  onChange('cie10Code')('');
                  onChange('cie10Description')('');
                }
              }}
            >
              x
            </button>
          )}
        </span>
      )}
      {freshnessPause.hint}
    </div>
  </td>
);

export default DiagnosisCie10Cell;
