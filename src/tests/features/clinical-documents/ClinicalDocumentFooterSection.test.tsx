import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentFooterSection } from '@/features/clinical-documents/components/ClinicalDocumentFooterSection';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';

const buildDocument = (templateId = 'epicrisis') =>
  createClinicalDocumentDraft({
    templateId,
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'doctor_urgency',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: '11.111.111-1__2026-03-06',
      admissionDate: '2026-03-06',
      sourceDailyRecordDate: '2026-03-06',
      sourceBedId: 'R1',
      specialty: 'Cirugía',
    },
    patientFieldValues: {
      nombre: 'Paciente Test',
      rut: '11.111.111-1',
      edad: '40',
      fecnac: '1986-01-01',
      fing: '2026-03-06',
      finf: '2026-03-06',
      hinf: '10:30',
    },
    medico: 'Doctor Test',
    especialidad: 'Cirugía',
  });

describe('ClinicalDocumentFooterSection', () => {
  it('patches footer labels and metadata when the document is editable', () => {
    const onPatchFooterLabel = vi.fn();
    const onPatchDocumentMeta = vi.fn();
    const onClearActiveTitleTarget = vi.fn();

    render(
      <ClinicalDocumentFooterSection
        document={buildDocument()}
        canEdit={true}
        onPatchFooterLabel={onPatchFooterLabel}
        onPatchDocumentMeta={onPatchDocumentMeta}
        onClearActiveTitleTarget={onClearActiveTitleTarget}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Médico' }));
    const medicoTitleInput = screen.getByDisplayValue('Médico');
    fireEvent.change(medicoTitleInput, { target: { value: 'Médico responsable' } });
    fireEvent.keyDown(medicoTitleInput, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Especialidad' }));
    const especialidadTitleInput = screen.getByDisplayValue('Especialidad');
    fireEvent.change(especialidadTitleInput, { target: { value: 'Servicio clínico' } });
    fireEvent.blur(especialidadTitleInput);

    const [medicoInput, especialidadInput] = screen.getAllByRole('textbox');
    fireEvent.change(medicoInput, { target: { value: 'Dra. Demo' } });
    fireEvent.change(especialidadInput, { target: { value: 'Medicina Interna' } });

    expect(onPatchFooterLabel).toHaveBeenCalledWith('medico', 'Médico responsable');
    expect(onPatchFooterLabel).toHaveBeenCalledWith('especialidad', 'Servicio clínico');
    expect(onPatchDocumentMeta).toHaveBeenCalledWith({ medico: 'Dra. Demo' });
    expect(onPatchDocumentMeta).toHaveBeenCalledWith({ especialidad: 'Medicina Interna' });
    expect(onClearActiveTitleTarget).toHaveBeenCalledTimes(2);
  });

  it('lets editors subtly hide the patient/family signature from generated documents', () => {
    const onPatchDocumentMeta = vi.fn();

    render(
      <ClinicalDocumentFooterSection
        document={buildDocument()}
        canEdit={true}
        onPatchFooterLabel={vi.fn()}
        onPatchDocumentMeta={onPatchDocumentMeta}
        onClearActiveTitleTarget={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /ocultar firma paciente\/familiar/i }));

    expect(onPatchDocumentMeta).toHaveBeenCalledWith({ includePatientSignature: false });
  });

  it('lets the specialist save and apply their private clinical signature profile', () => {
    const onSaveSignatureProfile = vi.fn();
    const onApplySignatureProfile = vi.fn();

    render(
      <ClinicalDocumentFooterSection
        document={buildDocument()}
        canEdit={true}
        onPatchFooterLabel={vi.fn()}
        onPatchDocumentMeta={vi.fn()}
        onClearActiveTitleTarget={vi.fn()}
        signatureProfile={{
          uid: 'u1',
          email: 'doctor@test.com',
          displayName: 'Dra. Preferida',
          specialty: 'Medicina Interna',
          updatedAt: '2026-05-07T12:00:00.000Z',
        }}
        onSaveSignatureProfile={onSaveSignatureProfile}
        onApplySignatureProfile={onApplySignatureProfile}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /usar mi firma/i }));
    fireEvent.click(screen.getByRole('button', { name: /guardar mi firma/i }));

    expect(onApplySignatureProfile).toHaveBeenCalledTimes(1);
    expect(onSaveSignatureProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps specialist signature controls next to Medico and patient signature under Especialidad', () => {
    render(
      <ClinicalDocumentFooterSection
        document={buildDocument()}
        canEdit={true}
        onPatchFooterLabel={vi.fn()}
        onPatchDocumentMeta={vi.fn()}
        onClearActiveTitleTarget={vi.fn()}
        signatureProfile={{
          uid: 'u1',
          email: 'doctor@test.com',
          displayName: 'Dra. Preferida',
          specialty: 'Medicina Interna',
          updatedAt: '2026-05-07T12:00:00.000Z',
        }}
        onSaveSignatureProfile={vi.fn()}
        onApplySignatureProfile={vi.fn()}
      />
    );

    const medicoTitle = screen.getByRole('button', { name: 'Médico' });
    const saveSignature = screen.getByRole('button', { name: /guardar mi firma/i });
    const applySignature = screen.getByRole('button', { name: /usar mi firma/i });
    const specialtyTitle = screen.getByRole('button', { name: 'Especialidad' });
    const patientSignature = screen.getByRole('button', {
      name: /ocultar firma paciente\/familiar/i,
    });

    expect(medicoTitle.parentElement).toContainElement(saveSignature);
    expect(medicoTitle.parentElement).toContainElement(applySignature);
    expect(specialtyTitle.parentElement?.parentElement).toContainElement(patientSignature);
  });

  it('makes the hidden patient/family signature state visible in the toggle itself', () => {
    render(
      <ClinicalDocumentFooterSection
        document={{ ...buildDocument(), includePatientSignature: false }}
        canEdit={true}
        onPatchFooterLabel={vi.fn()}
        onPatchDocumentMeta={vi.fn()}
        onClearActiveTitleTarget={vi.fn()}
      />
    );

    const toggle = screen.getByRole('button', { name: /mostrar firma paciente\/familiar/i });

    expect(toggle).toHaveTextContent('Firma oculta paciente/familiar');
    expect(toggle).toHaveClass('border-amber-200');
  });

  it('does not expose the patient/family signature toggle for document types without that print block', () => {
    render(
      <ClinicalDocumentFooterSection
        document={buildDocument('evolucion')}
        canEdit={true}
        onPatchFooterLabel={vi.fn()}
        onPatchDocumentMeta={vi.fn()}
        onClearActiveTitleTarget={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: /firma paciente\/familiar/i })
    ).not.toBeInTheDocument();
  });

  it('renders footer labels and inputs as read-only when editing is disabled', () => {
    const lockedDocument = {
      ...buildDocument(),
      isLocked: true,
    };

    render(
      <ClinicalDocumentFooterSection
        document={lockedDocument}
        canEdit={false}
        onPatchFooterLabel={vi.fn()}
        onPatchDocumentMeta={vi.fn()}
        onClearActiveTitleTarget={vi.fn()}
      />
    );

    expect(screen.getByText('Médico')).toBeInTheDocument();
    expect(screen.getByText('Especialidad')).toBeInTheDocument();
    screen.getAllByRole('textbox').forEach(input => {
      expect(input).toHaveAttribute('readonly');
    });
  });
});
