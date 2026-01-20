/**
 * Message Templates Editor
 * 
 * Component for managing WhatsApp message templates
 */

import React, { useState, useEffect } from 'react';
import {
    FileText,
    Plus,
    Trash2,
    X,
    Edit2,
    Check
} from 'lucide-react';
import {
    getMessageTemplates,
    saveMessageTemplates,
    type MessageTemplate
} from '../../services/integrations/whatsapp/whatsappService';

export const MessageTemplatesEditor: React.FC = () => {
    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');

    useEffect(() => {
        let isMounted = true;
        const fetchTemplates = async () => {
            // Loading is already true by default state
            const data = await getMessageTemplates();
            if (isMounted) {
                setTemplates(data);
                setLoading(false);
            }
        };
        fetchTemplates();
        return () => { isMounted = false; };
    }, []);

    const handleEdit = (template: MessageTemplate) => {
        setEditingId(template.id || null);
        setEditContent(template.content);
    };

    const handleSaveEdit = async (templateId: string) => {
        const updated = templates.map(t =>
            t.id === templateId ? { ...t, content: editContent } : t
        );

        await saveMessageTemplates(updated);
        setTemplates(updated);
        setEditingId(null);
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
            content: '📋 Escribe tu mensaje aquí...\n\nVariables disponibles:\n{{date}} - Fecha\n{{signedBy}} - Firmado por\n{{signedAt}} - Hora firma\n{{hospitalized}} - Hospitalizados\n{{handoffUrl}} - Link'
        };

        const updated = [...templates, newTemplate];
        await saveMessageTemplates(updated);
        setTemplates(updated);
        handleEdit(newTemplate);
    };

    const handleDeleteTemplate = async (templateId: string) => {
        if (!confirm('¿Eliminar esta plantilla?')) return;

        const updated = templates.filter(t => t.id !== templateId);
        await saveMessageTemplates(updated);
        setTemplates(updated);
    };

    if (loading) {
        return <div className="text-center py-8">Cargando plantillas...</div>;
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

            <div className="space-y-3">
                {templates.map(template => (
                    <div
                        key={template.id}
                        className="border rounded-lg p-4 bg-white"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="font-medium">{template.name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded ${template.type === 'handoff'
                                    ? 'bg-green-100 text-green-700'
                                    : template.type === 'shift'
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-gray-100 text-gray-700'
                                    }`}>
                                    {template.type === 'handoff' ? 'Entrega' :
                                        template.type === 'shift' ? 'Turno' : 'Custom'}
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
                                onChange={(e) => setEditContent(e.target.value)}
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
