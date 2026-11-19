import React, { useRef, useState } from 'react';
import { Users, Plus, Trash2, Cloud, AlertCircle, Pencil, Check, X } from 'lucide-react';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
import { BaseModal } from '@/components/shared/BaseModal';
import { StaffNameSchema } from '@/schemas/inputSchemas';
import {
  savedCatalogEdit,
  type SavedStaffCatalog,
} from '@/services/repositories/contracts/catalogChanges';
import clsx from 'clsx';
import { RecoverCensusStaffButton } from './RecoverCensusStaffButton';

type StaffCatalogVariant = 'nurse' | 'tens';

interface StaffCatalogManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  staffList: string[];
  /** The confirmed saved list behind `staffList`, from the same source as the shown rows. */
  saved?: SavedStaffCatalog;
  onSave: (updatedStaffList: string[], base?: string[]) => boolean | void | Promise<boolean | void>;
  saveError?: string;
  onRetry?: () => Promise<void>;
  syncing: boolean;
  hasSyncError: boolean;
  variant: StaffCatalogVariant;
}

interface StaffCatalogVariantConfig {
  title: string;
  headerIconColor: string;
  syncingTextColor: string;
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
    rowHoverBorderClass: 'hover:border-medical-200',
    editButtonClass: 'hover:text-medical-600 hover:bg-medical-50',
    cloudIconColor: 'text-medical-400',
    emptyMessage: 'No hay enfermeros registrados',
  },
  tens: {
    title: 'Gestión de TENS',
    headerIconColor: 'text-teal-600',
    syncingTextColor: 'text-teal-600',
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
  saved,
  onSave,
  syncing,
  hasSyncError,
  variant,
  saveError,
  onRetry,
}) => {
  const editBase = useRef({ shown: staffList, saved });
  // Removing or renaming a row changes exactly the saved texts that row stands for.
  const saveChange = (next: string[], base = { shown: staffList, saved }) => {
    const edit = savedCatalogEdit(base.saved, base.shown, next);
    return onSave(edit.next, edit.base);
  };
  const config = STAFF_CATALOG_VARIANT_CONFIG[variant];
  const [newStaffName, setNewStaffName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (syncing) return;
    const trimmed = newStaffName.trim();
    const result = StaffNameSchema.safeParse(trimmed);

    if (!result.success) {
      setValidationError(result.error.issues[0].message);
      return;
    }

    setValidationError(null);
    if ((await saveChange([...staffList, trimmed])) === false) return;
    setNewStaffName('');
  };

  const handleRemove = (name: string) => {
    saveChange(staffList.filter(staffName => staffName !== name));
  };

  const handleStartEdit = (name: string) => {
    editBase.current = { shown: staffList, saved };
    setEditingName(name);
    setEditValue(name);
    setValidationError(null);
  };

  const handleUpdate = async () => {
    if (!editingName || syncing) return;

    const trimmed = editValue.trim();
    const result = StaffNameSchema.safeParse(trimmed);
    if (!result.success) {
      setValidationError(result.error.issues[0].message);
      return;
    }

    setValidationError(null);
    if (
      (await saveChange(
        editBase.current.shown.map(staffName => (staffName === editingName ? trimmed : staffName)),
        editBase.current
      )) === false
    )
      return;
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
        <RecoverCensusStaffButton />
        <div>
          <div className="mb-3 flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-600">Agregar Personal</label>
            {syncing && (
              <div
                className={clsx(
                  'flex items-center gap-1 text-xs font-medium animate-pulse',
                  config.syncingTextColor
                )}
              >
                <Cloud size={12} />
                Sincronizando…
              </div>
            )}
          </div>

          {saveError && (
            <div
              role="alert"
              className="mb-3 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700"
            >
              <p className="flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0" />
                {saveError}
              </p>
              {onRetry && (
                <button
                  type="button"
                  className={buttonClassName('outline', 'sm', 'mt-2')}
                  onClick={() => void onRetry()}
                  disabled={syncing}
                >
                  Reintentar
                </button>
              )}
            </div>
          )}
          {hasSyncError && (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
              <AlertCircle size={14} />
              El cambio no se guardó. Lo escrito se conserva; vuelva a guardar cuando haya conexión.
            </div>
          )}

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                className={clsx(
                  'hhr-field flex-1',
                  validationError && !editingName && 'border-slate-500 border-dashed'
                )}
                aria-invalid={Boolean(validationError && !editingName)}
                placeholder="Nombre completo…"
                value={newStaffName}
                disabled={syncing}
                onChange={event => {
                  setNewStaffName(event.target.value);
                  setValidationError(null);
                }}
                onKeyDown={event => event.key === 'Enter' && handleAdd()}
              />
              <button
                aria-label="Agregar personal"
                onClick={handleAdd}
                className={buttonClassName('primary', 'icon', 'shrink-0')}
                disabled={syncing}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </div>
            {validationError && !editingName && (
              <p className="animate-fade-in pl-1 text-xs font-medium text-slate-700">
                {validationError}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="mb-3 block text-xs font-semibold text-slate-600">Catálogo Actual</label>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {editingName && !staffList.includes(editingName) && (
              <div>
                <input
                  className="hhr-field"
                  aria-label="Edición pendiente"
                  value={editValue}
                  onChange={event => setEditValue(event.target.value)}
                />
                <button
                  className={buttonClassName('secondary', 'sm', 'mt-2')}
                  onClick={handleCancelEdit}
                >
                  Cerrar edición pendiente
                </button>
              </div>
            )}
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
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        className={clsx(
                          'hhr-field',
                          validationError && 'border-slate-500 border-dashed'
                        )}
                        aria-invalid={Boolean(validationError)}
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
                        <p className="animate-fade-in pl-1 text-xs font-medium text-slate-700">
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

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">
          <div className="flex items-center gap-1.5">
            <Cloud size={12} className={config.cloudIconColor} />
            Catálogo compartido de HHR
          </div>
          <div className="text-slate-300">{staffList.length} Registros</div>
        </div>
      </div>
    </BaseModal>
  );
};
