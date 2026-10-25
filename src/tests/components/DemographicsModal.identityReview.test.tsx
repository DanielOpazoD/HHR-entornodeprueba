import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DemographicsModal } from '@/components/modals/DemographicsModal';
import { useDemographicsLogic } from '@/components/modals/demographics/useDemographicsLogic';
import { buildUpdatePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
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

  it('asks for RUT or passport when the nurse edits the identity', () => {
    const onSave = renderModal('Cedula');

    fireEvent.change(screen.getByDisplayValue('FAKE-PASSPORT-R1'), {
      target: { value: 'FAKE-PASSPORT-R1B' },
    });
    save();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Elige RUT o pasaporte/)).toBeInTheDocument();
  });

  it('saves the document type the nurse chose', () => {
    const onSave = renderModal('Cedula');

    fireEvent.change(screen.getByDisplayValue('Por revisar'), { target: { value: 'Pasaporte' } });
    save();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ documentType: 'Pasaporte', rut: 'FAKE-PASSPORT-R1' })
    );
  });

  it('keeps a readable passport as it is', () => {
    const onSave = renderModal('Pasaporte');

    save();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ documentType: 'Pasaporte' }));
  });
});

describe('saving demographics of a patient whose first name could not be read', () => {
  // The stored first name is not text: the read shows it empty and puts it under review.
  const day = () => docToRecord(storedDay({ firstName: { given: 'PACIENTE' } }), DATE);

  /** The form for R1, an edit, a save, and the day the resulting patch would store locally. */
  const saveForm = (edit: (local: ReturnType<typeof useDemographicsLogic>) => void) => {
    const record = day();
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
    expect(onSave).toHaveBeenCalledOnce();
    const patch = buildUpdatePatientPatches(record, 'R1', onSave.mock.calls[0][0]);
    return preparePatchedRecordPersistence(record, DATE, patch as never).record.beds.R1;
  };

  it('keeps the review and every stored name part when only another field changes', () => {
    const saved = saveForm(form =>
      form.setLocalData(current => ({ ...current, isRapanui: !current.isRapanui }))
    );

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
    );

    expect(saved.identityReview).toBeUndefined();
    expect(saved).toMatchObject({ firstName: 'PACIENTE', lastName: 'SINTETICO' });
  });
});
