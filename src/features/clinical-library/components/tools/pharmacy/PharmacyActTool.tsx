import React, { useEffect, useState } from 'react';
import { Download, FileText, Plus, Printer, Save } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/types/authRoleTypes';
import { readSessionProfessionalIdentity } from '@/services/user-profile/sessionProfessionalIdentity';
import { formatRut, isValidRut } from '@/utils/rutUtils';
import arsenal from '../../../domain/pharmacy/arsenalHhr2025.json';
import {
  createPharmacyDraft,
  createPharmacyLine,
  validatePharmacyDraft,
} from '../../../domain/pharmacy/pharmacyDraft';
import type {
  PharmacyActDraft,
  PharmacyActKind,
  PharmacyProfessional,
} from '../../../domain/pharmacy/pharmacyTypes';
import { ToolFrame, type ToolComponentProps } from '../ToolFrame';
import { TOOL_INPUT_CLASS, TextField } from '../ToolField';
import { PharmacyMedicationLine } from './PharmacyMedicationLine';
import { loadPharmacyProfessional, savePharmacyProfessional } from './pharmacyProfessionalProfile';
import { usePharmacyActPdf } from './usePharmacyActPdf';

const BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-medical-600 disabled:cursor-not-allowed disabled:opacity-40';
const ACTS = {
  return: { title: 'Devolución de fármacos', filename: 'acta-devolucion-farmacos' },
  disposal: { title: 'Entrega de fármacos eliminados', filename: 'acta-entrega-eliminados' },
} satisfies Record<PharmacyActKind, { title: string; filename: string }>;

interface PharmacyActEditorProps extends Omit<ToolComponentProps, 'patients'> {
  kind: PharmacyActKind;
  uid: string | null;
  displayName: string | null;
  role: UserRole | undefined;
}

const suggestedProfessionalRole = (role: UserRole | undefined): string => {
  if (role === 'nurse_hospital') return 'Enfermero/a';
  if (role === 'doctor_urgency' || role === 'doctor_specialist') return 'Médico/a';
  return '';
};

const PharmacyActEditor: React.FC<PharmacyActEditorProps> = ({
  kind,
  uid,
  displayName,
  role,
  onBack,
  onClose,
  onDirtyChange,
}) => {
  const [draft, setDraft] = useState(() => {
    const identity = uid ? readSessionProfessionalIdentity(uid) : null;
    return createPharmacyDraft(
      kind,
      loadPharmacyProfessional(uid, identity?.name || displayName, undefined, {
        rut: identity?.rut ?? '',
        role: suggestedProfessionalRole(role),
      })
    );
  });
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const pdf = usePharmacyActPdf(draft, setNotice);
  const errors = submitted ? validatePharmacyDraft(draft) : [];
  const meta = ACTS[kind];
  const assetBase = `/docs/biblioteca/farmacia/${meta.filename}`;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  const update = (next: PharmacyActDraft): void => {
    setDraft(next);
    setDirty(true);
    setNotice('');
  };
  const changeProfessional = (key: keyof PharmacyProfessional, value: string): void => {
    update({ ...draft, professional: { ...draft.professional, [key]: value } });
    setProfileNotice('');
  };
  const prepare = (): void => {
    setSubmitted(true);
    if (validatePharmacyDraft(draft).length) return;
    void pdf.prepare();
  };

  return (
    <ToolFrame
      title={meta.title}
      icon={<FileText size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId={`library-tool-pharmacy-${kind}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-medical-700">
          Hospital Hanga Roa · Farmacia
        </p>
        <a
          href={`${assetBase}.docx`}
          download
          className="text-[11px] font-semibold text-slate-500 underline underline-offset-2"
        >
          Descargar Word en blanco
        </a>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-4">
          <section
            aria-label="Datos del acta"
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <h4 className="mb-3 text-xs font-bold text-slate-800">Datos del acta</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-semibold text-slate-600">
                N.° / año {kind === 'return' ? '(opcional)' : '(obligatorio)'}
                <input
                  className={`${TOOL_INPUT_CLASS} mt-1`}
                  value={draft.number}
                  maxLength={80}
                  autoComplete="off"
                  placeholder={`Ej. 12 / ${draft.date.slice(0, 4)}`}
                  onChange={event => update({ ...draft, number: event.target.value })}
                />
              </label>
              <TextField
                id={`pharmacy-${kind}-date`}
                label="Fecha del acta"
                type="date"
                value={draft.date}
                onChange={date => update({ ...draft, date })}
              />
            </div>
            <div className="mt-3">
              <label className="text-[11px] font-semibold text-slate-600">
                Tamaño de papel
                <select
                  className={`${TOOL_INPUT_CLASS} mt-1`}
                  value={draft.paperSize}
                  onChange={event => {
                    const paperSize = event.target.value;
                    if (paperSize === 'a4' || paperSize === 'letter')
                      update({ ...draft, paperSize });
                  }}
                >
                  <option value="a4">A4</option>
                  <option value="letter">Carta</option>
                </select>
              </label>
            </div>
            <div className="mt-3">
              <TextField
                id={`pharmacy-${kind}-recipient`}
                label="A · Destinatario"
                value={draft.recipient}
                onChange={recipient => update({ ...draft, recipient })}
              />
            </div>
          </section>
          <section
            aria-label="Datos del responsable"
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <h4 className="text-xs font-bold text-slate-800">De · Responsable</h4>
            <p className="mb-3 mt-1 text-[10px] leading-relaxed text-slate-500">
              Datos del documento editables. Se conservan en este equipo durante la sesión y se
              borran al cerrar sesión.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2 text-[11px] font-semibold text-slate-600">
                Nombre del responsable
                <input
                  className={`${TOOL_INPUT_CLASS} mt-1`}
                  value={draft.professional.name}
                  maxLength={160}
                  autoComplete="off"
                  onChange={event => changeProfessional('name', event.target.value)}
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-600">
                RUT del responsable
                <input
                  className={`${TOOL_INPUT_CLASS} mt-1`}
                  value={draft.professional.rut}
                  maxLength={16}
                  autoComplete="off"
                  placeholder="Ej. 12.345.678-5"
                  onChange={event => changeProfessional('rut', event.target.value)}
                  onBlur={() => {
                    if (
                      isValidRut(draft.professional.rut) &&
                      formatRut(draft.professional.rut) !== draft.professional.rut
                    )
                      changeProfessional('rut', formatRut(draft.professional.rut));
                  }}
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-600">
                Cargo
                <input
                  className={`${TOOL_INPUT_CLASS} mt-1`}
                  value={draft.professional.role}
                  maxLength={160}
                  autoComplete="off"
                  placeholder="Indicar profesión o cargo"
                  onChange={event => changeProfessional('role', event.target.value)}
                />
              </label>
              <label className="sm:col-span-2 text-[11px] font-semibold text-slate-600">
                Unidad o servicio
                <input
                  className={`${TOOL_INPUT_CLASS} mt-1`}
                  value={draft.professional.unit}
                  maxLength={160}
                  autoComplete="off"
                  onChange={event => changeProfessional('unit', event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={!uid}
              className={`${BUTTON_CLASS} mt-3`}
              onClick={() => {
                const error = savePharmacyProfessional(uid, draft.professional);
                setProfileNotice(
                  error ?? 'Tus datos se guardaron para esta sesión en este equipo.'
                );
              }}
            >
              <Save size={13} aria-hidden="true" /> Guardar mis datos en este equipo
            </button>
            {profileNotice && (
              <p role="status" className="mt-2 text-[11px] text-slate-600">
                {profileNotice}
              </p>
            )}
          </section>
          <section aria-label="Fármacos e insumos">
            <h4 className="text-xs font-bold text-slate-800">Fármacos e insumos</h4>
            <p className="mb-3 mt-1 text-[10px] text-slate-500">
              Arsenal HHR {arsenal.source.year} · referencia de nombres y presentaciones.
            </p>
            <div className="space-y-3">
              {draft.lines.map((line, index) => (
                <PharmacyMedicationLine
                  key={line.id}
                  line={line}
                  index={index}
                  kind={kind}
                  arsenal={arsenal.items}
                  canRemove={draft.lines.length > 1}
                  onChange={next =>
                    update({
                      ...draft,
                      lines: draft.lines.map(item => (item.id === line.id ? next : item)),
                    })
                  }
                  onRemove={() =>
                    update({ ...draft, lines: draft.lines.filter(item => item.id !== line.id) })
                  }
                />
              ))}
            </div>
            <button
              type="button"
              className={`${BUTTON_CLASS} mt-3 w-full border-dashed`}
              onClick={() => update({ ...draft, lines: [...draft.lines, createPharmacyLine()] })}
            >
              <Plus size={14} aria-hidden="true" /> Agregar fármaco o insumo
            </button>
          </section>
          {errors.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
            >
              <p className="font-semibold">Revisa estos datos antes de preparar el PDF:</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {errors.map(error => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {notice && (
            <p role="status" className="text-xs text-slate-600">
              {notice}
            </p>
          )}
          <button
            type="button"
            disabled={pdf.busy}
            onClick={prepare}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-medical-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-medical-700 focus-visible:outline-2 focus-visible:outline-medical-600 disabled:opacity-50"
          >
            <FileText size={15} aria-hidden="true" />
            {pdf.busy ? 'Preparando PDF…' : 'Preparar vista previa'}
          </button>
        </div>
        <section
          aria-label="Vista previa del acta"
          className="min-w-0 self-start rounded-lg border border-slate-200 bg-slate-100 p-3 lg:sticky lg:top-0"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-slate-700">
              {pdf.currentPdf ? 'PDF preparado' : 'Vista previa'}
            </h4>
            {pdf.currentPdf && (
              <div className="flex gap-2">
                <button type="button" className={BUTTON_CLASS} onClick={() => void pdf.download()}>
                  <Download size={13} aria-hidden="true" /> Descargar
                </button>
                <button type="button" className={BUTTON_CLASS} onClick={pdf.print}>
                  <Printer size={13} aria-hidden="true" /> Imprimir
                </button>
              </div>
            )}
          </div>
          {pdf.currentPdf ? (
            <>
              <iframe
                title={`Vista previa · ${meta.title}`}
                src={pdf.currentPdf.url}
                className="h-[640px] min-h-80 w-full rounded border border-slate-200 bg-white"
              />
              <a
                href={pdf.currentPdf.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[11px] font-semibold text-medical-700 underline underline-offset-2"
              >
                Abrir PDF en otra pestaña
              </a>
            </>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-slate-300 bg-white p-6 text-center lg:min-h-[480px]">
              <FileText size={34} aria-hidden="true" className="text-slate-300" />
              <p className="max-w-56 text-xs leading-relaxed text-slate-500">
                Completa los datos y prepara la vista previa para revisar el acta antes de imprimir.
              </p>
              <a
                href={`${assetBase}.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-medical-700 underline underline-offset-2"
              >
                Abrir plantilla en blanco
              </a>
            </div>
          )}
          <p className="mt-3 text-[10px] text-slate-500">
            Firmas manuscritas al imprimir. Los fármacos y pacientes permanecen en esta sesión.
          </p>
        </section>
      </div>
    </ToolFrame>
  );
};

const PharmacyActTool: React.FC<ToolComponentProps & { kind: PharmacyActKind }> = ({
  kind,
  ...props
}) => {
  const { currentUser } = useAuth();
  return (
    <PharmacyActEditor
      key={`${currentUser?.uid ?? 'anonymous'}:${kind}`}
      {...props}
      kind={kind}
      uid={currentUser?.uid ?? null}
      displayName={currentUser?.displayName ?? null}
      role={currentUser?.role}
    />
  );
};

export const PharmacyReturnTool: React.FC<ToolComponentProps> = props => (
  <PharmacyActTool {...props} kind="return" />
);
export const PharmacyDisposalTool: React.FC<ToolComponentProps> = props => (
  <PharmacyActTool {...props} kind="disposal" />
);

export const PharmacyExitConfirmation: React.FC<{
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ onCancel, onConfirm }) => (
  <section
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="pharmacy-exit-title"
    aria-describedby="pharmacy-exit-description"
    className="m-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
  >
    <h3 id="pharmacy-exit-title" className="text-sm font-bold text-slate-800">
      ¿Salir del acta de farmacia?
    </h3>
    <p id="pharmacy-exit-description" className="mt-2 text-sm text-slate-600">
      Los datos de esta acta se descartarán. Puedes seguir editando y descargar el PDF antes de
      salir.
    </p>
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <button type="button" autoFocus onClick={onCancel} className={BUTTON_CLASS}>
        Seguir editando
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-md bg-medical-600 px-3 py-2 text-sm font-semibold text-white hover:bg-medical-700 focus-visible:outline-2 focus-visible:outline-medical-600"
      >
        Salir y descartar
      </button>
    </div>
  </section>
);
