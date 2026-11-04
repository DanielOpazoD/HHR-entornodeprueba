import React from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import { MailWarning } from 'lucide-react';
import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import { useFugaNotificationModalModel } from '@/features/census/hooks/useFugaNotificationModalModel';

interface FugaNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  dischargeItem: DischargeData;
  recordDate: string;
}

export const FugaNotificationModal: React.FC<FugaNotificationModalProps> = ({
  isOpen,
  onClose,
  dischargeItem,
  recordDate,
}) => {
  const {
    isAdminUser,
    specialty,
    manualRecipients,
    testMode,
    testRecipient,
    note,
    automaticMessage,
    isSending,
    error,
    isPsychiatry,
    setManualRecipients,
    setTestMode,
    setTestRecipient,
    setNote,
    setAutomaticMessage,
    handleSend,
  } = useFugaNotificationModalModel({
    isOpen,
    onClose,
    dischargeItem,
    recordDate,
  });

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Notificar fuga"
      icon={<MailWarning size={18} />}
      size="lg"
      variant="white"
      bodyClassName="p-4 space-y-4"
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p className="text-xs text-slate-600">
          Revisa y edita el mensaje automático del reporte antes de enviar. La nota complementaria
          es opcional y se agrega al final del correo.
        </p>

        {isAdminUser && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs space-y-2">
            <label className="inline-flex items-center gap-2 text-blue-900 font-semibold">
              <input
                type="checkbox"
                checked={testMode}
                onChange={event => setTestMode(event.target.checked)}
              />
              Modo prueba (admin)
            </label>
            {testMode && (
              <>
                <label className="block">
                  <span className="text-xs font-semibold text-blue-900">Correo de prueba</span>
                  <input
                    type="email"
                    value={testRecipient}
                    onChange={event => setTestRecipient(event.target.value)}
                    placeholder="correo.prueba@hospital.cl"
                    className="mt-1 w-full rounded-lg border border-blue-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-semibold text-amber-800">
                  Estás enviando en modo prueba
                </p>
              </>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
          <p>
            <span className="font-semibold">Paciente:</span> {dischargeItem.patientName}
          </p>
          <p>
            <span className="font-semibold">RUT:</span> {dischargeItem.rut}
          </p>
          <p>
            <span className="font-semibold">Hora fuga:</span> {dischargeItem.time}
          </p>
          <p>
            <span className="font-semibold">Especialidad:</span>{' '}
            {String(specialty || 'No definida')}
          </p>
        </div>

        {isPsychiatry && !(isAdminUser && testMode) ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
            <p className="font-semibold text-emerald-700">Destinatarios automáticos Psiquiatría</p>
            <p className="mt-1 text-emerald-800">
              El envío usará la lista automática configurada para Psiquiatría en el backend.
            </p>
          </div>
        ) : !(isAdminUser && testMode) ? (
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Correos destinatarios</span>
            <textarea
              value={manualRecipients}
              onChange={event => setManualRecipients(event.target.value)}
              placeholder="ejemplo1@hospital.cl; ejemplo2@hospital.cl"
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
        ) : null}

        <label className="block">
          <span className="text-xs font-semibold text-slate-700">
            Mensaje automático (editable)
          </span>
          <textarea
            value={automaticMessage}
            onChange={event => setAutomaticMessage(event.target.value)}
            rows={8}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-700">
            Nota complementaria (opcional)
          </span>
          <textarea
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="Agregar antecedentes clínicos o contextuales…"
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSending}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending}
            className="px-3 py-1.5 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {isSending ? 'Enviando…' : 'Enviar notificación'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
