import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { buildCensusEmailBody } from '../../constants/email';

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
    const dialogRef = useRef<HTMLDivElement>(null);

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

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen) {
            dialogRef.current?.focus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-6 outline-none"
                aria-modal="true"
                role="dialog"
            >
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Configuración del envío de correo</h2>
                        <p className="text-sm text-slate-500">Personaliza destinatarios y el mensaje antes de enviar el censo.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                        aria-label="Cerrar"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-6">
                    <section>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-slate-700">Destinatarios</h3>
                            <div className="flex items-center gap-3">
                                {safeRecipients.length > MAX_VISIBLE && !showBulkEditor && (
                                    <button
                                        onClick={() => setShowAllRecipients((prev) => !prev)}
                                        className="text-[11px] font-semibold text-slate-600 hover:text-slate-800"
                                    >
                                        {showAllRecipients ? 'Ocultar lista' : 'Mostrar todos'}
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        setShowBulkEditor(!showBulkEditor);
                                        setBulkRecipients(safeRecipients.join('\n'));
                                        setError(null);
                                    }}
                                    className="text-xs font-semibold text-blue-700 hover:text-blue-800"
                                >
                                    {showBulkEditor ? 'Volver a edición individual' : 'Edición masiva'}
                                </button>
                            </div>
                        </div>
                        {showBulkEditor ? (
                            <div className="space-y-2">
                                <p className="text-xs text-slate-500">
                                    Pega correos separados por salto de línea o comas. Se eliminarán duplicados y se validará cada correo al guardar.
                                </p>
                                <textarea
                                    value={bulkRecipients}
                                    onChange={(e) => setBulkRecipients(e.target.value)}
                                    rows={6}
                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={handleBulkCancel}
                                        className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 text-sm hover:bg-slate-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleBulkSave}
                                        className="px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                                    >
                                        Guardar edición masiva
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                                    {safeRecipients.length === 0 && (
                                        <p className="text-xs text-slate-500 col-span-3 md:col-span-4">No hay destinatarios configurados. Agrega los correos a los que deseas enviar el censo.</p>
                                    )}
                                    {visibleRecipients.map((email, index) => (
                                        <div
                                            key={`${email}-${index}`}
                                            className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-full px-2 py-1 text-[10px] leading-tight text-slate-700"
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
                                                    className="text-[11px] px-2 py-1 border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white w-full"
                                                />
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleStartEditRecipient(index)}
                                                    className="text-left px-1 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-md truncate"
                                                    title={email}
                                                >
                                                    {email}
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleRemoveRecipient(index)}
                                                className="ml-1 p-1 text-red-600 hover:text-red-700 rounded-full hover:bg-white"
                                                aria-label={`Eliminar ${email}`}
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    {safeRecipients.length > visibleRecipients.length && (
                                        <div className="text-[11px] text-slate-500 px-2 py-1">+ {safeRecipients.length - visibleRecipients.length} ocultos</div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-1 w-full flex-wrap">
                                    <input
                                        type="email"
                                        placeholder="nuevo@correo.cl"
                                        value={newRecipient}
                                        onChange={(e) => setNewRecipient(e.target.value)}
                                        className="flex-1 min-w-[260px] sm:min-w-[340px] border border-slate-200 rounded-lg px-3 py-2 text-[12px] leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <button
                                        onClick={handleAddRecipient}
                                        className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[12px] font-semibold"
                                    >
                                        <Plus size={12} /> Agregar
                                    </button>
                                </div>

                                {isAdminUser && (
                                    <div className="border border-slate-200 bg-slate-50 rounded-lg p-3 space-y-2">
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                            <div>
                                                <h4 className="text-xs font-semibold text-slate-700">Modo prueba (solo administrador)</h4>
                                                <p className="text-[11px] text-slate-500">Envía un correo manual a una dirección para validar el envío.</p>
                                            </div>
                                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                                <input
                                                    type="checkbox"
                                                    checked={testModeEnabled}
                                                    onChange={(e) => onTestModeChange(e.target.checked)}
                                                    className="h-4 w-4 accent-blue-600"
                                                />
                                                Activar modo prueba
                                            </label>
                                        </div>
                                        {testModeEnabled && (
                                            <div className="space-y-2">
                                                <input
                                                    type="email"
                                                    placeholder="correo.prueba@hospital.cl"
                                                    value={testRecipient}
                                                    onChange={(e) => onTestRecipientChange(e.target.value)}
                                                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                                <p className="text-[11px] text-slate-500">Se enviará únicamente a este correo mientras el modo prueba esté activo.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
                    </section>

                    <section>
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-700">Mensaje</h3>
                                <p className="text-xs text-slate-500">Puedes editar el texto que se enviará junto al censo diario.</p>
                            </div>
                            <button
                                onClick={handleResetMessage}
                                className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 font-semibold"
                                title="Restablecer mensaje predeterminado"
                            >
                                <RefreshCw size={12} /> Restablecer
                            </button>
                        </div>
                        <textarea
                            value={message}
                            onChange={(e) => onMessageChange(e.target.value)}
                            rows={10}
                            className={clsx(
                                'w-full border rounded-lg px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                                'border-slate-200 min-h-[240px]'
                            )}
                        />
                    </section>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                    <button
                        onClick={onClose}
                        className="px-3.5 py-1.5 rounded-md border border-slate-200 text-slate-700 text-sm hover:bg-slate-50"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
};

