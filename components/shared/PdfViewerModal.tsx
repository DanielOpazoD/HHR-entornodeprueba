import React from 'react';
import { X, Download, Maximize2 } from 'lucide-react';

interface PdfViewerModalProps {
    fileName: string;
    url: string;
    onClose: () => void;
    onDownload?: () => void;
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
    fileName,
    url,
    onClose,
    onDownload
}) => {
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-50 text-red-600 rounded-xl">
                            <Maximize2 size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 leading-tight truncate max-w-md">
                                {fileName}
                            </h3>
                            <p className="text-xs text-slate-500 uppercase font-semibold tracking-wider">
                                Previsualización de Documento PDF
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {onDownload && (
                            <button
                                onClick={onDownload}
                                className="p-2.5 text-slate-500 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-all"
                                title="Descargar"
                            >
                                <Download size={20} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* PDF Content */}
                <div className="flex-1 bg-slate-100 relative overflow-hidden">
                    <iframe
                        src={`${url}#toolbar=0`}
                        className="w-full h-full border-none shadow-inner"
                        title={fileName}
                    />
                </div>

                {/* Footer / Status */}
                <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 shrink-0 flex justify-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">
                        Vista protegida • Hospital Hanga Roa
                    </p>
                </div>
            </div>
        </div>
    );
};
