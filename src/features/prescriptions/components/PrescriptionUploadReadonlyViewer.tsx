import React, { useEffect, useState } from 'react';
import { CalendarDays, Eye, Loader2 } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { PrescriptionDetailModal } from '@/features/prescriptions/components/PrescriptionDetailModal';
import { PrescriptionListItem } from '@/features/prescriptions/components/PrescriptionListItem';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';
import { listPrescriptionUploadReadonlyRecords } from '@/features/prescriptions/services/prescriptionAccessService';
import {
  buildPrescriptionUploadViewerDayOptions,
  type PrescriptionUploadViewerDayKey,
} from '@/features/prescriptions/components/prescriptionUploadReadonlyViewerSupport';

interface PrescriptionUploadReadonlyViewerProps {
  isOpen: boolean;
  onClose: () => void;
  accessPin?: string | null;
}

const noopReassign = async () => undefined;
const noopDelete = async () => undefined;

export const PrescriptionUploadReadonlyViewer: React.FC<PrescriptionUploadReadonlyViewerProps> = ({
  isOpen,
  onClose,
  accessPin,
}) => {
  const [selectedDayKey, setSelectedDayKey] = useState<PrescriptionUploadViewerDayKey>('today');
  const [selectedRecord, setSelectedRecord] = useState<PrescriptionRecord | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [records, setRecords] = useState<PrescriptionRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dayOptions = buildPrescriptionUploadViewerDayOptions();
  const selectedDay = dayOptions.find(option => option.key === selectedDayKey) ?? dayOptions[0];

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    void Promise.resolve().then(() => {
      if (cancelled) return;
      setPhase('loading');
      setErrorMessage(null);
    });

    listPrescriptionUploadReadonlyRecords({
      date: selectedDay.isoDate,
      pin: accessPin ?? undefined,
    })
      .then(result => {
        if (cancelled) return;
        setRecords(result.records);
        setPhase('ready');
      })
      .catch(error => {
        if (cancelled) return;
        setRecords([]);
        setErrorMessage(
          error instanceof Error ? error.message : 'No se pudieron cargar las recetas subidas.'
        );
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [accessPin, isOpen, selectedDay.isoDate]);

  const handleClose = () => {
    setSelectedRecord(null);
    onClose();
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title="Recetas subidas"
        icon={<Eye size={18} />}
        size="2xl"
        variant="white"
        bodyClassName="p-0"
        dataTestId="prescription-upload-readonly-viewer"
      >
        <div className="flex max-h-[82vh] flex-col bg-slate-50">
          <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
              {dayOptions.map(option => {
                const isSelected = option.key === selectedDay.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSelectedDayKey(option.key)}
                    className={`flex min-h-12 flex-col items-center justify-center rounded-lg px-2 py-2 text-center transition-colors ${
                      isSelected
                        ? 'bg-white text-sky-800 shadow-sm ring-1 ring-sky-100'
                        : 'text-slate-600 hover:bg-white/70'
                    }`}
                  >
                    <span className="text-sm font-semibold">{option.label}</span>
                    <span className="text-xs">{option.displayDate}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays size={14} />
              <span>
                {records.length} receta{records.length === 1 ? '' : 's'} para{' '}
                {selectedDay.displayDate}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5">
            {phase === 'loading' ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 size={18} className="animate-spin" />
                Cargando recetas...
              </div>
            ) : phase === 'error' ? (
              <div
                role="alert"
                className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-center"
              >
                <p className="text-sm font-semibold text-red-800">
                  No se pudieron cargar las recetas
                </p>
                <p className="mt-1 text-xs text-red-700">{errorMessage}</p>
              </div>
            ) : records.length > 0 ? (
              <div className="space-y-2">
                {records.map(record => (
                  <PrescriptionListItem
                    key={record.id}
                    record={record}
                    onSelect={setSelectedRecord}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-4 text-center">
                <Eye size={24} className="mb-2 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700">
                  Sin recetas subidas el {selectedDay.displayDate}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Cambia entre hoy y ayer para revisar cargas recientes.
                </p>
              </div>
            )}
          </div>
        </div>
      </BaseModal>

      {selectedRecord && (
        <PrescriptionDetailModal
          record={selectedRecord}
          canEdit={false}
          canDelete={false}
          onClose={() => setSelectedRecord(null)}
          onReassign={noopReassign}
          onDelete={noopDelete}
          selectedDate={selectedDay.isoDate}
        />
      )}
    </>
  );
};
