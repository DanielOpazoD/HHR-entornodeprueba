import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DemographicsModal } from '@/components/modals/DemographicsModal';
import { useDemographicsLogic } from '@/components/modals/demographics/useDemographicsLogic';
import { buildUpdatePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
import { PATIENT_IDENTITY_FIELDS } from '@/types/domain/patientIdentity';
import type { PatientData } from '@/types/domain/patient';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logPatientView: vi.fn() }),
}));

const renderModal = (documentType: string) => {
  const onSave = vi.fn();
  render(
    <DemographicsModal
      isOpen
      onClose={vi.fn()}
      data={docToRecord(storedDay({ documentType }), DATE).beds.R1}
      onSave={onSave}
      bedId="R1"
      recordDate={DATE}
    />
  );
  return onSave;
};

const save = () => fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

const identityFieldsIn = (fields: Partial<PatientData>) =>
  PATIENT_IDENTITY_FIELDS.filter(field => field in fields);

describe('demographics of a patient whose stored document type could not be read', () => {
  it('saves an edit of another field without writing any identity field', () => {
    const onSave = renderModal('Cedula');

    expect(screen.getByDisplayValue('Por revisar')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Pertenencia Rapanui/));
    save();

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ isRapanui: true });
    expect(identityFieldsIn(onSave.mock.calls[0][0])).toEqual([]);
  });

  it('asks for RUT or passport before it writes an edited document number', () => {
    const onSave = renderModal('Cedula');

    fireEvent.change(screen.getByDisplayValue('FAKE-PASSPORT-R1'), {
      target: { value: 'FAKE-PASSPORT-R1B' },
    });
    save();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Elige RUT o pasaporte/)).toBeInTheDocument();
  });

  it('writes an edited document number with the document type the nurse chose', () => {
    const onSave = renderModal('Cedula');

    fireEvent.change(screen.getByDisplayValue('Por revisar'), { target: { value: 'Pasaporte' } });
    fireEvent.change(screen.getByDisplayValue('FAKE-PASSPORT-R1'), {
      target: { value: 'FAKE-PASSPORT-R1B' },
    });
    save();

    expect(onSave.mock.calls[0][0]).toMatchObject({
      documentType: 'Pasaporte',
      rut: 'FAKE-PASSPORT-R1B',
    });
    expect(identityFieldsIn(onSave.mock.calls[0][0])).toEqual(['documentType', 'rut']);
  });

  it('writes only the document type the nurse chose', () => {
    const onSave = renderModal('Cedula');

    fireEvent.change(screen.getByDisplayValue('Por revisar'), { target: { value: 'Pasaporte' } });
    save();

    expect(onSave.mock.calls[0][0]).toMatchObject({ documentType: 'Pasaporte' });
    expect(identityFieldsIn(onSave.mock.calls[0][0])).toEqual(['documentType']);
  });

  it('writes the full name whole when the nurse edits one of its parts', () => {
    const onSave = renderModal('Cedula');

    fireEvent.change(screen.getByDisplayValue('PACIENTE'), { target: { value: 'PACIENTA' } });
    save();

    expect(onSave.mock.calls[0][0]).toMatchObject({
      patientName: 'PACIENTA SINTETICO R1',
      firstName: 'PACIENTA',
    });
    expect(identityFieldsIn(onSave.mock.calls[0][0])).toEqual(['patientName', 'firstName']);
  });

  it('keeps a readable passport as it is', () => {
    const onSave = renderModal('Pasaporte');

    save();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'Pasaporte' }));
  });
});

describe('saving demographics of a patient under identity review', () => {
  type Form = ReturnType<typeof useDemographicsLogic>;
  // By default the stored first name is not text: the read shows it empty and puts it in review.
  const UNREAD_FIRST_NAME = { firstName: { given: 'PACIENTE' } };

  /** The form for R1 as read, after an edit and a save. */
  const submitForm = (edit: (form: Form) => void, storedR1: Record<string, unknown>) => {
    const record = docToRecord(storedDay(storedR1), DATE);
    const onSave = vi.fn();
    const { result } = renderHook(() =>
      useDemographicsLogic({
        data: record.beds.R1,
        isClinicalCribPatient: false,
        isOpen: true,
        bedId: 'R1',
        recordDate: DATE,
        onSave,
        onClose: vi.fn(),
      })
    );
    act(() => edit(result.current));
    act(() => result.current.handleSave());
    return { record, onSave, error: result.current.error };
  };

  /** The day the patch of a saved form stores locally. */
  const saveForm = (
    edit: (form: Form) => void,
    storedR1: Record<string, unknown> = UNREAD_FIRST_NAME
  ) => {
    const { record, onSave } = submitForm(edit, storedR1);
    expect(onSave).toHaveBeenCalledOnce();
    const patch = buildUpdatePatientPatches(record, 'R1', onSave.mock.calls[0][0]);
    return preparePatchedRecordPersistence(record, DATE, patch as never).record;
  };

  it('keeps the review and every stored name part when only another field changes', () => {
    const saved = saveForm(form =>
      form.setLocalData(current => ({ ...current, isRapanui: !current.isRapanui }))
    ).beds.R1;

    expect(saved.identityReview).toMatchObject({ fields: ['firstName'] });
    expect(saved).toMatchObject({
      firstName: '',
      lastName: 'SINTETICO',
      secondLastName: 'R1',
      patientName: 'PACIENTE UNO',
    });
  });

  it('ends the review of the first name the nurse typed', () => {
    const saved = saveForm(form =>
      form.setLocalData(current => ({ ...current, firstName: 'PACIENTE' }))
    ).beds.R1;

    expect(saved.identityReview).toBeUndefined();
    expect(saved).toMatchObject({
      patientName: 'PACIENTE SINTETICO R1',
      firstName: 'PACIENTE',
      lastName: 'SINTETICO',
    });
  });

  it('repairs the document type alone and keeps the unread name as stored', () => {
    const saved = saveForm(
      form => form.setLocalData(current => ({ ...current, documentType: 'Pasaporte' })),
      { documentType: 'Cedula', patientName: { full: 'FAKE-NAME' } }
    );

    expect(saved.beds.R1.documentType).toBe('Pasaporte');
    expect(saved.beds.R1.identityReview).toMatchObject({
      fields: ['patientName'],
      stored: { patientName: { full: 'FAKE-NAME' } },
    });
    expect(withStoredIdentity(saved).beds.R1.patientName).toEqual({ full: 'FAKE-NAME' });
  });

  it('recomposes the unread full name from its three parts when the nurse edits one', () => {
    const saved = saveForm(
      form => form.setLocalData(current => ({ ...current, lastName: 'SINTETICA' })),
      { documentType: 'Cedula', patientName: { full: 'FAKE-NAME' } }
    );

    expect(saved.beds.R1).toMatchObject({
      patientName: 'PACIENTE SINTETICA R1',
      firstName: 'PACIENTE',
      lastName: 'SINTETICA',
      secondLastName: 'R1',
    });
    // The name review ends; the document type stays under review, as stored.
    expect(saved.beds.R1.identityReview?.fields).toEqual(['documentType']);
    expect(withStoredIdentity(saved).beds.R1).toMatchObject({
      patientName: 'PACIENTE SINTETICA R1',
      documentType: 'Cedula',
    });
  });

  it('asks to complete the name when another part is still unread, and writes nothing', () => {
    const { onSave, error } = submitForm(
      form => form.setLocalData(current => ({ ...current, lastName: 'SINTETICA' })),
      UNREAD_FIRST_NAME
    );

    expect(onSave).not.toHaveBeenCalled();
    expect(error).toBe('Completa el nombre: una parte no se pudo leer.');
  });
});
