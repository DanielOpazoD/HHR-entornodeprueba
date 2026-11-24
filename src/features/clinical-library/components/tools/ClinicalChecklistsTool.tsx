import React, { useEffect, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import {
  clinicalChecklist,
  type ChecklistRecord,
  type ChecklistTemplate,
} from '@/services/clinical-checklists/checklistService';
import { escapeHtml, printHtmlDocument } from '../../services/printHtmlDocument';
import { ToolFrame, type ToolComponentProps } from './ToolFrame';
import { ChecklistTemplateEditor } from './ChecklistTemplateEditor';

export function ClinicalChecklistsTool({ onBack, onClose, onDirtyChange }: ToolComponentProps) {
  const [code, setCode] = useState('');
  const [record, setRecord] = useState<ChecklistRecord | null>(null);
  const [manage, setManage] = useState(false);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [editor, setEditor] = useState<ChecklistTemplate | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    void clinicalChecklist({ action: 'templates' })
      .then(result => {
        if (active) {
          setTemplates(result.templates);
          setManage(result.manage);
        }
      })
      .catch(() => {
        if (active) setError('No se pudieron cargar las plantillas de HHR.');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange?.(Boolean(editor));
    return () => onDirtyChange?.(false);
  }, [editor, onDirtyChange]);
  async function find(event: React.FormEvent) {
    event.preventDefault();
    const id = ++request.current;
    setRecord(null);
    setError('');
    setBusy(true);
    try {
      const result = await clinicalChecklist({ action: 'get', code: code.trim() });
      if (request.current === id) setRecord(result.record);
    } catch (reason) {
      if (request.current === id)
        setError(reason instanceof Error ? reason.message : 'No se pudo recuperar la pauta.');
    } finally {
      if (request.current === id) setBusy(false);
    }
  }
  const print = () => {
    if (!record) return;
    const outcome = printHtmlDocument({
      title: record.template.title,
      styles:
        '@page{margin:18mm}body{font:12pt/1.5 system-ui;color:#183a35}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}h1{font-size:16pt}',
      body:
        '<h1>' +
        escapeHtml(record.template.title) +
        '</h1><p>' +
        escapeHtml(record.patient.name) +
        ' · ' +
        escapeHtml(record.patient.document) +
        '</p><p>Episodio ' +
        escapeHtml(record.patient.episode) +
        ' · Plantilla v' +
        record.template.version +
        '</p><pre>' +
        escapeHtml(record.evolution) +
        '</pre>',
    });
    if (outcome === 'blocked')
      setError('Permite la ventana de impresión en HHR y vuelve a imprimir.');
  };
  return (
    <ToolFrame
      title="Pautas clínicas"
      icon={<ClipboardCheck size={16} />}
      onBack={onBack}
      onClose={onClose}
    >
      <div className="space-y-4 text-sm">
        {editor ? (
          <ChecklistTemplateEditor
            initial={editor === 'new' ? undefined : editor}
            onCancel={() => setEditor(null)}
            onSaved={t => {
              setTemplates(prev => [...prev.filter(x => x.id !== t.id), t]);
              setEditor(null);
            }}
          />
        ) : (
          <>
            <form className="space-y-2" onSubmit={find}>
              <label className="block">
                Código de la evolución
                <input
                  required
                  maxLength={39}
                  placeholder="PT-…"
                  className="mt-1 w-full rounded border px-2 py-2"
                  value={code}
                  onChange={e => {
                    request.current++;
                    setCode(e.target.value);
                    setRecord(null);
                    setError('');
                    setBusy(false);
                  }}
                />
              </label>
              <button
                disabled={busy}
                type="submit"
                className="rounded bg-medical-700 px-3 py-1.5 text-white"
              >
                {busy ? 'Buscando…' : 'Verificar pauta'}
              </button>
            </form>
            {record && (
              <section className="space-y-2 rounded border p-3">
                <h4 className="font-semibold">{record.patient.name}</h4>
                <p>
                  {record.patient.document} · Episodio {record.patient.episode} · v
                  {record.template.version}
                </p>
                <p className="whitespace-pre-wrap break-words">{record.evolution}</p>
                <button type="button" onClick={print}>
                  Imprimir / guardar PDF
                </button>
              </section>
            )}
            {manage && (
              <details>
                <summary className="cursor-pointer">Configurar plantillas</summary>
                <ul>
                  {templates.map(t => (
                    <li key={t.id}>
                      <button type="button" className="py-2 text-left" onClick={() => setEditor(t)}>
                        {t.title} · v{t.version}
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => setEditor('new')}>
                  Crear plantilla
                </button>
              </details>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </ToolFrame>
  );
}
