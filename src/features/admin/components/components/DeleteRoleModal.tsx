import React from 'react';
import { Trash2, ShieldAlert } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';

interface DeleteRoleModalProps {
    email: string | null;
    processing: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export const DeleteRoleModal: React.FC<DeleteRoleModalProps> = ({
    email,
    processing,
    onClose,
    onConfirm
}) => {
    return (
        <BaseModal
            isOpen={!!email}
            onClose={() => !processing && onClose()}
            closeOnBackdrop={false}
            title="Confirmar Acción Crítica"
            icon={<Trash2 size={24} />}
            headerIconColor="text-rose-500"
            size="md"
        >
            <div className="p-2 space-y-6">
                <div className="bg-rose-50 p-8 rounded-[2.5rem] flex flex-col items-center text-center gap-5 border-2 border-rose-100 shadow-inner">
                    <div className="bg-white p-5 rounded-full shadow-lg shadow-rose-100">
                        <ShieldAlert className="text-rose-500" size={36} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1.5">Revocación de Acceso</p>
                        <h3 className="text-xl font-black text-rose-800 leading-tight">
                            ¿Deseas eliminar a <span className="block underline decoration-rose-200 mt-1">{email}</span>?
                        </h3>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button
                        onClick={onClose}
                        disabled={processing}
                        className="p-5 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all active:scale-95"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={processing}
                        className="p-5 bg-rose-600 hover:bg-rose-700 text-white font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all shadow-xl shadow-rose-100 active:scale-95 flex items-center justify-center gap-2"
                    >
                        {processing ? (
                            <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            'Sí, Borrar'
                        )}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
