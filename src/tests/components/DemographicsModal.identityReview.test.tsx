import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DemographicsModal } from '@/components/modals/DemographicsModal';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
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

describe('demographics of a patient whose stored document type could not be read', () => {
  it('asks for RUT or passport instead of saving RUT by default', () => {
    const onSave = renderModal('Cedula');

    expect(screen.getByDisplayValue('Por revisar')).toBeInTheDocument();
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
