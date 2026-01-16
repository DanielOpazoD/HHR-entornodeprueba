import React, { useState } from 'react';
import { Lock, BedDouble, CheckCircle } from 'lucide-react';
import clsx from 'clsx';
import { BEDS } from '../../constants';
import { useDailyRecordContext } from '../../context/DailyRecordContext';
import { BaseModal, ModalSection } from '../shared/BaseModal';
import { BedBlockSchema } from '../../schemas/inputSchemas';
interface BedManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BedManagerModal: React.FC<BedManagerModalProps> = ({
  isOpen, onClose
}) => {
  const { record, toggleBlockBed, updateBlockedReason, toggleExtraBed } = useDailyRecordContext();
  const [blockingBedId, setBlockingBedId] = useState<string | null>(null);
  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!record) return null;

  const handleBedClick = (bedId: string, isBlocked: boolean) => {
    setError(null);
    if (isBlocked) {
      setEditingBedId(bedId);
      setReason(record.beds[bedId].blockedReason || '');
    } else {
      setBlockingBedId(bedId);
      setReason('');
    }
  };

  const handleUnblock = () => {
    if (editingBedId) {
      toggleBlockBed(editingBedId);
      setEditingBedId(null);
      setReason('');
      setError(null);
    }
  };

  const validateReason = () => {
    const result = BedBlockSchema.safeParse({ reason });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return false;
    }
    setError(null);
    return true;
  };

  const handleSaveReason = () => {
    if (editingBedId && validateReason()) {
      updateBlockedReason(editingBedId, reason);
      setEditingBedId(null);
      setReason('');
    }
  };

  const confirmBlock = () => {
    if (blockingBedId && validateReason()) {
      toggleBlockBed(blockingBedId, reason);
      setBlockingBedId(null);
      setReason('');
    }
  };

  const cancelBlock = () => {
    setBlockingBedId(null);
    setReason('');
    setError(null);
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="Gestión de Camas"
        icon={<Lock size={18} />}
        size="md"
        variant="white"
        headerIconColor="text-amber-600"
      >
        <div className="space-y-4">
          {/* Section 1: Block Beds */}
          <ModalSection
            title="Bloquear Camas"
            variant="warning"
            description="Seleccione una cama para bloquearla o editar su motivo de bloqueo."
          >
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {BEDS.filter(b => !b.isExtra).map(bed => {
                const isBlocked = record.beds[bed.id]?.isBlocked;
                return (
                  <button
                    key={bed.id}
                    onClick={() => handleBedClick(bed.id, isBlocked)}
                    className={clsx(
                      "p-2 rounded-lg border text-[11px] font-bold transition-all flex flex-col items-center gap-1 shadow-sm active:scale-95 h-14 justify-center",
                      isBlocked
                        ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        : "border-slate-100 bg-white text-slate-500 hover:border-medical-300 hover:bg-slate-50 focus:ring-2 focus:ring-medical-500/20 focus:outline-none"
                    )}
                    disabled={blockingBedId !== null || editingBedId !== null}
                    aria-label={`Gestionar cama ${bed.name}: ${isBlocked ? 'Bloqueada' : 'Disponible'}`}
                  >
                    <span className="leading-none">{bed.name}</span>
                    {isBlocked ? <Lock size={12} className="text-amber-500" aria-hidden="true" /> : <div className="h-2" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </ModalSection>

          {/* Section 2: Extra Beds */}
          <ModalSection
            title="Camas Extras"
            variant="info"
            description="Habilite camas adicionales temporalmente."
          >
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {BEDS.filter(b => b.isExtra).map(bed => {
                const isEnabled = (record.activeExtraBeds || []).includes(bed.id);
                return (
                  <button
                    key={bed.id}
                    onClick={() => toggleExtraBed(bed.id)}
                    className={clsx(
                      "p-2 rounded-lg border text-[11px] font-bold transition-all flex flex-col items-center gap-1 shadow-sm active:scale-95 h-14 justify-center",
                      isEnabled
                        ? "border-medical-500 bg-medical-50 text-medical-700 hover:bg-medical-100"
                        : "border-slate-100 bg-white text-slate-500 hover:border-medical-300 hover:bg-slate-50 focus:ring-2 focus:ring-medical-500/20 focus:outline-none"
                    )}
                    disabled={blockingBedId !== null}
                    aria-label={isEnabled ? `Desactivar cama extra ${bed.name}` : `Activar cama extra ${bed.name}`}
                    aria-pressed={isEnabled}
                  >
                    <span className="leading-none">{bed.name}</span>
                    {isEnabled ? <CheckCircle size={12} className="text-medical-600" aria-hidden="true" /> : <div className="h-2" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </ModalSection>
        </div>
      </BaseModal>

      {/* Sub-dialogs using BaseModal for consistency */}
      <BaseModal
        isOpen={blockingBedId !== null}
        onClose={cancelBlock}
        title={`Bloquear Cama ${blockingBedId}`}
        icon={<Lock size={16} />}
        size="sm"
        variant="white"
        headerIconColor="text-red-600"
      >
        <div className="space-y-6">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block tracking-wider">Motivo del Bloqueo</label>
            <input
              autoFocus
              type="text"
              className={clsx(
                "w-full p-2.5 border rounded-xl focus:ring-2 focus:outline-none text-slate-700 text-sm transition-all shadow-sm",
                error ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-medical-500 focus:border-medical-500"
              )}
              placeholder="Ej: Mantención, Aislamiento..."
              value={reason}
              onChange={e => { setReason(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && confirmBlock()}
            />
            {error && <p className="text-[10px] text-red-500 mt-1.5 font-medium animate-fade-in pl-1">{error}</p>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={cancelBlock}
              className="flex-1 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-100"
            >
              Cancelar
            </button>
            <button
              onClick={confirmBlock}
              className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-red-600/20 active:scale-95"
            >
              Confirmar
            </button>
          </div>
        </div>
      </BaseModal>

      <BaseModal
        isOpen={editingBedId !== null}
        onClose={() => { setEditingBedId(null); setReason(''); }}
        title={`Editar Cama ${editingBedId}`}
        icon={<Lock size={16} />}
        size="sm"
        variant="white"
        headerIconColor="text-amber-600"
      >
        <div className="space-y-6">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block tracking-wider">Motivo del Bloqueo</label>
            <input
              autoFocus
              type="text"
              className={clsx(
                "w-full p-2.5 border rounded-xl focus:ring-2 focus:outline-none text-slate-700 text-sm transition-all shadow-sm",
                error ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-medical-500 focus:border-medical-500"
              )}
              placeholder="Ej: Mantención, Aislamiento..."
              value={reason}
              onChange={e => { setReason(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSaveReason()}
            />
            {error && <p className="text-[10px] text-red-500 mt-1.5 font-medium animate-fade-in pl-1">{error}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                onClick={() => { setEditingBedId(null); setReason(''); }}
                className="flex-1 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveReason}
                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-amber-500/20 active:scale-95"
              >
                Guardar
              </button>
            </div>
            <button
              onClick={handleUnblock}
              className="w-full py-2 text-red-600 hover:bg-red-50 rounded-xl text-sm font-bold transition-colors border border-red-100 mt-2"
            >
              Desbloquear Cama
            </button>
          </div>
        </div>
      </BaseModal>
    </>
  );
};
