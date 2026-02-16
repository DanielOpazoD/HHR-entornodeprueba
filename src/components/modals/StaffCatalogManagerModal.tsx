import React, { useState } from 'react';
import { Users, Plus, Trash2, Cloud, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { StaffNameSchema } from '@/schemas/inputSchemas';
import clsx from 'clsx';

type StaffCatalogVariant = 'nurse' | 'tens';

interface StaffCatalogManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: string[];
  onSave: (updatedStaffList: string[]) => void;
  syncing: boolean;
  hasSyncError: boolean;
  variant: StaffCatalogVariant;
}

interface StaffCatalogVariantConfig {
  title: string;
  headerIconColor: string;
  syncingTextColor: string;
  inputFocusClass: string;
  addButtonClass: string;
  addButtonShadowClass: string;
  rowHoverBorderClass: string;
  editButtonClass: string;
  cloudIconColor: string;
  emptyMessage: string;
}

const STAFF_CATALOG_VARIANT_CONFIG: Record<StaffCatalogVariant, StaffCatalogVariantConfig> = {
  nurse: {
    title: 'Gestión de Enfermeros/as',
    headerIconColor: 'text-medical-600',
    syncingTextColor: 'text-medical-600',
    inputFocusClass: 'border-slate-200 focus:ring-medical-500',
    addButtonClass: 'bg-medical-600 hover:bg-medical-700',
    addButtonShadowClass: 'shadow-medical-600/20',
    rowHoverBorderClass: 'hover:border-medical-200',
    editButtonClass: 'hover:text-medical-600 hover:bg-medical-50',
    cloudIconColor: 'text-medical-400',
    emptyMessage: 'No hay enfermeros registrados',
  },
  tens: {
    title: 'Gestión de TENS',
    headerIconColor: 'text-teal-600',
    syncingTextColor: 'text-teal-600',
    inputFocusClass: 'border-slate-200 focus:ring-teal-500',
    addButtonClass: 'bg-teal-600 hover:bg-teal-700',
    addButtonShadowClass: 'shadow-teal-600/20',
    rowHoverBorderClass: 'hover:border-teal-200',
    editButtonClass: 'hover:text-teal-600 hover:bg-teal-50',
    cloudIconColor: 'text-teal-400',
    emptyMessage: 'No hay personal TENS registrado',
  },
};

export const StaffCatalogManagerModal: React.FC<StaffCatalogManagerModalProps> = ({
  isOpen,
  onClose,
  staffList,
  onSave,
  syncing,
  hasSyncError,
  variant,
}) => {
  const config = STAFF_CATALOG_VARIANT_CONFIG[variant];
  const [newStaffName, setNewStaffName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = newStaffName.trim();
    const result = StaffNameSchema.safeParse(trimmed);

    if (!result.success) {
      setValidationError(result.error.issues[0].message);
      return;
    }

    setValidationError(null);
    onSave([...staffList, trimmed]);
    setNewStaffName('');
  };

  const handleRemove = (name: string) => {
    onSave(staffList.filter(staffName => staffName !== name));
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
    onSave(staffList.map(staffName => (staffName === editingName ? trimmed : staffName)));
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
      title={config.title}
      icon={<Users size={18} />}
      size="md"
      variant="white"
      headerIconColor={config.headerIconColor}
    >
      <div className="space-y-6">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Agregar Personal
            </label>
            {syncing && (
              <div
                className={clsx(
                  'flex items-center gap-1 text-[10px] font-bold animate-pulse',
                  config.syncingTextColor
                )}
              >
                <Cloud size={12} />
                SINCRONIZANDO...
              </div>
            )}
          </div>

          {hasSyncError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
              <AlertCircle size={14} />
              Error al sincronizar con la nube. Se guardó localmente.
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                className={clsx(
                  'flex-1 rounded-xl border p-2.5 text-sm shadow-sm transition-all focus:outline-none focus:ring-2',
                  validationError && !editingName
                    ? 'border-red-300 focus:ring-red-100'
                    : config.inputFocusClass
                )}
                placeholder="Nombre completo..."
                value={newStaffName}
                onChange={event => {
                  setNewStaffName(event.target.value);
                  setValidationError(null);
                }}
                onKeyDown={event => event.key === 'Enter' && handleAdd()}
              />
              <button
                onClick={handleAdd}
                className={clsx(
                  'flex shrink-0 items-center justify-center rounded-xl p-2.5 text-white shadow-lg transition-all active:scale-95',
                  config.addButtonClass,
                  config.addButtonShadowClass
                )}
                disabled={syncing}
              >
                <Plus size={20} />
              </button>
            </div>
            {validationError && !editingName && (
              <p className="animate-fade-in pl-1 text-[10px] font-medium text-red-500">
                {validationError}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="mb-3 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Catálogo Actual
          </label>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {staffList.map(staffName => (
              <div
                key={staffName}
                className={clsx(
                  'group flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-2.5 transition-all hover:bg-white hover:shadow-sm',
                  config.rowHoverBorderClass
                )}
              >
                {editingName === staffName ? (
                  <>
                    <div className="flex-1 space-y-1">
                      <input
                        className={clsx(
                          'w-full rounded-xl border p-2 text-sm shadow-sm transition-all focus:outline-none focus:ring-2',
                          validationError
                            ? 'border-red-300 focus:ring-red-100'
                            : config.inputFocusClass
                        )}
                        value={editValue}
                        onChange={event => {
                          setEditValue(event.target.value);
                          setValidationError(null);
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter') handleUpdate();
                          if (event.key === 'Escape') handleCancelEdit();
                        }}
                        disabled={syncing}
                        autoFocus
                      />
                      {validationError && (
                        <p className="animate-fade-in pl-1 text-[10px] font-medium text-red-500">
                          {validationError}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={handleUpdate}
                        className="rounded-lg bg-emerald-600 p-1.5 text-white shadow-md shadow-emerald-500/10 transition-colors hover:bg-emerald-700 disabled:opacity-60"
                        disabled={syncing}
                        title="Guardar"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="rounded-lg bg-slate-200 p-1.5 text-slate-700 transition-colors hover:bg-slate-300"
                        disabled={syncing}
                        title="Cancelar"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex-1 pl-1 text-sm font-medium text-slate-700">
                      {staffName}
                    </span>
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => handleStartEdit(staffName)}
                        className={clsx(
                          'rounded-lg p-1.5 text-slate-400 transition-all',
                          config.editButtonClass
                        )}
                        disabled={syncing}
                        title="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleRemove(staffName)}
                        className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-red-50 hover:text-red-500"
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

            {staffList.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm italic text-slate-400">
                {config.emptyMessage}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[9px] font-bold uppercase tracking-widest text-slate-400">
          <div className="flex items-center gap-1.5">
            <Cloud size={12} className={config.cloudIconColor} />
            Sincronizado con Firebase
          </div>
          <div className="text-slate-300">{staffList.length} Registros</div>
        </div>
      </div>
    </BaseModal>
  );
};
