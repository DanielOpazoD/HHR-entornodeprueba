import React, { useState } from 'react';
import { Users, Plus, Trash2, Cloud, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { useSaveNursesMutation } from '../../hooks/useStaffQuery';
import { BaseModal } from '../shared/BaseModal';
import { StaffNameSchema } from '../../schemas/inputSchemas';
import clsx from 'clsx';

interface NurseManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  nursesList: string[];
}

export const NurseManagerModal: React.FC<NurseManagerModalProps> = ({ isOpen, onClose, nursesList }) => {
  const [newNurseName, setNewNurseName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { mutate: saveNurses, isPending: syncing, isError: hasSyncError } = useSaveNursesMutation();

  const handleAdd = () => {
    const trimmed = newNurseName.trim();
    const result = StaffNameSchema.safeParse(trimmed);

    if (!result.success) {
      setValidationError(result.error.issues[0].message);
      return;
    }

    setValidationError(null);
    const updated = [...nursesList, trimmed];
    saveNurses(updated);
    setNewNurseName('');
  };

  const handleRemove = (name: string) => {
    const updated = nursesList.filter(n => n !== name);
    saveNurses(updated);
  };

  const handleStartEdit = (name: string) => {
    setEditingName(name);
    setEditValue(name);
    setValidationError(null);
  };

  const handleUpdate = () => {
    if (!editingName) return;
    const trimmed = editValue.trim();

    const result = StaffNameSchema.safeParse(trimmed);
    if (!result.success) {
      setValidationError(result.error.issues[0].message);
      return;
    }

    setValidationError(null);
    const updated = nursesList.map(n => (n === editingName ? trimmed : n));
    saveNurses(updated);
    setEditingName(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingName(null);
    setEditValue('');
    setValidationError(null);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Gestión de Enfermeros/as"
      icon={<Users size={18} />}
      size="md"
      variant="white"
      headerIconColor="text-medical-600"
    >
      <div className="space-y-6">
        <div>
          <div className="flex justify-between items-center mb-3">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Agregar Personal</label>
            {syncing && (
              <div className="flex items-center gap-1 text-[10px] text-medical-600 font-bold animate-pulse">
                <Cloud size={12} />
                SINCRONIZANDO...
              </div>
            )}
          </div>

          {hasSyncError && (
            <div className="mb-3 p-3 bg-amber-50 text-amber-700 text-xs rounded-xl border border-amber-100 flex items-center gap-2">
              <AlertCircle size={14} />
              Error al sincronizar con la nube. Se guardó localmente.
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                className={clsx(
                  "flex-1 p-2.5 border rounded-xl focus:ring-2 focus:outline-none text-sm transition-all shadow-sm",
                  validationError && !editingName ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-medical-500"
                )}
                placeholder="Nombre completo..."
                value={newNurseName}
                onChange={(e) => { setNewNurseName(e.target.value); setValidationError(null); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
              <button
                onClick={handleAdd}
                className="bg-medical-600 hover:bg-medical-700 text-white p-2.5 rounded-xl transition-all shadow-lg shadow-medical-600/20 active:scale-95 flex items-center justify-center shrink-0"
                disabled={syncing}
              >
                <Plus size={20} />
              </button>
            </div>
            {validationError && !editingName && (
              <p className="text-[10px] text-red-500 font-medium animate-fade-in pl-1">{validationError}</p>
            )}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase mb-3 block tracking-wider">Catálogo Actual</label>
          <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {nursesList.map(nurse => (
              <div key={nurse} className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-100 gap-3 group transition-all hover:bg-white hover:border-medical-200 hover:shadow-sm">
                {editingName === nurse ? (
                  <>
                    <div className="flex-1 space-y-1">
                      <input
                        className={clsx(
                          "w-full p-2 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all shadow-sm",
                          validationError && editingName === nurse ? "border-red-300 focus:ring-red-100" : "border-slate-200 focus:ring-medical-500"
                        )}
                        value={editValue}
                        onChange={(e) => { setEditValue(e.target.value); setValidationError(null); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdate();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        disabled={syncing}
                        autoFocus
                      />
                      {validationError && editingName === nurse && (
                        <p className="text-[10px] text-red-500 font-medium animate-fade-in pl-1">{validationError}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={handleUpdate}
                        className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-60 shadow-md shadow-emerald-500/10"
                        disabled={syncing}
                        title="Guardar"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-1.5 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors"
                        disabled={syncing}
                        title="Cancelar"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-slate-700 flex-1 pl-1">{nurse}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleStartEdit(nurse)}
                        className="p-1.5 text-slate-400 hover:text-medical-600 hover:bg-medical-50 rounded-lg transition-all"
                        disabled={syncing}
                        title="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleRemove(nurse)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        disabled={syncing}
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}

            {nursesList.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-10 italic bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                No hay enfermeros registrados
              </div>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex items-center gap-1.5">
            <Cloud size={12} className="text-medical-400" />
            Sincronizado con Firebase
          </div>
          <div className="text-slate-300">
            {nursesList.length} Registros
          </div>
        </div>
      </div>
    </BaseModal>
  );
};