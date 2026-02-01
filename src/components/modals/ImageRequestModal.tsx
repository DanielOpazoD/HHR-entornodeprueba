import React, { useState, useEffect } from 'react';
import { Camera, ClipboardCheck, Printer, FileText, Settings, Save, ChevronRight, MousePointer2 } from 'lucide-react';
import { PatientData } from '@/types';
import { BaseModal } from '@/components/shared/BaseModal';
import { useImageRequest, SurveyData } from '@/hooks/useImageRequest';
import { IMAGE_EXAM_CATEGORIES } from '@/constants/imageExamCategories';
import { PrintTemplateConfig, PrintField } from '@/types/printTemplates';
import { PrintTemplateRepository } from '@/services/repositories/PrintTemplateRepository';
import { mapSourceToValue } from '@/services/utils/printMapper';
import { DEFAULT_TEMPLATE_SOLICITUD, DEFAULT_TEMPLATE_ENCUESTA } from '@/constants/defaultPrintTemplates';
import clsx from 'clsx';

interface ImageRequestModalProps {
    isOpen: boolean;
    onClose: () => void;
    patient: PatientData;
    bedName: string;
}

const PRINT_STYLES = `
@media print {
    @page { margin: 0; size: A4; }
    body * { visibility: hidden; }
    #printable-form, #printable-form * { visibility: visible; }
    #printable-form {
        position: fixed;
        left: 0;
        top: 0;
        width: 210mm;
        height: 297mm;
        background: white!important;
        margin: 0!important;
        padding: 0!important;
    }
    .print\\:hidden { display: none!important; }
}
`;

export const ImageRequestModal: React.FC<ImageRequestModalProps> = ({ isOpen, onClose, patient, bedName }) => {
    const [activeTab, setActiveTab] = useState<'solicitud' | 'encuesta'>('solicitud');
    const [showPreview, setShowPreview] = useState(false);
    const [isDesignMode, setIsDesignMode] = useState(false);
    const [config, setConfig] = useState<PrintTemplateConfig | null>(null);
    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const {
        selectedExams,
        contrastMode,
        procedencia,
        prevision,
        survey,
        setProcedencia,
        setPrevision,
        updateSurvey,
        toggleEnfermedad,
        toggleExam,
        setContrast,
        handlePrintSolicitud,
        handlePrintEncuesta,
        manualValues,
        updateManualValue
    } = useImageRequest({ patient, isOpen });

    // Load configuration from Firebase
    useEffect(() => {
        if (!isOpen) return;

        const templateId = activeTab === 'solicitud' ? 'solicitud_imagenologia' : 'encuesta_contraste_tac';
        const unsubscribe = PrintTemplateRepository.subscribe(templateId, (loadedConfig) => {
            if (loadedConfig) {
                setConfig(loadedConfig);
            } else {
                // Fallback to default if not in DB
                setConfig(activeTab === 'solicitud' ? DEFAULT_TEMPLATE_SOLICITUD : DEFAULT_TEMPLATE_ENCUESTA);
            }
        });

        return () => unsubscribe();
    }, [isOpen, activeTab]);

    const handleSaveConfig = async () => {
        if (!config) return;
        setIsSaving(true);
        try {
            await PrintTemplateRepository.saveTemplate(config);
            setIsDesignMode(false);
        } catch (_error) {
            alert('Error al guardar la configuración');
        } finally {
            setIsSaving(false);
        }
    };

    const updateField = (fieldId: string, updates: Partial<PrintField>) => {
        if (!config) return;
        setConfig({
            ...config,
            fields: config.fields.map((f: PrintField) => f.id === fieldId ? { ...f, ...updates } : f)
        });
    };

    const handlePrint = () => {
        if (activeTab === 'solicitud') {
            handlePrintSolicitud();
        } else {
            handlePrintEncuesta();
        }
    };

    // Helper to render the overlay content
    const renderOverlayFields = (isDesign: boolean) => {
        if (!config) return null;

        return config.fields.map((field: PrintField) => {
            const value = mapSourceToValue(field.dataSource, {
                patient,
                survey,
                bedName,
                prevision,
                selectedExams,
                manualValues
            }, field.id);

            const isSelected = selectedFieldId === field.id;

            return (
                <div
                    key={field.id}
                    onClick={(e) => {
                        if (isDesign) {
                            e.stopPropagation();
                            setSelectedFieldId(field.id);
                        }
                    }}
                    className={clsx(
                        "absolute cursor-default pointer-events-none",
                        isDesign && "pointer-events-auto border border-dashed border-transparent hover:border-indigo-400 hover:bg-indigo-50/30",
                        isDesign && isSelected && "border-indigo-600 bg-indigo-100/30 ring-2 ring-indigo-600/20"
                    )}
                    style={{
                        top: `${field.y}mm`,
                        left: `${field.x}mm`,
                        width: field.width ? `${field.width}mm` : 'auto',
                        fontSize: `${field.fontSize}pt`,
                        fontWeight: field.fontWeight === 'black' ? 900 : (field.fontWeight === 'bold' ? 700 : 400),
                        textAlign: field.alignment,
                        color: field.color || 'black',
                        whiteSpace: field.width ? 'normal' : 'nowrap',
                        lineHeight: 1.2
                    }}
                >
                    {value || (isDesign ? `[${field.label}]` : '')}
                </div>
            );
        });
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            printable={true}
            title={
                <div className="flex items-center justify-between w-full pr-8">
                    <div className="flex items-center gap-2">
                        <Camera size={22} className="text-indigo-600" />
                        <span className="text-lg font-bold">Solicitud de Imagenología</span>
                    </div>
                    <div className="flex items-center gap-2 pr-8 print:hidden">
                        <button
                            onClick={handlePrint}
                            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-sm font-bold transition-all shadow-md active:scale-95 group"
                        >
                            <Printer size={18} className="group-hover:rotate-12 transition-transform" />
                            <span>Imprimir {activeTab === 'solicitud' ? 'Solicitud' : 'Encuesta'}</span>
                        </button>
                    </div>
                </div>
            }
            size="full"
        >
            <div className="flex flex-col gap-4 h-full relative">
                <div className="flex items-center justify-between print:hidden shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                            <button
                                onClick={() => setActiveTab('solicitud')}
                                className={clsx(
                                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
                                    activeTab === 'solicitud' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:bg-white/50"
                                )}
                            >
                                <ClipboardCheck size={16} />
                                Solicitud de Examen
                            </button>
                            <button
                                onClick={() => setActiveTab('encuesta')}
                                className={clsx(
                                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
                                    activeTab === 'encuesta' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:bg-white/50"
                                )}
                            >
                                <FileText size={16} />
                                Encuesta Contraste
                            </button>
                        </div>

                        <div className="h-4 w-px bg-slate-200 mx-2" />

                        <button
                            onClick={() => {
                                setIsDesignMode(!isDesignMode);
                                if (!isDesignMode) setShowPreview(true);
                            }}
                            className={clsx(
                                "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border shadow-sm",
                                isDesignMode
                                    ? "bg-amber-500 border-amber-600 text-white"
                                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                            )}
                        >
                            <Settings size={14} />
                            {isDesignMode ? 'Salir Modo Diseño' : 'Configurar Planilla'}
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {isDesignMode && (
                            <button
                                onClick={handleSaveConfig}
                                disabled={isSaving}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
                            >
                                {isSaving ? 'Guardando...' : <><Save size={14} /> Guardar Configuración</>}
                            </button>
                        )}
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className={clsx(
                                "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm",
                                showPreview && !isDesignMode
                                    ? "bg-indigo-600 border-indigo-600 text-white"
                                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                            )}
                        >
                            <FileText size={16} />
                            {showPreview ? 'Editar Datos' : 'Ver Reflejo Fiel'}
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-auto bg-slate-50 rounded-2xl border border-slate-200 p-6 print:hidden">
                    {showPreview ? (
                        <div className="flex gap-6 items-start h-full">
                            <div className={clsx(
                                "bg-white shadow-xl rounded-xl border border-slate-300 overflow-hidden transform origin-top ring-8 ring-slate-200/50 flex-1 h-fit transition-all duration-300",
                                isDesignMode ? "scale-[0.7]" : "scale-[0.85] mx-auto"
                            )}>
                                <div className="relative w-[210mm] h-[297mm] mx-auto bg-white" onClick={() => isDesignMode && setSelectedFieldId(null)}>
                                    <img
                                        src={config?.backgroundUrl || "/images/forms/solicitud_imagenologia.png"}
                                        className="absolute inset-0 w-full h-full object-contain"
                                        alt="Preview"
                                    />
                                    {renderOverlayFields(isDesignMode)}
                                </div>
                            </div>

                            {isDesignMode && config && (
                                <div className="w-[350px] bg-white border border-slate-200 rounded-2xl shadow-sm h-full flex flex-col shrink-0">
                                    <div className="p-4 border-b border-slate-100 bg-amber-50 rounded-t-2xl">
                                        <div className="flex items-center gap-2 text-amber-700 font-black text-xs uppercase tracking-widest">
                                            <Settings size={14} />
                                            Editor de Planilla
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-auto p-4 space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Seleccionar Campo</label>
                                            <div className="grid gap-1">
                                                {config.fields.map((field: PrintField) => (
                                                    <button
                                                        key={field.id}
                                                        onClick={() => setSelectedFieldId(field.id)}
                                                        className={clsx(
                                                            "flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all",
                                                            selectedFieldId === field.id ? "bg-indigo-600 text-white shadow-md translate-x-1" : "hover:bg-slate-50 text-slate-600"
                                                        )}
                                                    >
                                                        <span>{field.label}</span>
                                                        {selectedFieldId === field.id && <ChevronRight size={14} />}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {selectedFieldId && (
                                            <div className="pt-6 border-t border-slate-100 space-y-4 animate-in fade-in slide-in-from-right-2">
                                                <div className="flex items-center gap-2 text-indigo-600 font-black text-xs uppercase tracking-widest mb-4">
                                                    <MousePointer2 size={14} />
                                                    Propiedades: {config.fields.find((f: PrintField) => f.id === selectedFieldId)?.label}
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-slate-400">Posición X (mm)</label>
                                                        <input
                                                            type="number"
                                                            value={config.fields.find((f: PrintField) => f.id === selectedFieldId)?.x || 0}
                                                            onChange={e => updateField(selectedFieldId, { x: parseFloat(e.target.value) || 0 })}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-slate-400">Posición Y (mm)</label>
                                                        <input
                                                            type="number"
                                                            value={config.fields.find((f: PrintField) => f.id === selectedFieldId)?.y || 0}
                                                            onChange={e => updateField(selectedFieldId, { y: parseFloat(e.target.value) || 0 })}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-slate-400">Tam. Fuente (pt)</label>
                                                        <input
                                                            type="number"
                                                            value={config.fields.find((f: PrintField) => f.id === selectedFieldId)?.fontSize || 0}
                                                            onChange={e => updateField(selectedFieldId, { fontSize: parseFloat(e.target.value) || 0 })}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-slate-400">Ancho (mm)</label>
                                                        <input
                                                            type="number"
                                                            value={config.fields.find((f: PrintField) => f.id === selectedFieldId)?.width || 0}
                                                            onChange={e => updateField(selectedFieldId, { width: parseFloat(e.target.value) || undefined })}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                            placeholder="Auto"
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black uppercase text-slate-400">Peso Fuente</label>
                                                    <div className="flex gap-2">
                                                        {['normal', 'bold', 'black'].map(w => (
                                                            <button
                                                                key={w}
                                                                onClick={() => updateField(selectedFieldId, { fontWeight: w as PrintField['fontWeight'] })}
                                                                className={clsx(
                                                                    "flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all border",
                                                                    config.fields.find((f: PrintField) => f.id === selectedFieldId)?.fontWeight === w
                                                                        ? "bg-indigo-50 border-indigo-200 text-indigo-600"
                                                                        : "bg-white border-slate-100 text-slate-500"
                                                                )}
                                                            >
                                                                {w}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {!selectedFieldId && (
                                        <div className="p-8 text-center space-y-2 opacity-40">
                                            <MousePointer2 size={32} className="mx-auto text-slate-300" />
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Selecciona un campo para editar sus coordenadas</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {activeTab === 'solicitud' ? (
                                <div className="grid grid-cols-12 gap-6">
                                    {/* Metadata Column */}
                                    <div className="col-span-12 lg:col-span-4 space-y-6">
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                                            <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información de la Solicitud</h3>
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Procedencia</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {['Policlínico', 'Hospitalizado', 'Urgencia'].map(opt => (
                                                            <button
                                                                key={opt}
                                                                onClick={() => setProcedencia(opt)}
                                                                className={clsx(
                                                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                                                    procedencia === opt ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                                                )}
                                                            >
                                                                {opt}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">Previsión</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {['FONASA', 'ISAPRE', 'PRAIS'].map(opt => (
                                                            <button
                                                                key={opt}
                                                                onClick={() => setPrevision(opt)}
                                                                className={clsx(
                                                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                                                    prevision === opt ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                                                )}
                                                            >
                                                                {opt}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-medical-50 p-4 rounded-xl border border-medical-100 shadow-sm space-y-2">
                                            <h4 className="text-[10px] font-black uppercase text-medical-800">Paciente Seleccionado</h4>
                                            <p className="text-sm font-bold text-medical-900">{patient.patientName}</p>
                                            <p className="text-xs text-medical-700">RUT: {patient.rut} | Cama: {bedName}</p>
                                        </div>
                                    </div>

                                    {/* Exams Column */}
                                    <div className="col-span-12 lg:col-span-8 space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {IMAGE_EXAM_CATEGORIES.map(category => (
                                                <div key={category.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                                                    <div className="bg-slate-50 px-3 py-2 border-b border-slate-100">
                                                        <span className="text-xs font-black uppercase text-slate-600">{category.name}</span>
                                                    </div>
                                                    <div className="p-2 space-y-1 flex-1 overflow-auto max-h-[400px]">
                                                        {category.exams.map(exam => (
                                                            <div key={exam} className="group">
                                                                <label className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedExams.has(exam)}
                                                                        onChange={() => toggleExam(exam)}
                                                                        className="mt-1 accent-indigo-600"
                                                                    />
                                                                    <div className="flex-1">
                                                                        <span className={clsx("text-xs transition-all", selectedExams.has(exam) ? "font-bold text-indigo-600" : "text-slate-600")}>{exam}</span>
                                                                        {selectedExams.has(exam) && category.name === 'Scanner (TAC)' && !['PIELOTAC', 'UROTAC', 'ANGIOTAC'].some(key => exam.includes(key)) && !exam.includes('COL.') && !exam.includes('ADICIONAL') && (
                                                                            <div className="mt-2 flex flex-col gap-1.5 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                                                                                {['CON CONTRASTE', 'SIN CONTRASTE'].map(mode => (
                                                                                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                                                                                        <input
                                                                                            type="radio"
                                                                                            name={`contrast-${exam}`}
                                                                                            checked={contrastMode[exam] === mode}
                                                                                            onChange={() => setContrast(exam, mode as 'CON CONTRASTE' | 'SIN CONTRASTE')}
                                                                                            className="accent-indigo-600 scale-90"
                                                                                        />
                                                                                        <span className="text-[10px] font-bold text-indigo-700">{mode}</span>
                                                                                    </label>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </label>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="max-w-4xl mx-auto space-y-6">
                                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-8">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-4">
                                                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Información Adicional</h3>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-slate-500">Teléfono de Contacto</label>
                                                        <input type="text" value={survey.telefono} onChange={e => updateSurvey('telefono', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black uppercase text-slate-500">Peso (kg)</label>
                                                        <input type="text" value={survey.peso} onChange={e => updateSurvey('peso', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black uppercase text-slate-500">Médico Tratante</label>
                                                    <input type="text" value={survey.medicoTratante} onChange={e => updateSurvey('medicoTratante', e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <h3 className="font-bold text-slate-800 border-b border-slate-100 pb-2">Diagnóstico para el examen</h3>
                                                <textarea
                                                    value={survey.diagnostico}
                                                    onChange={e => updateSurvey('diagnostico', e.target.value)}
                                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 min-h-[120px] resize-none"
                                                    placeholder="Describa el diagnóstico o motivo del examen..."
                                                />
                                            </div>
                                        </div>

                                        {/* Manual Fields Section */}
                                        {config && config.fields.some(f => f.type === 'manual') && (
                                            <div className="pt-4 border-t border-slate-100 space-y-4">
                                                <h3 className="font-bold text-slate-800">Campos Adicionales del Formulario</h3>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {config.fields.filter(f => f.type === 'manual').map((field: PrintField) => (
                                                        <div key={field.id} className="space-y-1">
                                                            <label className="text-[10px] font-black uppercase text-slate-500">{field.label}</label>
                                                            <input
                                                                type="text"
                                                                value={manualValues[field.id] || ''}
                                                                onChange={e => updateManualValue(field.id, e.target.value)}
                                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20"
                                                                placeholder={`Escriba ${field.label}...`}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-6 pt-4 border-t border-slate-100">
                                            <h3 className="font-bold text-slate-800">Preguntas de Seguridad</h3>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div className="space-y-4">
                                                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                                        <span className="text-sm font-bold text-slate-700 uppercase">¿HA SIDO OPERADO?</span>
                                                        <div className="flex gap-2">
                                                            {['Si', 'No'].map(opt => (
                                                                <button
                                                                    key={opt}
                                                                    onClick={() => updateSurvey('operado', opt as 'Si' | 'No')}
                                                                    className={clsx(
                                                                        "px-4 py-1.5 rounded-lg text-xs font-bold transition-all border",
                                                                        survey.operado === opt ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-slate-200 text-slate-600"
                                                                    )}
                                                                >
                                                                    {opt}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    {survey.operado === 'Si' && (
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-black uppercase text-slate-500">Indique tipo de operación</label>
                                                            <input type="text" value={survey.operadoDetalles} onChange={e => updateSurvey('operadoDetalles', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="space-y-3">
                                                    <label className="text-[10px] font-black uppercase text-slate-500">¿Posee alguna de estas Enfermedades?</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {['Hipertensión Arterial', 'Asma', 'Diabetes', 'Enfermedad Renal', 'Cáncer', 'Mieloma Múltiple'].map(enf => (
                                                            <label key={enf} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                                                                <input type="checkbox" checked={survey.enfermedades.includes(enf)} onChange={() => toggleEnfermedad(enf)} className="accent-indigo-600" />
                                                                <span className="text-xs font-bold text-slate-600">{enf}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {[
                                                    { id: 'creatinina', label: '¿Posee nivel de Creatinina?' },
                                                    { id: 'alergias', label: '¿Posee algún tipo de alergia?' },
                                                    { id: 'examenesAnterioresContraste', label: '¿Se ha realizado exámenes con Contraste Yodado?' },
                                                    { id: 'reaccionAdversaContraste', label: '¿Presentó reacción alérgica al Contraste?' },
                                                    { id: 'premedicacion', label: '¿Se le ha administrado Premedicación?' }
                                                ].map(item => (
                                                    <div key={item.id} className="flex items-center justify-between p-3 border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors">
                                                        <span className="text-xs font-bold text-slate-700 uppercase">{item.label}</span>
                                                        <div className="flex gap-2">
                                                            {['Si', 'No'].map(opt => (
                                                                <button
                                                                    key={opt}
                                                                    onClick={() => updateSurvey(item.id as keyof SurveyData, opt as SurveyData[keyof SurveyData])}
                                                                    className={clsx(
                                                                        "px-3 py-1 rounded-lg text-xs font-bold transition-all border",
                                                                        survey[item.id as keyof SurveyData] === opt ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600"
                                                                    )}
                                                                >
                                                                    {opt}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="flex items-center gap-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                                                <span className="text-sm font-black text-indigo-900 uppercase">AYUNO:</span>
                                                <div className="flex items-center gap-2">
                                                    <input type="text" value={survey.horasAyuno} onChange={e => updateSurvey('horasAyuno', e.target.value)} className="w-16 bg-white border border-indigo-200 rounded-lg px-2 py-1 text-center font-bold text-indigo-600 outline-none" />
                                                    <span className="text-sm font-bold text-indigo-700 uppercase">Horas</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Hidden Printable Area (Faithful Reflection Overlay) */}
                <div id="printable-form" className="hidden print:block fixed inset-0 bg-white">
                    <div className="relative w-[210mm] h-[297mm] mx-auto overflow-hidden bg-white">
                        <img
                            src={config?.backgroundUrl || (activeTab === 'solicitud' ? "/images/forms/solicitud_imagenologia.png" : "/images/forms/encuesta_contraste_tac.png")}
                            className="absolute inset-0 w-full h-full object-contain"
                            alt="Fondo"
                        />
                        {renderOverlayFields(false)}
                    </div>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
        </BaseModal>
    );
};
