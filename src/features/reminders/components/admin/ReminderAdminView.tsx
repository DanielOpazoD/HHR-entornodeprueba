import React from 'react';
import { BellRing, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ReminderCard } from '@/components/reminders/ReminderCard';
import { ReminderFormModal } from '@/features/reminders/components/admin/ReminderFormModal';
import { ReminderReadStatusTable } from '@/features/reminders/components/admin/ReminderReadStatusTable';
import { useReminderAdmin } from '@/features/reminders/hooks/useReminderAdmin';
import { mayBeAdminRole } from '@/shared/access/operationalAccessPolicy';

export const ReminderAdminView: React.FC = () => {
  const { role } = useAuth();
  const {
    reminders,
    loading,
    loadError,
    processing,
    isFormOpen,
    formReminder,
    openCreateForm,
    openEditForm,
    closeForm,
    saveReminder,
    deleteReminder,
    receiptsReminder,
    readReceipts,
    receiptsLoading,
    receiptsError,
    openReadStatus,
    retryReadStatus,
    closeReadStatus,
  } = useReminderAdmin();

  if (!mayBeAdminRole(role)) {
    return (
      <div className="mx-auto max-w-2xl rounded-[2rem] border border-rose-100 bg-white p-10 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600">
          <BellRing size={24} />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Acceso restringido</h1>
        <p className="mt-3 text-sm font-medium text-slate-500">
          Solo jefatura o administración puede gestionar avisos al personal.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1220px] animate-in fade-in px-4 py-4 duration-700 md:px-6 md:py-6">
      <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <div className="rounded-2xl bg-sky-600 p-2 text-white shadow-lg shadow-sky-100">
              <BellRing size={20} />
            </div>
            <h1 className="font-display text-2xl font-black tracking-tight text-slate-900 md:text-[2rem]">
              Avisos al Personal
            </h1>
          </div>
          <p className="max-w-2xl text-sm font-medium leading-snug text-slate-500 md:text-[15px]">
            Jefatura puede publicar recordatorios segmentados por rol, turno y vigencia, con
            confirmación de lectura por usuario.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-black"
          >
            <Plus size={14} />
            Nuevo aviso
          </button>
        </div>
      </header>

      {loadError && (
        <div
          role="alert"
          className="mb-5 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800"
        >
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="rounded-[1.75rem] border border-slate-100 bg-white p-10 text-center text-sm font-semibold text-slate-500">
          Cargando avisos...
        </div>
      ) : reminders.length === 0 ? (
        loadError ? null : (
          <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm font-semibold text-slate-500">
            No hay avisos creados. Usa &quot;Nuevo aviso&quot; para publicar el primero.
          </div>
        )
      ) : (
        <div className="space-y-4">
          {reminders.map(reminder => (
            <div key={reminder.id} className="space-y-3">
              <ReminderCard reminder={reminder} />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void openReadStatus(reminder)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-slate-600 transition hover:bg-slate-50"
                >
                  <Eye size={14} />
                  Lecturas
                </button>
                <button
                  type="button"
                  onClick={() => openEditForm(reminder)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-slate-600 transition hover:bg-slate-50"
                >
                  <Pencil size={14} />
                  Editar
                </button>
                <button
                  type="button"
                  disabled={processing}
                  onClick={() => void deleteReminder(reminder)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
                >
                  <Trash2 size={14} />
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ReminderFormModal
        isOpen={isFormOpen}
        reminder={formReminder}
        processing={processing}
        onClose={closeForm}
        onSubmit={saveReminder}
      />

      <ReminderReadStatusTable
        reminder={receiptsReminder}
        receipts={readReceipts}
        loading={receiptsLoading}
        error={receiptsError}
        onRetry={retryReadStatus}
        onClose={closeReadStatus}
      />
    </div>
  );
};

export default ReminderAdminView;
