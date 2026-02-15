import React, { useMemo } from 'react';
import { Copy, Move, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { BEDS } from '@/constants';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useNotification } from '@/context/UIContext';
import { BaseModal } from '@/components/shared/BaseModal';
import { useRepositories } from '@/services/RepositoryContext';
import {
  resolveMoveCopyBedOptions,
  resolveMoveCopySourceBedName,
} from '@/features/census/controllers/moveCopyModalController';
import { useMoveCopyTargetRecord } from '@/features/census/hooks/useMoveCopyTargetRecord';
import { useMoveCopyModalState } from '@/features/census/hooks/useMoveCopyModalState';
import type { MoveCopyModalProps } from '@/features/census/types/censusActionModalContracts';

export const MoveCopyModal: React.FC<MoveCopyModalProps> = ({
  isOpen,
  type,
  sourceBedId,
  targetBedId,
  onClose,
  onSetTarget,
  onConfirm,
}) => {
  const { record: currentRecord } = useDailyRecordData();
  const { error: notifyError } = useNotification();
  const { dailyRecord } = useRepositories();
  const sourceBedName = useMemo(
    () => resolveMoveCopySourceBedName(BEDS, sourceBedId),
    [sourceBedId]
  );
  const handleTargetRecordError = React.useCallback(
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : 'Error inesperado';
      notifyError('No se pudo cargar disponibilidad', detail);
    },
    [notifyError]
  );
  const {
    selectedDate,
    dateOptions,
    canConfirm: canConfirmSelection,
    handleDateSelect,
    handleConfirm,
  } = useMoveCopyModalState({
    isOpen,
    type,
    currentRecordDate: currentRecord?.date,
    targetBedId,
    onSetTarget,
    onConfirm,
  });
  const { targetRecord: resolvedTargetRecord, isLoading: isTargetLoading } =
    useMoveCopyTargetRecord({
      isOpen,
      selectedDate,
      currentRecord,
      getRecordForDate: dailyRecord.getForDate,
      onError: handleTargetRecordError,
    });
  const bedOptions = useMemo(
    () =>
      currentRecord
        ? resolveMoveCopyBedOptions({
            allBeds: BEDS,
            currentRecord,
            targetRecord: resolvedTargetRecord,
            sourceBedId,
            targetBedId,
          })
        : [],
    [currentRecord, sourceBedId, targetBedId, resolvedTargetRecord]
  );
  const canConfirm = canConfirmSelection && !isTargetLoading;
  const handleConfirmAction = () => {
    if (!canConfirm) {
      return;
    }
    handleConfirm();
  };

  if (!type || !currentRecord) return null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={type === 'move' ? 'Mover Paciente' : 'Copiar Paciente'}
      icon={type === 'move' ? <Move size={18} /> : <Copy size={18} />}
      size="lg"
      headerIconColor="text-medical-600"
      variant="white"
    >
      <div className="space-y-4">
        {/* Date Selection (Only for Copy) */}
        {type === 'copy' && (
          <div className="space-y-1 pb-3 border-b border-slate-50">
            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1 mb-2">
              Fecha de Destino
            </label>
            <div className="flex gap-2">
              {dateOptions.map(opt => {
                const isSelected = selectedDate === opt.isoDate;

                return (
                  <button
                    key={opt.isoDate}
                    onClick={() => handleDateSelect(opt.isoDate)}
                    className={clsx(
                      'flex-1 py-2 px-3 rounded-lg border text-xs font-semibold transition-all flex items-center justify-center gap-2',
                      isSelected
                        ? 'bg-medical-600 text-white border-medical-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    )}
                  >
                    <Calendar size={14} className={isSelected ? 'opacity-100' : 'opacity-50'} />
                    <span>{opt.label}</span>
                    <span className={clsx('text-[10px]', isSelected ? 'opacity-80' : 'opacity-50')}>
                      {opt.displayDate}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
            Cama de Destino
          </label>
          <p className="text-[11px] text-slate-500 mb-2 ml-1">
            Desde <span className="font-bold text-slate-700">{sourceBedName}</span> hacia:
          </p>

          <div className="grid grid-cols-3 gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
            {isTargetLoading ? (
              <div className="col-span-3 py-8 text-center text-slate-400 text-xs">
                Verificando disponibilidad...
              </div>
            ) : (
              bedOptions.map(bed => {
                return (
                  <button
                    key={bed.id}
                    onClick={() => !bed.isDisabled && onSetTarget(bed.id)}
                    disabled={bed.isDisabled}
                    className={clsx(
                      'p-2 rounded-lg border text-left transition-all h-[52px] flex flex-col justify-between group',
                      bed.isSelected
                        ? 'bg-medical-50 border-medical-500 ring-1 ring-medical-500 shadow-sm'
                        : bed.isDisabled
                          ? 'bg-slate-50 border-slate-100 opacity-60 cursor-not-allowed'
                          : 'bg-slate-50 border-slate-200 hover:border-medical-300 hover:bg-white'
                    )}
                  >
                    <div className="flex justify-between items-center w-full">
                      <p
                        className={clsx(
                          'font-bold text-[11px] truncate',
                          bed.isSelected ? 'text-medical-800' : 'text-slate-700'
                        )}
                      >
                        {bed.name}
                      </p>
                      <div
                        className={clsx(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          bed.isOccupied ? 'bg-amber-400' : 'bg-emerald-400'
                        )}
                      />
                    </div>
                    <p
                      className={clsx(
                        'text-[8px] uppercase tracking-wider font-semibold',
                        bed.isSelected ? 'text-medical-600' : 'text-slate-400'
                      )}
                    >
                      {bed.statusLabel}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-4 flex justify-end items-center gap-3 border-t border-slate-50">
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-xs font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            disabled={!canConfirm}
            onClick={handleConfirmAction}
            className="px-5 py-2 bg-medical-600 text-white rounded-lg text-xs font-bold shadow-md shadow-medical-600/10 hover:bg-medical-700 transition-all transform active:scale-95 disabled:opacity-50 disabled:transform-none"
          >
            Confirmar {type === 'move' ? 'Traslado' : 'Copia'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
