import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataFactory } from '@/tests/factories/DataFactory';
import type { PatientClinicalAccessProps } from '@/features/census/components/patient-row/patientRowInputViewContracts';

vi.mock('@/features/laboratory', () => ({
  LabResultsViewerModal: ({ onRequestExams }: { onRequestExams?: () => void }) => (
    <div role="dialog" aria-label="Visualizador de laboratorio">
      {onRequestExams && (
        <button type="button" onClick={onRequestExams}>
          Solicitar exámenes
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/modals/RadiologyViewerModal', () => ({
  RadiologyViewerModal: ({ onRequestImaging }: { onRequestImaging?: () => void }) => (
    <div role="dialog" aria-label="Visualizador MMRAD">
      {onRequestImaging && (
        <button type="button" onClick={onRequestImaging}>
          Solicitar imagen
        </button>
      )}
    </div>
  ),
}));

const openClinicalExplorer = vi.hoisted(() => vi.fn());
vi.mock(
  '@/features/census/components/clinical-explorer/clinicalExplorerStore',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    openClinicalExplorer,
  })
);

vi.mock('@/features/census/components/patient-row/ClinicalPanelDrawer', () => ({
  ClinicalPanelDrawer: ({ patientName }: { patientName: string }) => (
    <div role="dialog" aria-label="Ficha clínica">
      Panel de {patientName}
    </div>
  ),
}));

import { PatientClinicalAccess } from '@/features/census/components/patient-row/PatientClinicalAccess';

const patient = DataFactory.createMockPatient('R2', {
  patientName: 'Paciente de prueba',
  rut: '12.345.678-5',
  clinicalEpisodeId: '141336',
});

const passportPatient = DataFactory.createMockPatient('R2', {
  patientName: 'Paciente de prueba',
  rut: 'AB123456',
  documentType: 'Pasaporte',
  clinicalEpisodeId: '',
});

const renderAccess = (props: Partial<PatientClinicalAccessProps> = {}) =>
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <PatientClinicalAccess patient={patient} censusDate="2026-09-03" {...props} />
          </td>
        </tr>
      </tbody>
    </table>
  );

const manutara = (name = 'Paciente de prueba') =>
  screen.getByRole('button', { name: `Accesos de ${name}` });

/** Opens the ring from the row's manutara and returns one of its entries. */
const access = (topic: string, name = 'Paciente de prueba') => {
  if (!screen.queryByRole('menu')) fireEvent.click(manutara(name));
  return screen.getByRole('menuitem', { name: `${topic} de ${name}` });
};

describe('PatientClinicalAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows one manutara per patient and opens the ring with its four topics around the explorer', () => {
    renderAccess();

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(manutara()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(manutara());

    expect(manutara()).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(screen.getByRole('menu', { name: 'Accesos de Paciente de prueba' }))
        .getAllByRole('menuitem')
        .map(item => item.getAttribute('aria-label'))
    ).toEqual([
      'Ficha clínica de Paciente de prueba',
      'Laboratorio de Paciente de prueba',
      'Imágenes de Paciente de prueba',
      'Documentos de Paciente de prueba',
      'Explorador clínico de Paciente de prueba',
    ]);
    // The centre takes the focus, so Enter goes straight to the explorer.
    expect(access('Explorador clínico')).toHaveFocus();
  });

  it('opens ficha, laboratory and imaging and offers no request when reading', async () => {
    renderAccess();

    fireEvent.click(access('Laboratorio'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      await screen.findByRole('dialog', { name: 'Visualizador de laboratorio' })
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar exámenes' })).toBeNull();

    fireEvent.click(access('Imágenes'));
    expect(await screen.findByRole('dialog', { name: 'Visualizador MMRAD' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Solicitar imagen' })).toBeNull();

    fireEvent.click(access('Ficha clínica'));
    expect(await screen.findByRole('dialog', { name: 'Ficha clínica' })).toHaveTextContent(
      'Panel de Paciente de prueba'
    );
  });

  it('opens the clinical explorer on this patient from the centre, with focus back on the manutara', () => {
    let focusedWhenOpened: Element | null = null;
    openClinicalExplorer.mockImplementation(() => {
      focusedWhenOpened = document.activeElement;
    });
    renderAccess();

    fireEvent.click(access('Explorador clínico'));

    expect(openClinicalExplorer).toHaveBeenCalledWith({ censusDate: '2026-09-03', bedId: 'R2' });
    // The explorer returns focus to whoever opened it: the manutara, never the closed ring.
    expect(focusedWhenOpened).toBe(manutara());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('hands laboratory and imaging requests to the row from their viewers', async () => {
    const onRequestExams = vi.fn();
    const onRequestImaging = vi.fn();
    renderAccess({ onRequestExams, onRequestImaging });

    fireEvent.click(access('Laboratorio'));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar exámenes' }));
    expect(onRequestExams).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Visualizador de laboratorio' })).toBeNull();

    fireEvent.click(access('Imágenes'));
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar imagen' }));
    expect(onRequestImaging).toHaveBeenCalledTimes(1);
  });

  it('marks documents on the manutara and opens them with their count', () => {
    const onViewClinicalDocuments = vi.fn();
    renderAccess({ onViewClinicalDocuments, clinicalDocumentCount: 2 });

    expect(screen.getByTestId('clinical-access-documents-dot-R2')).toBeInTheDocument();
    const documents = access('Documentos');
    expect(documents).toHaveTextContent('2');
    fireEvent.click(documents);
    expect(onViewClinicalDocuments).toHaveBeenCalledTimes(1);
  });

  it('keeps the ring whole and greys out what the patient cannot use', () => {
    renderAccess({ patient: passportPatient, censusDate: undefined });
    expect(screen.queryByTestId('clinical-access-documents-dot-R2')).toBeNull();

    for (const topic of ['Ficha clínica', 'Laboratorio', 'Imágenes', 'Documentos']) {
      expect(access(topic)).toHaveAttribute('aria-disabled', 'true');
    }
    const explorer = access('Explorador clínico');
    expect(explorer).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(explorer);
    fireEvent.click(access('Ficha clínica'));
    expect(openClinicalExplorer).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still requests directly when nothing can be read yet but the row can edit', () => {
    const onRequestExams = vi.fn();
    const onRequestImaging = vi.fn();
    renderAccess({ patient: passportPatient, onRequestExams, onRequestImaging });

    fireEvent.click(access('Laboratorio'));
    fireEvent.click(access('Imágenes'));

    expect(onRequestExams).toHaveBeenCalledTimes(1);
    expect(onRequestImaging).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves by arrow towards each topic, opens with Enter and closes with Escape', async () => {
    renderAccess();
    access('Explorador clínico');
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(access('Laboratorio')).toHaveFocus();
    // The same arrow again goes back to the centre.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(access('Explorador clínico')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(access('Documentos')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(access('Ficha clínica')).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(manutara()).toHaveFocus();

    access('Explorador clínico');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Ficha clínica' })).toBeVisible();
  });

  it('closes on an outside click without opening anything', () => {
    renderAccess();

    fireEvent.click(manutara());
    fireEvent.click(screen.getByTestId('clinical-access-menu').previousElementSibling!);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(manutara()).toHaveFocus();
    expect(openClinicalExplorer).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('follows its manutara while the page scrolls and closes once it leaves the screen', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      renderAccess();
      const button = manutara();
      const place = (top: number) =>
        vi
          .spyOn(button, 'getBoundingClientRect')
          .mockReturnValue(DOMRect.fromRect({ x: 400, y: top, width: 30, height: 30 }));
      place(300);
      fireEvent.click(button);
      const menu = screen.getByTestId('clinical-access-menu');
      expect(menu.style.top).toBe(`${315 - 92}px`);

      // A scroll still running when the ring opens moves it along instead of closing it.
      place(250);
      fireEvent.scroll(window);
      act(() => vi.advanceTimersToNextFrame());
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(menu.style.top).toBe(`${265 - 92}px`);

      place(-40);
      fireEvent.scroll(window);
      act(() => vi.advanceTimersToNextFrame());
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still closes with Escape when nothing in the ring can be opened', () => {
    renderAccess({
      patient: DataFactory.createMockPatient('R2', {
        patientName: 'RN de prueba',
        rut: '',
        clinicalEpisodeId: '',
      }),
      isSubRow: true,
    });

    fireEvent.click(manutara('RN de prueba'));
    expect(screen.getByRole('menu')).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(manutara('RN de prueba')).toHaveFocus();
  });

  it('gives a crib only its own ficha', async () => {
    const crib = DataFactory.createMockPatient('R2', {
      patientName: 'RN de prueba',
      rut: '',
      clinicalEpisodeId: '141399',
    });
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <PatientClinicalAccess
                patient={crib}
                isSubRow
                censusDate="2026-09-03"
                onRequestExams={vi.fn()}
                onViewClinicalDocuments={vi.fn()}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );

    for (const topic of ['Laboratorio', 'Imágenes', 'Documentos', 'Explorador clínico']) {
      expect(access(topic, 'RN de prueba')).toHaveAttribute('aria-disabled', 'true');
    }
    fireEvent.click(access('Ficha clínica', 'RN de prueba'));
    expect(await screen.findByRole('dialog', { name: 'Ficha clínica' })).toHaveTextContent(
      'Panel de RN de prueba'
    );
  });
});
