import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';
import { buildMovementRowActions } from '@/features/census/controllers/censusMovementRowActionsController';
import { canReclassifyHomeDischarge } from '@/application/census/movementTypeConversionPolicy';

export const DISCHARGES_TABLE_HEADERS: readonly CensusMovementTableHeader[] = [
  { label: 'Cama Origen' },
  { label: 'Paciente' },
  { label: 'RUT / ID' },
  { label: 'Diagnóstico' },
  { label: 'Tipo Alta' },
  { label: 'Estado' },
  { label: 'Fecha / Hora Alta', className: 'text-center' },
  { label: 'Acciones', className: 'text-right print:hidden' },
] as const;

export const getDischargeStatusBadgeClassName = (status: DischargeData['status']): string => {
  return status === 'Fallecido' ? 'bg-black text-white' : 'bg-green-100 text-green-700';
};

interface DischargeRowActionHandlers {
  undoDischarge: (id: string) => void;
  viewClinicalDocuments: (discharge: DischargeData) => void;
  openHospitalizationReports: (discharge: DischargeData) => void;
  editDischarge: (discharge: DischargeData) => void;
  deleteDischarge: (id: string) => void;
  convertDischargeToCma: (id: string) => void;
  convertDischargeToTransfer?: (id: string) => void;
}

export const buildDischargeRowActions = (
  discharge: DischargeData,
  handlers: DischargeRowActionHandlers
): ReturnType<typeof buildMovementRowActions> => {
  const [undoAction, editAction, deleteAction] = buildMovementRowActions(discharge, {
    onUndo: handlers.undoDischarge,
    onEdit: handlers.editDischarge,
    onDelete: handlers.deleteDischarge,
  });
  const actions = [
    undoAction,
    {
      kind: 'viewDocuments' as const,
      title: 'Visualizar documentos clínicos',
      className: 'text-blue-600 hover:text-blue-700',
      onClick: () => handlers.viewClinicalDocuments(discharge),
    },
  ];

  if (/^[0-9]{6,8}[0-9K]$/.test(discharge.rut.toUpperCase().replace(/[^0-9K]/g, ''))) {
    actions.push({
      kind: 'hospitalizationReports' as const,
      title: 'Informes de hospitalización',
      className: 'text-sky-600 hover:text-sky-700',
      onClick: () => handlers.openHospitalizationReports(discharge),
    });
  }
  actions.push(editAction);

  if (canReclassifyHomeDischarge(discharge)) {
    if (handlers.convertDischargeToTransfer) {
      actions.push({
        kind: 'convert',
        title: 'Convertir a traslado',
        className: 'text-orange-500 hover:text-orange-700',
        onClick: () => {
          void handlers.convertDischargeToTransfer?.(discharge.id);
        },
      });
    }
    actions.push({
      kind: 'convert',
      title: 'Convertir a CMA',
      className: 'text-orange-500 hover:text-orange-700',
      onClick: () => {
        void handlers.convertDischargeToCma(discharge.id);
      },
    });
  }

  actions.push(deleteAction);
  return actions;
};
