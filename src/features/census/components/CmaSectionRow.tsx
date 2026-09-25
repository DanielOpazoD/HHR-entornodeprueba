import React, { Suspense, lazy, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import { CensusMovementActionsMenu } from '@/features/census/components/CensusMovementActionsMenu';
import { CMA_INTERVENTION_TYPES } from '@/features/census/controllers/censusCmaController';
import { buildCmaClinicalDocumentsPatientSnapshot } from '@/features/census/controllers/movementClinicalDocumentsController';
import { resolveCmaUndoButtonTitle } from '@/features/census/controllers/censusCmaTableController';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';
import { MovementProvenanceBadge } from '@/features/census/components/MovementProvenanceBadge';
import { CensusMovementPatientIdentity } from './CensusMovementPatientIdentity';
import { CensusMovementEpicrisisButton } from './CensusMovementEpicrisisButton';
import { PatientHospitalizationReportsDialog } from './PatientHospitalizationReportsDialog';
import { resolveCmaHistoricalAdmissionDate } from '@/types/domain/movements';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

const LazyClinicalDocumentsModal = lazy(() =>
  import('@/features/clinical-documents').then(module => ({
    default: module.ClinicalDocumentsModal,
  }))
);

interface CmaSectionRowProps {
  item: CMAData;
  recordDate: string;
  onUpdate: (id: string, updates: Partial<CMAData>) => void;
  onUndo: (item: CMAData) => Promise<void>;
  onDelete: (item: CMAData) => void | Promise<void>;
  onConvertToDischarge: (item: CMAData) => void | Promise<void>;
  onConvertToTransfer?: (item: CMAData) => void | Promise<void>;
}

export const CmaSectionRow: React.FC<CmaSectionRowProps> = React.memo(
  ({ item, recordDate, onUpdate, onUndo, onDelete, onConvertToDischarge, onConvertToTransfer }) => {
    const [showClinicalDocuments, setShowClinicalDocuments] = useState(false);
    const [showHospitalizationReports, setShowHospitalizationReports] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [draftInterventionType, setDraftInterventionType] = useState(item.interventionType);
    const [draftDischargeTime, setDraftDischargeTime] = useState(item.dischargeTime || '');
    const [draftDiagnosis, setDraftDiagnosis] = useState(item.diagnosis || '');
    const clinicalDocumentsPatient = useMemo(
      () => buildCmaClinicalDocumentsPatientSnapshot(item, recordDate),
      [item, recordDate]
    );
    const openEditDialog = () => {
      setDraftInterventionType(item.interventionType);
      setDraftDischargeTime(item.dischargeTime || '');
      setDraftDiagnosis(item.diagnosis || '');
      setShowEditDialog(true);
    };
    const actionViewModels = useCensusMovementActionsCellModel([
      {
        kind: 'undo',
        title: resolveCmaUndoButtonTitle(item),
        className: '',
        onClick: () => void onUndo(item),
      },
      {
        kind: 'viewDocuments',
        title: 'Visualizar documentos clínicos',
        className: '',
        onClick: () => setShowClinicalDocuments(true),
      },
      {
        kind: 'edit',
        title: 'Editar datos CMA',
        className: '',
        onClick: openEditDialog,
      },
      {
        kind: 'convert',
        title: 'Convertir a alta domicilio',
        className: '',
        onClick: () => void onConvertToDischarge(item),
      },
      ...(onConvertToTransfer
        ? [
            {
              kind: 'convert' as const,
              title: 'Convertir a traslado',
              className: '',
              onClick: () => void onConvertToTransfer(item),
            },
          ]
        : []),
      {
        kind: 'delete',
        title: 'Eliminar registro',
        className: '',
        onClick: () => void onDelete(item),
      },
    ]);

    const saveEditDialog = () => {
      onUpdate(item.id, {
        interventionType: draftInterventionType,
        dischargeTime: draftDischargeTime,
        diagnosis: draftDiagnosis,
      });
      setShowEditDialog(false);
    };

    return (
      <>
        <tr className="hover:bg-slate-50 group border-b border-slate-100 last:border-0">
          <td className="p-2">
            <span className="text-xs font-medium text-slate-700">{item.bedName || '-'}</span>
          </td>
          <td className="p-2">
            <select
              className="w-full p-1 border border-slate-200 hover:border-slate-300 rounded focus:border-orange-400 focus:ring-1 focus:ring-orange-400 text-xs text-slate-600 bg-white transition-colors"
              value={item.interventionType || 'Cirugía Mayor Ambulatoria'}
              onChange={event =>
                onUpdate(item.id, {
                  interventionType: event.target.value as CMAData['interventionType'],
                })
              }
            >
              {CMA_INTERVENTION_TYPES.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </td>
          <CensusMovementPatientIdentity
            name={item.patientName}
            identifier={item.rut}
            admissionDate={resolveCmaHistoricalAdmissionDate(item)}
          />
          <td className="p-2">
            <span className="text-[12px] text-slate-600">{item.diagnosis || '-'}</span>
          </td>
          <td className="p-2 text-center">
            <div className="flex flex-col items-center">
              <span className="mb-1 whitespace-nowrap text-[11px] tabular-nums text-slate-500">
                {formatDateDDMMYYYY(recordDate)}
              </span>
              <input
                type="time"
                step="300"
                className="w-20 rounded border border-green-200 bg-green-50 px-2 py-1 text-center text-xs font-medium text-slate-600"
                value={item.dischargeTime || ''}
                onChange={event => onUpdate(item.id, { dischargeTime: event.target.value })}
              />
              <MovementProvenanceBadge provenance={item.movementProvenance} />
            </div>
          </td>
          <td className="p-2 text-right print:hidden">
            <div className="flex items-center justify-end gap-2">
              <CensusMovementEpicrisisButton
                patientName={item.patientName}
                onClick={() => setShowHospitalizationReports(true)}
              />
              <CensusMovementActionsMenu actions={actionViewModels} />
            </div>
          </td>
        </tr>

        {showHospitalizationReports && (
          <PatientHospitalizationReportsDialog
            isOpen={showHospitalizationReports}
            onClose={() => setShowHospitalizationReports(false)}
            patientName={item.patientName}
            patientRun={item.rut}
            currentEpisodeId={item.clinicalEpisodeId}
            admissionDate={resolveCmaHistoricalAdmissionDate(item)}
            censusDate={recordDate}
          />
        )}

        {showClinicalDocuments &&
          createPortal(
            <Suspense fallback={null}>
              <LazyClinicalDocumentsModal
                isOpen={showClinicalDocuments}
                onClose={() => setShowClinicalDocuments(false)}
                patient={clinicalDocumentsPatient}
                currentDateString={recordDate}
                bedId={item.originalBedId || item.id}
              />
            </Suspense>,
            document.body
          )}

        {showEditDialog &&
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 print:hidden">
              <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl">
                <h3 className="text-sm font-semibold text-slate-800">Editar datos CMA</h3>
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-medium text-slate-600">
                    Tipo
                    <select
                      className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-sm"
                      value={draftInterventionType}
                      onChange={event =>
                        setDraftInterventionType(event.target.value as CMAData['interventionType'])
                      }
                    >
                      {CMA_INTERVENTION_TYPES.map(option => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Hora egreso
                    <input
                      type="time"
                      step="300"
                      className="mt-1 w-full rounded border border-slate-200 p-2 text-sm"
                      value={draftDischargeTime}
                      onChange={event => setDraftDischargeTime(event.target.value)}
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600">
                    Diagnóstico de egreso
                    <textarea
                      className="mt-1 min-h-20 w-full rounded border border-slate-200 p-2 text-sm text-slate-700"
                      value={draftDiagnosis}
                      onChange={event => setDraftDiagnosis(event.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    onClick={() => setShowEditDialog(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="rounded bg-medical-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-medical-700"
                    onClick={saveEditDialog}
                  >
                    Guardar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
);

CmaSectionRow.displayName = 'CmaSectionRow';
