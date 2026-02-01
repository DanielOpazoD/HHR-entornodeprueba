import React from 'react';
import { Download, FileText } from 'lucide-react';
import { BaseModal } from './BaseModal';

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
        <BaseModal
            isOpen={true}
            onClose={onClose}
            title={fileName}
            icon={<FileText size={18} />}
            size="full"
            variant="white"
            headerIconColor="text-red-600"
            headerActions={
                onDownload && (
                    <button
                        onClick={onDownload}
                        className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                        title="Descargar"
                    >
                        <Download size={18} />
                    </button>
                )
            }
        >
            <div className="flex flex-col h-[75vh] -m-6">
                {/* PDF Content */}
                <div className="flex-1 bg-slate-100 relative overflow-hidden">
                    <iframe
                        src={`${url}#toolbar=0`}
                        className="w-full h-full border-none"
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
        </BaseModal>
    );
};
