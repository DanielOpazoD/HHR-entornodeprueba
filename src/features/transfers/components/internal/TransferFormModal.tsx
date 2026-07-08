import React, { useEffect, useState } from 'react';
import { CalendarDays, FilePlus, User } from 'lucide-react';
import type { TransferRequest, TransferFormData } from '@/types/transferRequestTypes';
import {
  DESTINATION_HOSPITALS,
  MEDICAL_SPECIALTIES,
  TRANSFER_BED_REQUIREMENTS,
  type DestinationHospitalOption,
} from '@/constants/transferConstants';
import { PatientSelector } from './PatientSelector';
import { BaseModal } from '@/components/shared/BaseModal';
import { ModalSection } from '@/components/shared/baseModalSection';
import { useNotification } from '@/context/UIContext';
import { getDestinationHospitalCatalog } from '@/features/transfers/services/destinationHospitalCatalogService';
import { getLocalDateInputValue } from '@/utils/localDate';
import {
  TRANSFER_FORM_FIELD_BASE_CLASSNAME,
  TRANSFER_FORM_FIELD_CLASSNAME,
  TRANSFER_FORM_FIELD_NESTED_CLASSNAME,
  buildTransferPatientSummaryClassName,
} from '../transferFormStyles';
import {
  buildTransferFormSubmission,
  resolveTransferFormState,
  type TransferFormPatientOption,
} from '../controllers/transferFormController';
import { createScopedLogger } from '@/services/utils/loggerScope';

interface TransferFormModalProps {
  transfer: TransferRequest | null;
  patients: TransferFormPatientOption[];
  onClose: () => void;
  onSave: (data: TransferFormData) => Promise<void>;
}

const transferFormModalLogger = createScopedLogger('TransferFormModal');

export const TransferFormModal: React.FC<TransferFormModalProps> = ({
  transfer,
  patients,
  onClose,
  onSave,
}) => {
  const isEditing = transfer !== null;
  const defaultRequestDate = getLocalDateInputValue();
  const { notify } = useNotification();

  // Form state
  const [selectedPatientId, setSelectedPatientId] = useState(transfer?.bedId || '');
  const [destinationHospital, setDestinationHospital] = useState('');
  const [destinationHospitalOther, setDestinationHospitalOther] = useState('');
  const [destinationHospitals, setDestinationHospitals] = useState<DestinationHospitalOption[]>([
    ...DESTINATION_HOSPITALS,
  ]);
  const [requiredSpecialty, setRequiredSpecialty] = useState(transfer?.requiredSpecialty || '');
  const [requiredSpecialtyOther, setRequiredSpecialtyOther] = useState('');
  const [requiredBedType, setRequiredBedType] = useState('');
  const [requiredBedTypeOther, setRequiredBedTypeOther] = useState('');
  const [requestDate, setRequestDate] = useState(transfer?.requestDate || defaultRequestDate);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    void getDestinationHospitalCatalog()
      .then(catalog => {
        if (mounted) {
          setDestinationHospitals(catalog);
        }
      })
      .catch(error => {
        transferFormModalLogger.warn('Failed to load destination hospitals catalog', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const nextState = resolveTransferFormState({
      transfer,
      destinationHospitals,
      defaultRequestDate,
    });
    setSelectedPatientId(nextState.selectedPatientId);
    setRequestDate(nextState.requestDate);
    setDestinationHospital(nextState.destinationHospital);
    setDestinationHospitalOther(nextState.destinationHospitalOther);
    setRequiredSpecialty(nextState.requiredSpecialty);
    setRequiredSpecialtyOther(nextState.requiredSpecialtyOther);
    setRequiredBedType(nextState.requiredBedType);
    setRequiredBedTypeOther(nextState.requiredBedTypeOther);
  }, [defaultRequestDate, destinationHospitals, transfer]);

  // Find selected patient
  const selectedPatient = patients.find(p => p.id === selectedPatientId);
  const selectedPatientSummaryStyles = buildTransferPatientSummaryClassName('selected');
  const existingPatientSummaryStyles = buildTransferPatientSummaryClassName('existing');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const submission = buildTransferFormSubmission({
      selectedPatientId,
      requestDate,
      destinationHospital,
      destinationHospitalOther,
      requiredSpecialty,
      requiredSpecialtyOther,
      requiredBedType,
      requiredBedTypeOther,
    });

    if (!submission.ok) {
      notify({
        type: 'warning',
        title: 'Solicitud incompleta',
        message: submission.error,
      });
      return;
    }

    setIsSaving(true);
    try {
      await onSave(submission.data);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      title={isEditing ? 'Editar Traslado' : 'Nueva Solicitud de Traslado'}
      icon={<FilePlus size={18} />}
      size="md"
      variant="white"
      headerIconColor="text-indigo-600"
      scrollableBody={false}
      bodyClassName="p-5 space-y-4"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Patient Section */}
        <ModalSection
          title="Información del Paciente"
          icon={<User size={16} />}
          variant="info"
          className="p-3"
        >
          {!isEditing ? (
            <div className="space-y-2.5">
              <PatientSelector
                patients={patients}
                selectedPatientId={selectedPatientId}
                onChange={setSelectedPatientId}
                disabled={isSaving}
              />
              {selectedPatient && (
                <div className={selectedPatientSummaryStyles.card}>
                  <p className={selectedPatientSummaryStyles.title}>Paciente Seleccionado</p>
                  <p className="text-sm font-medium text-slate-800">{selectedPatient.name}</p>
                  <p className={selectedPatientSummaryStyles.body}>
                    Cama {selectedPatient.bedId.replace('BED_', '')} • {selectedPatient.diagnosis}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className={existingPatientSummaryStyles.card}>
              <p className={existingPatientSummaryStyles.title}>Paciente Hospitalizado</p>
              <p className="text-sm font-medium text-slate-800">{transfer.patientSnapshot.name}</p>
              <p className={existingPatientSummaryStyles.body}>
                {transfer.patientSnapshot.rut} • Cama {transfer.bedId.replace('BED_', '')}
              </p>
            </div>
          )}
        </ModalSection>

        {/* Destination Section */}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Fecha de Solicitud
            </label>
            <div className="relative">
              <CalendarDays
                size={15}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="date"
                className={`w-full pl-11 ${TRANSFER_FORM_FIELD_BASE_CLASSNAME}`}
                value={requestDate}
                onChange={e => setRequestDate(e.target.value)}
                disabled={isSaving}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Hospital Destino *
            </label>
            <select
              className={TRANSFER_FORM_FIELD_CLASSNAME}
              value={destinationHospital}
              onChange={e => setDestinationHospital(e.target.value)}
              disabled={isSaving}
              required
            >
              <option value="">Seleccionar hospital...</option>
              {destinationHospitals.map(h => (
                <option key={h.id} value={h.name}>
                  {h.name}
                </option>
              ))}
            </select>
            {destinationHospital === 'Otro' && (
              <input
                className={TRANSFER_FORM_FIELD_NESTED_CLASSNAME}
                value={destinationHospitalOther}
                onChange={e => setDestinationHospitalOther(e.target.value)}
                placeholder="Detallar hospital de destino"
                disabled={isSaving}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Especialidad Requerida
            </label>
            <select
              className={TRANSFER_FORM_FIELD_CLASSNAME}
              value={requiredSpecialty}
              onChange={e => setRequiredSpecialty(e.target.value)}
              disabled={isSaving}
            >
              <option value="">Seleccionar especialidad</option>
              {MEDICAL_SPECIALTIES.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {requiredSpecialty === 'Otra' && (
              <input
                className={TRANSFER_FORM_FIELD_NESTED_CLASSNAME}
                value={requiredSpecialtyOther}
                onChange={e => setRequiredSpecialtyOther(e.target.value)}
                placeholder="Detallar especialidad"
                disabled={isSaving}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
              Cama Requerida
            </label>
            <select
              className={TRANSFER_FORM_FIELD_CLASSNAME}
              value={requiredBedType}
              onChange={e => setRequiredBedType(e.target.value)}
              disabled={isSaving}
            >
              <option value="">-</option>
              {TRANSFER_BED_REQUIREMENTS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {requiredBedType === 'Otra' && (
              <input
                className={TRANSFER_FORM_FIELD_NESTED_CLASSNAME}
                value={requiredBedTypeOther}
                onChange={e => setRequiredBedTypeOther(e.target.value)}
                placeholder="Detallar cama requerida"
                disabled={isSaving}
              />
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 text-slate-500 hover:text-slate-800 font-bold text-xs uppercase tracking-widest transition-all"
            disabled={isSaving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="px-8 py-2.5 bg-indigo-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center gap-2"
            disabled={
              isSaving ||
              (!isEditing && !selectedPatientId) ||
              !destinationHospital ||
              (destinationHospital === 'Otro' && !destinationHospitalOther.trim()) ||
              (requiredSpecialty === 'Otra' && !requiredSpecialtyOther.trim()) ||
              (requiredBedType === 'Otra' && !requiredBedTypeOther.trim())
            }
          >
            {isSaving ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Solicitud'}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};
