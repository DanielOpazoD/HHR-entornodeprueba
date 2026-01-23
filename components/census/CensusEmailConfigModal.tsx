import React, { useState } from 'react';
import { X, Plus, RefreshCw, Mail, Users, MessageSquare } from 'lucide-react';
import clsx from 'clsx';
import { buildCensusEmailBody } from '../../constants/email';
import { BaseModal, ModalSection } from '../shared/BaseModal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    recipients: string[];
    onRecipientsChange: (recipients: string[]) => void;
    message: string;
    onMessageChange: (message: string) => void;
    onResetMessage?: () => void;
    date: string;
    nursesSignature?: string;
    isAdminUser: boolean;
    testModeEnabled: boolean;
    onTestModeChange: (enabled: boolean) => void;
    testRecipient: string;
    onTestRecipientChange: (value: string) => void;
}

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const CensusEmailConfigModal: React.FC<Props> = ({
    isOpen,
    onClose,
    recipients,
    onRecipientsChange,
    message,
    onMessageChange,
    onResetMessage,
    date,
    nursesSignature,
    isAdminUser,
    testModeEnabled,
    onTestModeChange,
    testRecipient,
    onTestRecipientChange
}) => {
    const safeRecipients = Array.isArray(recipients) ? recipients : [];
    const [newRecipient, setNewRecipient] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [showBulkEditor, setShowBulkEditor] = useState(false);
    const [bulkRecipients, setBulkRecipients] = useState('');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [showAllRecipients, setShowAllRecipients] = useState(false);
    const defaultMessage = buildCensusEmailBody(date, nursesSignature);

    // Reset state when opening (State derivation pattern)
    const [wasOpen, setWasOpen] = useState(isOpen);
    if (isOpen && !wasOpen) {
        setWasOpen(true);
        setError(null);
        setNewRecipient('');
        setShowBulkEditor(false);
        setBulkRecipients(Array.isArray(recipients) ? recipients.join('\n') : '');
        setEditingIndex(null);
        setEditingValue('');
        setShowAllRecipients(false);
    }
    if (!isOpen && wasOpen) {
        setWasOpen(false);
    }

    const handleAddRecipient = () => {
        const trimmed = normalizeEmail(newRecipient);
        if (!trimmed) return;

        if (!isValidEmail(trimmed)) {
            setError('Ingresa un correo válido.');
            return;
        }

        if (safeRecipients.includes(trimmed)) {
            setError('Ese destinatario ya está agregado.');
            return;
        }

        onRecipientsChange([...safeRecipients, trimmed]);
        setNewRecipient('');
        setError(null);
    };

    const handleBulkSave = () => {
        const entries = bulkRecipients
            .split(/[\n,]+/)
            .map(normalizeEmail)
            .filter(Boolean);

        const unique = Array.from(new Set(entries));

        if (unique.length === 0) {
            setError('Agrega al menos un correo válido.');
            return;
        }

        const invalid = unique.find((email) => !isValidEmail(email));
        if (invalid) {
            setError(`Correo inválido: ${invalid}`);
            return;
        }

        onRecipientsChange(unique);
        setShowBulkEditor(false);
        setError(null);
    };

    const handleBulkCancel = () => {
        setBulkRecipients(safeRecipients.join('\n'));
        setShowBulkEditor(false);
        setError(null);
    };

    const handleStartEditRecipient = (index: number) => {
        setEditingIndex(index);
        setEditingValue(safeRecipients[index]);
        setError(null);
    };

    const handleSaveRecipient = () => {
        if (editingIndex === null) return;

        const normalized = normalizeEmail(editingValue);
        if (!normalized) {
            setError('Ingresa un correo válido.');
            return;
        }

        if (!isValidEmail(normalized)) {
            setError('Ingresa un correo válido.');
            return;
        }

        if (safeRecipients.some((email, idx) => idx !== editingIndex && email === normalized)) {
            setError('Ese destinatario ya está agregado.');
            return;
        }

        const updated = [...safeRecipients];
        updated[editingIndex] = normalized;
        onRecipientsChange(updated);
        setEditingIndex(null);
        setEditingValue('');
        setError(null);
    };

    const handleCancelEditRecipient = () => {
        setEditingIndex(null);
        setEditingValue('');
    };

    const MAX_VISIBLE = 9;
    const visibleRecipients = showAllRecipients ? safeRecipients : safeRecipients.slice(0, MAX_VISIBLE);

    const handleRemoveRecipient = (index: number) => {
        const updated = safeRecipients.filter((_, i) => i !== index);
        onRecipientsChange(updated);
    };

    const handleResetMessage = () => {
        if (onResetMessage) {
            onResetMessage();
        } else {
            onMessageChange(defaultMessage);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Envío de Correo</h2>
                    <p className="text-xs text-slate-500 font-medium">Personaliza destinatarios y el mensaje antes de enviar el censo.</p>
                </div>
            }
            icon={<Mail size={20} />}
            size="full"
            headerIconColor="text-blue-600"
        >
            <div className="space-y-6">
                <ModalSection
                    title="Destinatarios"
                    icon={<Users size={16} className="text-blue-600" />}
                    variant="info"
                >
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            {safeRecipients.length > MAX_VISIBLE && !showBulkEditor && (
                                <button
                                    onClick={() => setShowAllRecipients((prev) => !prev)}
                                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-4"
                                >
                                    {showAllRecipients ? 'Ocultar lista' : `Mostrar todos (${safeRecipients.length})`}
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setShowBulkEditor(!showBulkEditor);
                                    setBulkRecipients(safeRecipients.join('\n'));
                                    setError(null);
                                }}
                                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                            >
                                {showBulkEditor ? '← Volver a edición individual' : 'Edición masiva'}
                            </button>
                        </div>
                    </div>

                    {showBulkEditor ? (
                        <div className="space-y-2">
                            <p className="text-[11px] text-slate-500">
                                Pega correos separados por salto de línea o comas. Se eliminarán duplicados automáticamente.
                            </p>
                            <textarea
                                value={bulkRecipients}
                                onChange={(e) => setBulkRecipients(e.target.value)}
                                rows={6}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder="ejemplo1@hospital.cl&#10;ejemplo2@hospital.cl"
                            />
                            <div className="flex gap-2 justify-end">
                                <button
                                    onClick={handleBulkCancel}
                                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleBulkSave}
                                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm shadow-emerald-100"
                                >
                                    Guardar Cambios
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-slate-50/50 rounded-xl border border-slate-100">
                                {safeRecipients.length === 0 && (
                                    <p className="text-[11px] text-slate-400 italic px-2 py-1">No hay destinatarios configurados.</p>
                                )}
                                {visibleRecipients.map((email, index) => (
                                    <div
                                        key={`${email}-${index}`}
                                        className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-full pl-3 pr-1 py-1 text-[11px] font-medium text-slate-700 shadow-sm"
                                    >
                                        {editingIndex === index ? (
                                            <input
                                                type="email"
                                                value={editingValue}
                                                onChange={(e) => setEditingValue(e.target.value)}
                                                onBlur={handleSaveRecipient}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleSaveRecipient();
                                                    }
                                                    if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        handleCancelEditRecipient();
                                                    }
                                                }}
                                                autoFocus
                                                className="text-[11px] px-2 py-0.5 border-none focus:ring-0 bg-transparent w-full font-medium"
                                            />
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => handleStartEditRecipient(index)}
                                                className="text-left focus:outline-none hover:text-blue-600 transition-colors truncate max-w-[150px]"
                                                title={email}
                                            >
                                                {email}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleRemoveRecipient(index)}
                                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                                            aria-label={`Eliminar ${email}`}
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                                {safeRecipients.length > visibleRecipients.length && (
                                    <div className="text-[10px] text-slate-400 px-2 py-1 font-bold italic self-center">
                                        + {safeRecipients.length - visibleRecipients.length} más
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="email"
                                        placeholder="correo@ejemplo.cl"
                                        value={newRecipient}
                                        onChange={(e) => setNewRecipient(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddRecipient()}
                                        className="w-full border border-slate-200 rounded-xl pl-4 pr-10 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    />
                                    <button
                                        onClick={handleAddRecipient}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
                                        title="Agregar"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </div>

                            {isAdminUser && (
                                <div className="border border-blue-100 bg-blue-50/30 rounded-xl p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="text-[11px] font-bold text-blue-800 uppercase tracking-wider">Modo Prueba Administrativa</h4>
                                            <p className="text-[10px] text-blue-600/80 font-medium">Envía el censo únicamente a una dirección de validación.</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={testModeEnabled}
                                                onChange={(e) => onTestModeChange(e.target.checked)}
                                                className="sr-only peer"
                                            />
                                            <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                    </div>
                                    {testModeEnabled && (
                                        <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                            <input
                                                type="email"
                                                placeholder="correo.prueba@hospital.cl"
                                                value={testRecipient}
                                                onChange={(e) => onTestRecipientChange(e.target.value)}
                                                className="w-full border border-blue-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                            />
                                            <p className="text-[9px] text-blue-500 font-bold uppercase tracking-widest italic">⚠️ Envíos globales desactivados</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {error && <p className="text-[11px] text-red-600 mt-2 font-medium px-2">✕ {error}</p>}
                </ModalSection>

                <ModalSection
                    title="Cuerpo del Mensaje"
                    icon={<MessageSquare size={16} className="text-slate-600" />}
                    description="Personaliza el texto que acompañará el archivo del censo."
                >
                    <div className="space-y-3">
                        <textarea
                            value={message}
                            onChange={(e) => onMessageChange(e.target.value)}
                            rows={8}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-h-[200px]"
                            placeholder="Escribe el mensaje aquí..."
                        />
                        <div className="flex justify-end">
                            <button
                                onClick={handleResetMessage}
                                className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-wider transition-all"
                            >
                                <RefreshCw size={12} /> Restablecer Predeterminado
                            </button>
                        </div>
                    </div>
                </ModalSection>

                <div className="flex justify-end pt-2">
                    <button
                        onClick={onClose}
                        className="px-8 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all active:scale-95 shadow-sm"
                    >
                        Cerrar Configuración
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
