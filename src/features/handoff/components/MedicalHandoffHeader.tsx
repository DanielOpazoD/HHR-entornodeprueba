/**
 * MedicalHandoffHeader Component
 *
 * Displays the medical handoff header with doctor signature information
 * for the medical shift handoff view.
 */

import React from 'react';
import { CheckCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import type { BedDefinition } from '@/types/domain/beds';
import { useConfirmDialog } from '@/context/UIContext';
import {
  buildMedicalHandoffBedStats,
  buildMedicalHandoffRestoreConfirm,
  buildMedicalHandoffSignConfirm,
  canPromptMedicalHandoffSign,
  canRestoreMedicalHandoffSignatures,
  resolveMedicalHandoffDoctorName,
} from '@/features/handoff/controllers/medicalHandoffHeaderController';

export interface MedicalHandoffBedStatsData {
  totalBeds: number;
  occupiedBeds: number;
  freeBeds: number;
  blockedBeds: number;
}

interface MedicalHandoffHeaderProps {
  record: DailyRecord;
  visibleBeds: BedDefinition[];
  readOnly: boolean;
  canRestoreSignatures: boolean;
  showDeliverySection: boolean;
  canEditDoctorName: boolean;
  canSignMedicalHandoff: boolean;
  updateMedicalHandoffDoctor?: (name: string) => void;
  markMedicalHandoffAsSent?: (doctorName: string) => void;
  resetMedicalHandoffState?: () => Promise<void>;
  shareActions?: React.ReactNode;
  /** Callback to pass bed stats up to parent for rendering elsewhere */
  onBedStats?: (stats: MedicalHandoffBedStatsData) => void;
}

export const MedicalHandoffHeader: React.FC<MedicalHandoffHeaderProps> = ({
  record,
  visibleBeds,
  readOnly,
  canRestoreSignatures,
  showDeliverySection,
  canEditDoctorName,
  canSignMedicalHandoff,
  updateMedicalHandoffDoctor,
  markMedicalHandoffAsSent,
  resetMedicalHandoffState,
  shareActions,
  onBedStats,
}) => {
  const { confirm: showConfirm, alert: showAlert } = useConfirmDialog();

  const handleSign = async () => {
    const doctorName = resolveMedicalHandoffDoctorName(record);
    if (!doctorName) {
      showAlert('Debe escribir su nombre para firmar la entrega.', 'Falta nombre');
      return;
    }

    const confirmed = await showConfirm(buildMedicalHandoffSignConfirm(doctorName));

    if (confirmed) {
      markMedicalHandoffAsSent?.(doctorName);
    }
  };

  const handleRestore = async () => {
    const confirmed = await showConfirm(buildMedicalHandoffRestoreConfirm());

    if (confirmed) {
      await resetMedicalHandoffState?.();
    }
  };

  const bedStats = React.useMemo(
    () => buildMedicalHandoffBedStats(record, visibleBeds),
    [record, visibleBeds]
  );

  // Pass bed stats to parent so it can render them in the specialty card
  React.useEffect(() => {
    onBedStats?.(bedStats);
  }, [bedStats, onBedStats]);

  return (
    <div className="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-sm ring-1 ring-black/[0.02] print:shadow-none print:border-none print:p-0 print:mb-2">
      <div className="flex flex-col sm:flex-row items-start gap-4 print:flex-row print:gap-6">
        {/* Delivers */}
        {showDeliverySection && (
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-[0.06em] mb-1 print:text-[9px] print:text-black">
              Entregado por (Dr.):
            </label>
            {!readOnly && canEditDoctorName ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder=""
                  value={record.medicalHandoffDoctor || ''}
                  onChange={e => updateMedicalHandoffDoctor?.(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 focus:outline-none print:hidden text-sm"
                />
                {canSignMedicalHandoff && canPromptMedicalHandoffSign(record) && (
                  <button
                    onClick={handleSign}
                    data-testid="medical-handoff-sign-button"
                    className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors text-[10px] font-semibold whitespace-nowrap print:hidden"
                    title="Firmar entrega de turno"
                  >
                    <ShieldCheck size={12} />
                    Firmar
                  </button>
                )}
                {canRestoreSignatures && canRestoreMedicalHandoffSignatures(record) && (
                  <button
                    onClick={() => void handleRestore()}
                    data-testid="medical-handoff-restore-signatures-button"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors text-xs font-bold whitespace-nowrap print:hidden"
                    title="Restaurar firmas médicas"
                  >
                    <RotateCcw size={14} />
                    Restaurar
                  </button>
                )}
              </div>
            ) : null}
            <div
              className={clsx(
                'text-sm font-medium text-slate-800 print:text-[11px]',
                !readOnly && canEditDoctorName && 'hidden print:block'
              )}
            >
              {record.medicalHandoffDoctor || (
                <span className="text-slate-400 italic">No especificado</span>
              )}
            </div>

            {record.medicalHandoffSentAt && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-blue-600">
                <ShieldCheck size={12} />
                <span className="font-medium">
                  Firmado:{' '}
                  {new Date(record.medicalHandoffSentAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Receives — same level as Delivers */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-[0.06em] mb-1 print:text-[9px] print:text-black">
            Recibido por (Dr.):
          </label>
          {record.medicalSignature ? (
            <div>
              <div className="font-bold text-green-700 text-sm print:text-[11px]">
                {record.medicalSignature.doctorName}
              </div>
              <div className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle size={12} />
                Firmado{' '}
                {new Date(record.medicalSignature.signedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          ) : (
            <div className="text-slate-400 italic flex items-center gap-2 text-sm print:text-[11px]">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-300 print:w-1 print:h-1"></div>
              Pendiente de firma
            </div>
          )}
        </div>

        {/* Share actions — right aligned */}
        {shareActions && <div className="shrink-0 self-center print:hidden">{shareActions}</div>}
      </div>
    </div>
  );
};

export default MedicalHandoffHeader;
