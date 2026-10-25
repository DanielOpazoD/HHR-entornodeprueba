import React from 'react';
import type { PatientData } from '@/domain/handoff/patientContracts';
import {
  buildSpecialistHandoffIdentity,
  createMedicalHandoffDraftWriter,
  discardMedicalHandoffDraft,
  medicalHandoffDraftKey,
  registerMedicalHandoffEditor,
  useMedicalHandoffDrafts,
  writeMedicalHandoffDraft,
  type MedicalHandoffDraft,
} from '@/hooks/useMedicalHandoffDraft';
import { MedicalHandoffDraftReview, ConfirmDiscardButton } from './MedicalHandoffDraftReview';
import { medicalHandoffPatientKey } from './medicalHandoffPatientKey';

interface Props {
  patient: PatientData;
  reportDate: string;
  entryId: string;
  value: string;
  onChangeValue: (value: string) => unknown;
  /** Focused, a pending debounce or a send in flight: the cell keeps this entry on screen. */
  onEditingChange?: (editing: boolean) => void;
}

/**
 * The text the user owns from the first keystroke. It survives remounts in this page and ends
 * only when the stored value shows it, or when the user chooses the stored value instead.
 */
interface Session {
  text: string;
  base: string;
  sent: string[];
  writer: string;
  save: (value: string) => unknown;
}
const sessions = new Map<string, Session>();
const DEBOUNCE_MS = 1500;

export const MedicalHandoffDraftTextarea: React.FC<Props> = props => (
  <DraftEditor
    key={`${props.reportDate}:${medicalHandoffPatientKey(props.patient)}:${props.entryId}`}
    {...props}
  />
);

const DraftEditor: React.FC<Props> = ({
  patient,
  reportDate,
  entryId,
  value: stored,
  onChangeValue,
  onEditingChange,
}) => {
  const identity = buildSpecialistHandoffIdentity(patient);
  const draft = (value: string) => ({ date: reportDate, ...identity, entryId, value });
  const key = medicalHandoffDraftKey(draft(''));
  const drafts = useMedicalHandoffDrafts();
  const [, render] = React.useReducer((count: number) => count + 1, 0);
  const storedRef = React.useRef(stored);
  storedRef.current = stored;
  const focused = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef(0);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const session = sessions.get(key);
  const editing = () => focused.current || timer.current !== null || inFlight.current > 0;
  const isOthers = (current: Session, value: string) =>
    value !== current.text && value !== current.base && !current.sent.includes(value);

  const settle = () => {
    const current = sessions.get(key);
    if (current && !editing() && storedRef.current === current.text) sessions.delete(key);
    onEditingChange?.(editing());
    render();
  };
  const flush = (force = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = sessions.get(key);
    const text = current?.text;
    if (
      !current ||
      text === undefined ||
      (!force &&
        (text === storedRef.current ||
          current.sent.at(-1) === text ||
          isOthers(current, storedRef.current)))
    )
      return settle();
    current.sent = [...current.sent.slice(-4), text];
    inFlight.current += 1;
    let result: unknown;
    try {
      result = current.save(text);
    } catch {
      result = undefined;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        inFlight.current -= 1;
        settle();
      });
    settle();
  };
  const startSession = (text: string): Session => {
    const next = {
      text,
      base: storedRef.current,
      sent: [],
      writer: createMedicalHandoffDraftWriter(),
      save: onChangeValue,
    };
    sessions.set(key, next);
    return next;
  };

  React.useEffect(() => registerMedicalHandoffEditor(key), [key]);
  React.useEffect(() => {
    if (sessions.has(key)) settle();
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(
    () => () => {
      if (timer.current) flush();
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  React.useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, 20)}px`;
  });

  const own = session
    ? drafts.find(item => item.key === key && item.slot.includes(`:${session.writer}:`))
    : undefined;
  const others = drafts.filter(
    item => item.key === key && item !== own && item.value !== (session?.text ?? stored)
  );
  const conflict = Boolean(session && isOthers(session, stored));
  const restore = (item: MedicalHandoffDraft) => {
    writeMedicalHandoffDraft(startSession(item.value).writer, draft(item.value));
    discardMedicalHandoffDraft(item);
    flush(true);
  };

  return (
    <>
      <textarea
        ref={textarea}
        value={session ? session.text : stored}
        onChange={event => {
          const current = sessions.get(key) ?? startSession(event.target.value);
          current.text = event.target.value;
          writeMedicalHandoffDraft(current.writer, draft(current.text));
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(), DEBOUNCE_MS);
          onEditingChange?.(true);
          render();
        }}
        onFocus={() => {
          focused.current = true;
          onEditingChange?.(true);
        }}
        onBlur={() => {
          focused.current = false;
          flush();
        }}
        rows={1}
        className="w-full overflow-hidden resize-none rounded border border-slate-200 bg-white px-2 py-1.5 text-[13px] leading-snug focus:ring-2 focus:ring-medical-500 focus:outline-none"
      />
      {session && (conflict || !own?.durable || (!editing() && stored !== session.text)) && (
        <div role="status" className="text-xs text-amber-800 print:hidden">
          {conflict ? (
            <>
              <p>El texto guardado cambió mientras escribías. Elige cuál conservar:</p>
              <pre className="whitespace-pre-wrap font-sans">{stored}</pre>
              <button
                type="button"
                onClick={() => {
                  session.base = stored;
                  flush(true);
                }}
              >
                Guardar mi texto
              </button>{' '}
              <ConfirmDiscardButton
                label="Usar el texto guardado"
                onConfirm={() => {
                  if (own) discardMedicalHandoffDraft(own);
                  sessions.delete(key);
                  settle();
                }}
              />
            </>
          ) : !own?.durable ? (
            'Borrador solo en memoria. Copia el texto antes de cerrar o cambiar de sesión.'
          ) : (
            'Pendiente de confirmar en el servidor.'
          )}
        </div>
      )}
      {!session && drafts.some(item => item.key === key && item.value === stored) && (
        <p role="status" className="text-xs text-amber-800 print:hidden">
          Guardado en este equipo; pendiente de confirmar en el servidor.
        </p>
      )}
      {!session && others.length > 0 && (
        <details className="text-xs text-amber-800 print:hidden">
          <summary>Revisar borrador</summary>
          {others.map(item => (
            <MedicalHandoffDraftReview
              key={item.slot}
              draft={item}
              onRestore={() => restore(item)}
            />
          ))}
        </details>
      )}
    </>
  );
};
