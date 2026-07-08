import React from 'react';
import { AlertCircle, ClipboardList } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  executeCreateMedicalIndicationRecord,
  executeGetLatestMedicalIndicationRecord,
} from '@/application/medical-indications/medicalIndicationsUseCases';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  formatMedicalIndicationsDate,
  type MedicalIndicationTemplate,
  type MedicalIndicationsPatientOption,
} from '@/shared/contracts/medicalIndications';
import { MedicalIndicationsLibraryPanel } from './MedicalIndicationsLibraryPanel';
import { MedicalIndicationsListSection } from './MedicalIndicationsListSection';
import { MedicalIndicationsPatientContext } from './MedicalIndicationsPatientContext';
import { MedicalIndicationsClinicalFields } from './MedicalIndicationsClinicalFields';
import { MedicalIndicationsFooter } from './MedicalIndicationsFooter';
import { useMedicalIndicationsEditor } from './useMedicalIndicationsEditor';
import { useMedicalIndicationsLibrary } from './useMedicalIndicationsLibrary';
import { useMedicalIndicationsAppliedRecordLookup } from './medicalIndicationsAppliedRecordLookup';

const loadPrintMedicalIndicationsPdf = async () =>
  import('@/services/pdf/medicalIndicationsPdfService').then(
    module => module.printMedicalIndicationsPdf
  );

interface MedicalIndicationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  patients: MedicalIndicationsPatientOption[];
}

const buildToday = () => {
  const date = new Date();
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

const buildGenerationLabel = (isoDate: string) =>
  new Date(isoDate).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

export const MedicalIndicationsDialog: React.FC<MedicalIndicationsDialogProps> = ({
  isOpen,
  onClose,
  patients,
}) => {
  const editor = useMedicalIndicationsEditor({ isOpen, patients });
  const { hydrateFromRecord, resetAppliedRecordDraft, selectedPatient, targetDate } = editor;
  const appliedRecordLookup = useMedicalIndicationsAppliedRecordLookup(selectedPatient, targetDate);
  const authContext = useAuth();
  const currentUser = authContext.currentUser ?? authContext.user ?? null;
  const currentUserId = currentUser?.uid || '';
  const auditLabel = currentUser?.email || currentUserId;
  const libraryActor = React.useMemo(
    () =>
      currentUserId
        ? {
            userId: currentUserId,
            auditLabel,
          }
        : null,
    [auditLabel, currentUserId]
  );
  const library = useMedicalIndicationsLibrary(libraryActor, isOpen);
  const [usedTemplateIds, setUsedTemplateIds] = React.useState<string[]>([]);
  const [printError, setPrintError] = React.useState('');
  const [saveMessage, setSaveMessage] = React.useState('');
  const [isSavingRecord, setIsSavingRecord] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setUsedTemplateIds([]);
      setPrintError('');
      setSaveMessage('');
      setIsSavingRecord(false);
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen || !appliedRecordLookup) return;

    let isCancelled = false;
    void executeGetLatestMedicalIndicationRecord({
      patient: appliedRecordLookup.patient,
      targetDate: appliedRecordLookup.targetDate,
    })
      .then(record => {
        if (isCancelled) return;
        if (!record) {
          resetAppliedRecordDraft(appliedRecordLookup.patient);
          setUsedTemplateIds([]);
          return;
        }
        hydrateFromRecord(record);
        setUsedTemplateIds(record.generatedFromTemplateIds);
      })
      .catch(error => {
        if (isCancelled) return;
        setPrintError(
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar las indicaciones aplicadas.'
        );
      });

    return () => {
      isCancelled = true;
    };
  }, [appliedRecordLookup, hydrateFromRecord, isOpen, resetAppliedRecordDraft]);

  if (patients.length === 0) {
    return null;
  }

  const persistMedicalIndicationRecord = async () => {
    if (!editor.selectedPatient) return null;
    if (!currentUser || !auditLabel) {
      throw new Error('No se puede guardar el registro clínico sin usuario autenticado.');
    }

    return executeCreateMedicalIndicationRecord({
      patient: editor.selectedPatient,
      targetDate: editor.targetDate,
      generatedAt: new Date().toISOString(),
      generatedByUserId: currentUser.uid,
      generatedByName: currentUser.displayName || currentUser.email || currentUser.uid,
      generatedByRole: authContext?.role,
      generatedByAuditLabel: auditLabel,
      generatedFromTemplateIds: usedTemplateIds,
      content: {
        reposo: editor.reposo,
        regimen: editor.regimen,
        kineType: editor.kineType,
        kineTimes: editor.kineTimes,
        treatingDoctor: editor.treatingDoctor,
        pendingNotes: editor.pendingNotes,
        indications: editor.indications,
      },
    });
  };

  const handleSaveRecord = async () => {
    if (!editor.selectedPatient || isSavingRecord || editor.isPrinting) return;

    setIsSavingRecord(true);
    setPrintError('');
    setSaveMessage('');
    try {
      await persistMedicalIndicationRecord();
      setSaveMessage('Indicaciones guardadas para este paciente.');
    } catch (error) {
      setPrintError(
        error instanceof Error
          ? error.message
          : 'No se pudieron guardar las indicaciones aplicadas.'
      );
    } finally {
      setIsSavingRecord(false);
    }
  };

  const handlePrint = async () => {
    if (!editor.selectedPatient || editor.isPrinting || isSavingRecord) return;

    editor.setIsPrinting(true);
    setPrintError('');
    setSaveMessage('');
    try {
      const record = await persistMedicalIndicationRecord();
      if (!record) return;
      const printMedicalIndicationsPdf = await loadPrintMedicalIndicationsPdf();
      await printMedicalIndicationsPdf({
        paciente_nombre: editor.selectedPatient.patientName,
        paciente_rut: editor.selectedPatient.rut,
        paciente_diagnostico: editor.selectedPatient.diagnosis,
        paciente_edad: editor.selectedPatient.age,
        fecha_nacimiento: formatMedicalIndicationsDate(editor.selectedPatient.birthDate),
        paciente_alergias: editor.selectedPatient.allergies,
        medicotratante: editor.treatingDoctor,
        fecha_ingreso: formatMedicalIndicationsDate(editor.selectedPatient.admissionDate),
        fecha_actual: editor.targetDateLabel || buildToday(),
        fecha_generacion: buildGenerationLabel(record.generatedAt),
        diasEstada: record.daysOfStayForTargetDate,
        Reposoindicacion: editor.reposo,
        Regimenindicacion: editor.regimen,
        Kinemotora: editor.kineType === 'motora' || editor.kineType === 'ambas' ? 'X' : '',
        Kinerespiratoria:
          editor.kineType === 'respiratoria' || editor.kineType === 'ambas' ? 'X' : '',
        Kinecantidadvecesdia: editor.kineTimes,
        Pendientes: editor.pendingNotes,
        indicaciones: editor.indications,
      });
    } catch (error) {
      setPrintError(
        error instanceof Error
          ? error.message
          : 'No se pudo generar el registro clínico de indicaciones.'
      );
    } finally {
      editor.setIsPrinting(false);
    }
  };

  const handleInsertTemplate = async (template: MedicalIndicationTemplate) => {
    if (editor.activeIndications.length >= editor.maxIndications) {
      library.setError('No quedan espacios disponibles para insertar más indicaciones.');
      return;
    }

    try {
      await library.markTemplateUsed(template);
      editor.insertIndication(template.text);
      setUsedTemplateIds(current =>
        current.includes(template.id) ? current : [...current, template.id]
      );
    } catch (error) {
      library.setError(
        error instanceof Error ? error.message : 'No se pudo auditar la reutilización.'
      );
    }
  };

  const remainingSlots = editor.maxIndications - editor.activeIndications.length;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-medical-500 to-medical-700 text-white shadow-md shadow-medical-500/20">
            <ClipboardList size={16} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-slate-800">
              Indicaciones Médicas
            </span>
            {editor.selectedPatient && (
              <span className="text-[11px] font-medium text-slate-400">
                {editor.selectedPatient.patientName}
              </span>
            )}
          </span>
        </span>
      }
      size="3xl"
      variant="white"
      className="max-w-[96vw] !rounded-2xl ring-1 ring-black/[0.03] lg:max-w-[1180px]"
      bodyClassName="max-h-[84vh] overflow-y-auto px-4 py-4 sm:px-5"
      headerActions={
        patients.length > 1 ? (
          <select
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:border-slate-300 focus:border-medical-400 focus:outline-none focus:ring-2 focus:ring-medical-500/10"
            value={editor.selectedPatient?.bedId || editor.selectedBedId}
            onChange={event => editor.setSelectedBedId(event.target.value)}
            aria-label="Seleccionar paciente"
          >
            {patients.map(patient => (
              <option key={patient.bedId} value={patient.bedId}>
                {patient.label}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <MedicalIndicationsPatientContext
            patient={editor.selectedPatient}
            targetDate={editor.targetDate}
            targetDateLabel={editor.targetDateLabel}
            daysOfStayForTargetDate={editor.daysOfStayForTargetDate}
            onTargetDateChange={editor.setTargetDate}
          />

          {(printError || library.error) && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{printError || library.error}</span>
            </div>
          )}
          {saveMessage && (
            <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800">
              {saveMessage}
            </div>
          )}

          <MedicalIndicationsClinicalFields
            reposo={editor.reposo}
            setReposo={editor.setReposo}
            regimen={editor.regimen}
            setRegimen={editor.setRegimen}
            pendingNotes={editor.pendingNotes}
            setPendingNotes={editor.setPendingNotes}
            kineType={editor.kineType}
            setKineType={editor.setKineType}
            kineTimes={editor.kineTimes}
            setKineTimes={editor.setKineTimes}
          />

          {/* Indications list - primary content */}
          <MedicalIndicationsListSection
            remainingSlots={remainingSlots}
            activeIndications={editor.activeIndications}
            maxIndications={editor.maxIndications}
            isOrderingIndications={editor.isOrderingIndications}
            setIsOrderingIndications={editor.setIsOrderingIndications}
            isEditingIndications={editor.isEditingIndications}
            setIsEditingIndications={editor.setIsEditingIndications}
            resetEditing={editor.resetEditing}
            indicationDraft={editor.indicationDraft}
            setIndicationDraft={editor.setIndicationDraft}
            addIndication={editor.addIndication}
            editingIndex={editor.editingIndex}
            editingValue={editor.editingValue}
            setEditingValue={editor.setEditingValue}
            saveEditedIndication={editor.saveEditedIndication}
            startEditing={editor.startEditing}
            removeIndication={editor.removeIndication}
            moveIndication={editor.moveIndication}
          />

          <MedicalIndicationsFooter
            treatingDoctor={editor.treatingDoctor}
            setTreatingDoctor={editor.setTreatingDoctor}
            isSavingRecord={isSavingRecord}
            isPrinting={editor.isPrinting}
            canSave={Boolean(editor.selectedPatient && editor.activeIndications.length > 0)}
            canPrint={Boolean(editor.selectedPatient && editor.activeIndications.length > 0)}
            onClose={onClose}
            onSave={() => void handleSaveRecord()}
            onPrint={() => void handlePrint()}
          />
        </div>

        <MedicalIndicationsLibraryPanel
          templates={library.templates}
          draftText={library.draftText}
          setDraftText={library.setDraftText}
          editingTemplateId={library.editingTemplateId}
          setEditingTemplateId={library.setEditingTemplateId}
          editingText={library.editingText}
          setEditingText={library.setEditingText}
          isLoading={library.isLoading}
          isSaving={library.isSaving}
          disabled={!currentUser}
          onCreateTemplate={() => void library.createTemplate()}
          onUpdateTemplate={(templateId, text) => void library.updateTemplate(templateId, text)}
          onArchiveTemplate={templateId => void library.archiveTemplate(templateId)}
          onInsertTemplate={template => void handleInsertTemplate(template)}
        />
      </div>
    </BaseModal>
  );
};
