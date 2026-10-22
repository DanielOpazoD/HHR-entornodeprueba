import React from 'react';
import { BellRing, ImagePlus } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { Reminder } from '@/types/reminders';
import type { ReminderDraftInput } from '@/domain/reminders/reminderValidation';
import {
  REMINDER_ROLE_OPTIONS,
  REMINDER_SHIFT_OPTIONS,
  REMINDER_TYPE_LABELS,
} from '@/shared/reminders/reminderUiOptions';
import type { ReminderAdminSubmission } from '@/features/reminders/hooks/useReminderAdmin';
import { getTodayISO } from '@/utils/dateCoreUtils';

const buildInitialDraft = (reminder?: Reminder | null): ReminderDraftInput => ({
  title: reminder?.title ?? '',
  message: reminder?.message ?? '',
  imageUrl: reminder?.imageUrl ?? '',
  type: reminder?.type ?? 'info',
  targetRoles: reminder?.targetRoles ?? ['nurse_hospital'],
  targetShifts: reminder?.targetShifts ?? ['day', 'night'],
  startDate: reminder?.startDate ?? getTodayISO(),
  endDate: reminder?.endDate ?? getTodayISO(),
  priority: reminder?.priority ?? 2,
  isActive: reminder?.isActive ?? true,
});

interface ReminderFormModalProps {
  isOpen: boolean;
  reminder?: Reminder | null;
  processing: boolean;
  onClose: () => void;
  onSubmit: (submission: ReminderAdminSubmission) => Promise<boolean>;
}

export const ReminderFormModal: React.FC<ReminderFormModalProps> = ({
  isOpen,
  reminder,
  processing,
  onClose,
  onSubmit,
}) => {
  const [draft, setDraft] = React.useState<ReminderDraftInput>(() => buildInitialDraft(reminder));
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [removeImage, setRemoveImage] = React.useState(false);
  const [previewImageUrl, setPreviewImageUrl] = React.useState<string>('');

  React.useEffect(() => {
    setDraft(buildInitialDraft(reminder));
    setImageFile(null);
    setRemoveImage(false);
    setPreviewImageUrl(reminder?.imageUrl ?? '');
  }, [reminder]);

  const toggleRole = (role: ReminderDraftInput['targetRoles'][number]) => {
    setDraft(previous => ({
      ...previous,
      targetRoles: previous.targetRoles.includes(role)
        ? previous.targetRoles.filter(item => item !== role)
        : [...previous.targetRoles, role],
    }));
  };

  const toggleShift = (shift: ReminderDraftInput['targetShifts'][number]) => {
    setDraft(previous => ({
      ...previous,
      targetShifts: previous.targetShifts.includes(shift)
        ? previous.targetShifts.filter(item => item !== shift)
        : [...previous.targetShifts, shift],
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await onSubmit({ draft, imageFile, removeImage });
    if (saved) {
      setImageFile(null);
      setRemoveImage(false);
    }
  };

  React.useEffect(() => {
    if (!imageFile) {
      setPreviewImageUrl(removeImage ? '' : (draft.imageUrl ?? ''));
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setPreviewImageUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [draft.imageUrl, imageFile, removeImage]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={reminder ? 'Editar aviso' : 'Nuevo aviso'}
      icon={<BellRing size={20} />}
      headerIconColor="text-sky-600"
      size="3xl"
      variant="white"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Título
            </label>
            <input
              required
              value={draft.title}
              onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Mensaje
            </label>
            <textarea
              required
              rows={5}
              value={draft.message}
              onChange={event =>
                setDraft(previous => ({ ...previous, message: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Tipo
            </label>
            <select
              value={draft.type}
              onChange={event =>
                setDraft(previous => ({
                  ...previous,
                  type: event.target.value as ReminderDraftInput['type'],
                }))
              }
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400"
            >
              {Object.entries(REMINDER_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Prioridad
            </label>
            <select
              value={draft.priority}
              onChange={event =>
                setDraft(previous => ({ ...previous, priority: Number(event.target.value) }))
              }
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400"
            >
              <option value={1}>Normal</option>
              <option value={2}>Alta</option>
              <option value={3}>Crítica</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Vigencia desde
            </label>
            <input
              type="date"
              value={draft.startDate}
              onChange={event =>
                setDraft(previous => ({ ...previous, startDate: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400"
            />
          </div>

          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Vigencia hasta
            </label>
            <input
              type="date"
              value={draft.endDate}
              onChange={event =>
                setDraft(previous => ({ ...previous, endDate: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400"
            />
          </div>
        </div>

        <section className="space-y-3 rounded-[1.5rem] border border-slate-100 bg-slate-50/80 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
            Destinatarios por rol
          </p>
          <div className="flex flex-wrap gap-2">
            {REMINDER_ROLE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleRole(option.value)}
                className={`rounded-full border px-3 py-2 text-xs font-black transition ${
                  draft.targetRoles.includes(option.value)
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-[1.5rem] border border-slate-100 bg-slate-50/80 p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
            Turnos
          </p>
          <div className="flex flex-wrap gap-2">
            {REMINDER_SHIFT_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleShift(option.value)}
                className={`rounded-full border px-3 py-2 text-xs font-black transition ${
                  draft.targetShifts.includes(option.value)
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-[1.5rem] border border-slate-100 bg-slate-50/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
              Imagen opcional
            </p>
            {draft.imageUrl && (
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={removeImage}
                  onChange={event => setRemoveImage(event.target.checked)}
                />
                Quitar imagen actual
              </label>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm font-semibold text-slate-600">
            <ImagePlus size={18} />
            <span>{imageFile ? imageFile.name : 'Seleccionar imagen JPG, PNG o WEBP'}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={event => setImageFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {previewImageUrl && (
            <img
              src={previewImageUrl}
              alt="Vista previa del aviso"
              className="h-44 w-full rounded-2xl object-cover"
            />
          )}
        </section>

        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={event =>
              setDraft(previous => ({ ...previous, isActive: event.target.checked }))
            }
          />
          Aviso activo
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-slate-600 transition hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={processing}
            className="rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {processing ? 'Guardando...' : reminder ? 'Guardar cambios' : 'Crear aviso'}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};
