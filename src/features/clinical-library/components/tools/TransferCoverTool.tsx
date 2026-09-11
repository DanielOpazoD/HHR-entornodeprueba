import React, { useState } from 'react';
import { Mail, Printer } from 'lucide-react';
import type { LibraryPatientOption } from '../../domain/libraryCatalogTypes';
import {
  TRANSFER_COVER_CONTENTS,
  emptyTransferCover,
  formatCoverDate,
  isTransferCoverPrintable,
  normalizeCoverDateInput,
  type CoverPaper,
  type TransferCoverData,
} from '../../domain/transferCover';
import { buildTransferCoverDocument } from '../../controllers/transferCoverPrint';
import { printHtmlDocument, type PrintHtmlOutcome } from '../../services/printHtmlDocument';
import { SegmentedControl, SelectField, TextField, ToolSection } from './ToolField';
import { ToolFrame, type ToolComponentProps } from './ToolFrame';

const MANUAL_ENTRY = '';

export const PRINT_ACTION_CLASS =
  'inline-flex h-8 items-center gap-1.5 rounded-md bg-medical-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 disabled:cursor-not-allowed disabled:bg-slate-300';

export const TransferCoverTool: React.FC<ToolComponentProps> = ({ onBack, onClose, patients }) => {
  const [cover, setCover] = useState<TransferCoverData>(emptyTransferCover);
  const [selectedBed, setSelectedBed] = useState<string>(MANUAL_ENTRY);
  const [outcome, setOutcome] = useState<PrintHtmlOutcome | null>(null);

  const update = <K extends keyof TransferCoverData>(key: K, value: TransferCoverData[K]): void =>
    setCover(previous => ({ ...previous, [key]: value }));

  const selectPatient = (bedId: string): void => {
    setSelectedBed(bedId);
    const patient: LibraryPatientOption | undefined = patients.find(item => item.bedId === bedId);
    if (!patient) return;
    setCover(previous => ({
      ...previous,
      patientName: patient.patientName,
      rut: patient.rut,
      age: patient.age,
      bedId: patient.bedId,
      admissionDate: normalizeCoverDateInput(patient.admissionDate),
    }));
  };

  const printable = isTransferCoverPrintable(cover);
  const print = (): void => {
    setOutcome(printHtmlDocument(buildTransferCoverDocument(cover)));
  };

  return (
    <ToolFrame
      title="Carátula de sobre de traslado"
      icon={<Mail size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId="library-tool-transfer-cover"
      action={
        <button
          type="button"
          onClick={print}
          disabled={!printable}
          className={PRINT_ACTION_CLASS}
          data-testid="transfer-cover-print"
        >
          <Printer size={14} aria-hidden="true" />
          Imprimir
        </button>
      }
    >
      <ToolSection title="Paciente">
        <SelectField
          id="cover-patient"
          label="Desde el censo"
          value={selectedBed}
          onChange={selectPatient}
          options={[
            { value: MANUAL_ENTRY, label: 'Escribir manualmente' },
            ...patients.map(patient => ({ value: patient.bedId, label: patient.label })),
          ]}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <TextField
              id="cover-name"
              label="Nombre y apellidos"
              value={cover.patientName}
              onChange={value => update('patientName', value)}
              autoCapitalize="words"
            />
          </div>
          <TextField
            id="cover-rut"
            label="RUT"
            value={cover.rut}
            onChange={value => update('rut', value)}
            placeholder="12.345.678-9"
          />
          <TextField
            id="cover-age"
            label="Edad"
            value={cover.age}
            onChange={value => update('age', value)}
            placeholder="65"
          />
        </div>
      </ToolSection>

      <ToolSection title="Traslado">
        <div className="grid grid-cols-2 gap-2">
          <TextField
            id="cover-destination"
            label="Destino"
            value={cover.destination}
            onChange={value => update('destination', value)}
          />
          <TextField
            id="cover-admission-date"
            label="Fecha de ingreso a Hospital Hanga Roa"
            type="date"
            value={cover.admissionDate}
            onChange={value => update('admissionDate', value)}
          />
          <div className="col-span-2">
            <TextField
              id="cover-origin"
              label="Origen"
              value={cover.origin}
              onChange={value => update('origin', value)}
            />
          </div>
          <div className="col-span-2">
            <SegmentedControl
              label="Papel (horizontal)"
              value={cover.paper}
              onChange={(value: CoverPaper) => update('paper', value)}
              options={[
                { value: 'oficio', label: 'Oficio' },
                { value: 'carta', label: 'Carta' },
              ]}
            />
          </div>
        </div>
      </ToolSection>

      <ToolSection title="Vista previa">
        <div
          data-testid="transfer-cover-preview"
          className="rounded-lg border border-slate-200 bg-white p-4 text-center"
        >
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Traslado</p>
          <p className="mt-2 truncate text-[22px] font-extrabold leading-tight text-slate-900">
            {cover.patientName.trim() || '—'}
          </p>
          <p className="mt-1 text-[14px] font-semibold tabular-nums text-slate-700">
            {cover.rut.trim() ? `RUT ${cover.rut.trim()}` : 'RUT —'}
          </p>
          <p className="mt-3 text-[11px] text-slate-500">
            {cover.destination.trim() || '—'} · {TRANSFER_COVER_CONTENTS.length} casillas de
            contenido
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Ingreso a Hospital Hanga Roa: {formatCoverDate(cover.admissionDate) || '—'}
          </p>
        </div>
        {outcome === 'blocked' && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
            El navegador bloqueó la pestaña de impresión. Permite ventanas emergentes para este
            sitio.
          </p>
        )}
      </ToolSection>
    </ToolFrame>
  );
};
