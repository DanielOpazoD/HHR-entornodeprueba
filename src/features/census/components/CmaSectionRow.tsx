import React, { Suspense, lazy, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText } from 'lucide-react';

import type { CMAData } from '@/features/census/contracts/censusMovementContracts';
import { CensusMovementActionsMenu } from '@/features/census/components/CensusMovementActionsMenu';
import {
  buildCmaIeehPatientSnapshot,
  CMA_INTERVENTION_TYPES,
} from '@/features/census/controllers/censusCmaController';
import { buildCmaClinicalDocumentsPatientSnapshot } from '@/features/census/controllers/movementClinicalDocumentsController';
import { resolveCmaUndoButtonTitle } from '@/features/census/controllers/censusCmaTableController';
import { useCensusMovementActionsCellModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';

const LazyIEEHFormDialog = lazy(() =>
  import('@/features/census/components/IEEHFormDialog').then(module => ({
    default: module.IEEHFormDialog,
  }))
);
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
    const [showIeehDialog, setShowIeehDialog] = useState(false);
    const [showClinicalDocuments, setShowClinicalDocuments] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [draftInterventionType, setDraftInterventionType] = useState(item.interventionType);
    const [draftDischargeTime, setDraftDischargeTime] = useState(item.dischargeTime || '');
    const [draftDiagnosis, setDraftDiagnosis] = useState(item.diagnosis || '');
    const ieehPatient = useMemo(
      () => buildCmaIeehPatientSnapshot(item, recordDate),
      [item, recordDate]
    );
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
          <td className="p-2">
            <span className="text-[13px] font-medium text-slate-800">
              {item.patientName || '-'}
            </span>
          </td>
          <td className="p-2">
            <span className="text-[11px] font-mono text-slate-500">{item.rut || '-'}</span>
          </td>
          <td className="p-2 text-center">
            <span className="text-[11px] text-slate-400">{item.age || '-'}</span>
          </td>
          <td className="p-2">
            <span className="text-[12px] text-slate-600">{item.diagnosis || '-'}</span>
          </td>
          <td className="p-2">
            <span className="text-xs text-slate-600">{item.specialty || '-'}</span>
          </td>
          <td className="p-2 text-center">
            <input
              type="time"
              step="300"
              className="text-xs font-medium text-slate-600 bg-green-50 px-2 py-1 rounded border border-green-200 w-20 text-center"
              value={item.dischargeTime || ''}
              onChange={event => onUpdate(item.id, { dischargeTime: event.target.value })}
            />
          </td>
          <td className="p-2 text-right print:hidden">
            <div className="flex items-center justify-end gap-1">
              <CensusMovementActionsMenu actions={actionViewModels} />
              <button
                type="button"
                onClick={() => setShowIeehDialog(true)}
                className="inline-flex h-7 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
                title="Generar Informe Estadístico de Egreso (IEEH)"
              >
                <FileText size={12} />
                IEEH
              </button>
            </div>
          </td>
        </tr>

        {showIeehDialog &&
          createPortal(
            <Suspense fallback={null}>
              <LazyIEEHFormDialog
                isOpen={showIeehDialog}
                onClose={() => setShowIeehDialog(false)}
                patient={ieehPatient}
                baseDischargeData={{
                  dischargeDate: recordDate,
                  dischargeTime: item.dischargeTime,
                }}
              />
            </Suspense>,
            document.body
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
