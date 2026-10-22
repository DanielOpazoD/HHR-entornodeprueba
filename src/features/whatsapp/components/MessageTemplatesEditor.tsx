/**
 * Message Templates Editor
 *
 * Component for managing WhatsApp message templates
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle, FileText, Plus, Trash2, X, Edit2, Check } from 'lucide-react';
import {
  getMessageTemplates,
  saveMessageTemplates,
  type MessageTemplate,
} from '@/services/integrations/whatsapp/whatsappService';
import { useConfirmDialog } from '@/context/UIContext';

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export const MessageTemplatesEditor: React.FC = () => {
  const { confirm } = useConfirmDialog();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    let isMounted = true;
    const fetchTemplates = async () => {
      try {
        const data = await getMessageTemplates();
        if (isMounted) {
          setTemplates(data);
          setLoadError(null);
        }
      } catch (error) {
        // Editing defaults after a failed read would overwrite the stored templates on save.
        if (isMounted) setLoadError(errorMessage(error, 'No se pudieron leer las plantillas.'));
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchTemplates();
    return () => {
      isMounted = false;
    };
  }, [loadAttempt]);

  /** Saves the whole list; the editor only changes once the write is confirmed. */
  const persist = async (updated: MessageTemplate[]): Promise<boolean> => {
    try {
      await saveMessageTemplates(updated);
      setTemplates(updated);
      setSaveError(null);
      return true;
    } catch (error) {
      setSaveError(errorMessage(error, 'No se pudieron guardar las plantillas.'));
      return false;
    }
  };

  const handleEdit = (template: MessageTemplate) => {
    setEditingId(template.id || null);
    setEditContent(template.content);
  };

  const handleSaveEdit = async (templateId: string) => {
    const updated = templates.map(t => (t.id === templateId ? { ...t, content: editContent } : t));
    if (await persist(updated)) setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleAddTemplate = async () => {
    const newTemplate: MessageTemplate = {
      id: `custom-${Date.now()}`,
      name: 'Nueva Plantilla',
      type: 'custom',
      content:
        '📋 Escribe tu mensaje aquí...\n\nVariables disponibles:\n{{date}} - Fecha\n{{signedBy}} - Firmado por\n{{signedAt}} - Hora firma\n{{hospitalized}} - Hospitalizados\n{{handoffUrl}} - Link',
    };

    if (await persist([...templates, newTemplate])) handleEdit(newTemplate);
  };

  const handleDeleteTemplate = async (templateId: string) => {
    const confirmed = await confirm({
      title: 'Eliminar plantilla',
      message: '¿Seguro que quieres eliminar esta plantilla? Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!confirmed) return;

    await persist(templates.filter(t => t.id !== templateId));
  };

  if (loading) {
    return <div className="text-center py-8">Cargando plantillas...</div>;
  }

  if (loadError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 py-8 text-sm text-red-700"
      >
        <AlertCircle className="w-5 h-5" />
        <p>{loadError}</p>
        <button
          onClick={() => {
            setLoading(true);
            setLoadAttempt(attempt => attempt + 1);
          }}
          className="px-4 py-1.5 rounded-lg border border-red-300 bg-white hover:bg-red-100"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-500" />
          <h3 className="font-medium">Plantillas de Mensaje</h3>
        </div>
        <button
          onClick={handleAddTemplate}
          className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" />
          Nueva
        </button>
      </div>

      {saveError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <AlertCircle className="w-4 h-4" />
          {saveError}
        </div>
      )}

      <div className="space-y-3">
        {templates.map(template => (
          <div key={template.id} className="border rounded-lg p-4 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{template.name}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    template.type === 'handoff'
                      ? 'bg-green-100 text-green-700'
                      : template.type === 'shift'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {template.type === 'handoff'
                    ? 'Entrega'
                    : template.type === 'shift'
                      ? 'Turno'
                      : 'Custom'}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {editingId === template.id ? (
                  <>
                    <button
                      onClick={() => handleSaveEdit(template.id!)}
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                      title="Guardar"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1.5 text-gray-600 hover:bg-gray-50 rounded"
                      title="Cancelar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleEdit(template)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {template.type === 'custom' && (
                      <button
                        onClick={() => handleDeleteTemplate(template.id!)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {editingId === template.id ? (
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="w-full h-48 p-3 border rounded-lg font-mono text-sm resize-none"
                placeholder="Escribe el contenido del mensaje..."
              />
            ) : (
              <pre className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                {template.content}
              </pre>
            )}
          </div>
        ))}
      </div>

      {/* Variables Help */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-2">Variables Disponibles</h4>
        <div className="grid grid-cols-2 gap-2 text-sm text-blue-700">
          <code>{'{{date}}'}</code> → Fecha de entrega
          <code>{'{{signedBy}}'}</code> → Nombre del médico
          <code>{'{{signedAt}}'}</code> → Hora de firma
          <code>{'{{hospitalized}}'}</code> → Nº hospitalizados
          <code>{'{{newAdmissions}}'}</code> → Nuevos ingresos
          <code>{'{{discharges}}'}</code> → Altas
          <code>{'{{handoffUrl}}'}</code> → Link a la entrega
        </div>
      </div>
    </div>
  );
};

export default MessageTemplatesEditor;
