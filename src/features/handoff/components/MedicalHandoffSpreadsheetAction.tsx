import React, { useEffect, useState } from 'react';
import { ExternalLink, FileSpreadsheet, LoaderCircle } from 'lucide-react';

import { useNotification } from '@/context/UIContext';
import {
  MEDICAL_HANDOFF_SPREADSHEET_MAX_ROWS,
  type MedicalHandoffSpreadsheetRow,
} from '@/features/handoff/controllers/medicalHandoffSpreadsheetController';
import {
  openOrCreateMedicalHandoffSpreadsheet,
  type OpenMedicalHandoffSpreadsheetResult,
} from '@/features/handoff/services/medicalHandoffSpreadsheetService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { getErrorMessage } from '@/types/valueTypes';

interface MedicalHandoffSpreadsheetActionProps {
  date: string;
  rows: MedicalHandoffSpreadsheetRow[];
  openSpreadsheet?: (payload: {
    date: string;
    rows: MedicalHandoffSpreadsheetRow[];
  }) => Promise<OpenMedicalHandoffSpreadsheetResult>;
}

export const MedicalHandoffSpreadsheetAction: React.FC<MedicalHandoffSpreadsheetActionProps> = ({
  date,
  rows,
  openSpreadsheet = openOrCreateMedicalHandoffSpreadsheet,
}) => {
  const { success, error } = useNotification();
  const [isLoading, setIsLoading] = useState(false);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);

  useEffect(() => {
    setSpreadsheetUrl(null);
  }, [date, rows]);

  const handleOpen = async () => {
    if (rows.length > MEDICAL_HANDOFF_SPREADSHEET_MAX_ROWS) {
      error(
        'No se pudo preparar la planilla',
        `Las camas ocupadas y cunas RN superan el máximo de ${MEDICAL_HANDOFF_SPREADSHEET_MAX_ROWS} filas.`
      );
      return;
    }

    if (spreadsheetUrl) {
      const spreadsheetWindow = defaultBrowserWindowRuntime.open(spreadsheetUrl, '_blank');
      if (spreadsheetWindow) {
        spreadsheetWindow.opener = null;
      }
      return;
    }

    const pendingWindow = defaultBrowserWindowRuntime.open('about:blank', '_blank');
    if (pendingWindow) {
      pendingWindow.opener = null;
      pendingWindow.document.title = 'Preparando planilla de entrega...';
    }

    setIsLoading(true);
    try {
      const result = await openSpreadsheet({ date, rows });
      setSpreadsheetUrl(result.spreadsheetUrl);
      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.location.replace(result.spreadsheetUrl);
      }
      success(
        result.created ? 'Planilla creada' : 'Planilla abierta',
        pendingWindow
          ? 'La entrega médica quedó disponible en Google Sheets.'
          : 'La planilla está lista. Pulsa “Abrir planilla” para verla.'
      );
    } catch (caughtError) {
      pendingWindow?.close();
      error(
        'No se pudo abrir la planilla',
        getErrorMessage(caughtError) ||
          'Revisa la configuración institucional e intenta nuevamente.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const label = isLoading ? 'Preparando...' : spreadsheetUrl ? 'Abrir planilla' : 'Crear planilla';
  const Icon = isLoading ? LoaderCircle : spreadsheetUrl ? ExternalLink : FileSpreadsheet;

  return (
    <button
      type="button"
      data-testid="medical-handoff-spreadsheet-button"
      onClick={() => void handleOpen()}
      disabled={isLoading || rows.length === 0}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
      title={
        rows.length === 0
          ? 'No hay pacientes para exportar'
          : 'Crear o abrir la planilla colaborativa de entrega médica'
      }
    >
      <Icon size={14} className={isLoading ? 'animate-spin' : undefined} />
      {label}
    </button>
  );
};
