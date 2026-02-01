import React from 'react';
import { Edit2, UserPlus, X, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';

interface RoleFormProps {
    email: string;
    setEmail: (email: string) => void;
    selectedRole: string;
    setSelectedRole: (role: string) => void;
    editingEmail: string | null;
    processing: boolean;
    isValidEmail: boolean;
    onReset: () => void;
    onSubmit: (e: React.FormEvent) => void;
}

export const RoleForm: React.FC<RoleFormProps> = ({
    email,
    setEmail,
    selectedRole,
    setSelectedRole,
    editingEmail,
    processing,
    isValidEmail,
    onReset,
    onSubmit
}) => {
    return (
        <div className={`bg-white p-8 rounded-[2rem] shadow-2xl transition-all duration-500 border-2 ${editingEmail ? 'border-indigo-500 shadow-indigo-100/50' : 'border-slate-100'
            }`}>
            <div className="flex items-center justify-between mb-8">
                <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                    {editingEmail ? <Edit2 size={24} className="text-indigo-600" /> : <UserPlus size={24} className="text-indigo-600" />}
                    {editingEmail ? 'Editar Usuario' : 'Nuevo Acceso'}
                </h2>
                {editingEmail && (
                    <button
                        onClick={onReset}
                        className="text-slate-300 hover:text-rose-500 transition-all hover:rotate-90 duration-300 p-1"
                        title="Cancelar edición"
                    >
                        <X size={24} />
                    </button>
                )}
            </div>

            <form onSubmit={onSubmit} className="space-y-6">
                <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 px-1">
                        Correo Institucional
                    </label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value.toLowerCase().trim())}
                        placeholder="usuario@dominio.cl"
                        autoFocus
                        className={`w-full p-4 border-2 rounded-2xl focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all font-bold text-slate-700 placeholder:text-slate-200 ${editingEmail ? 'border-indigo-400 bg-indigo-50/10' : 'border-slate-100 focus:border-indigo-500 bg-white'
                            }`}
                    />
                    {email && !isValidEmail && (
                        <p className="text-[11px] text-rose-500 mt-2 px-1 font-bold flex items-center gap-1.5 animate-pulse">
                            <AlertCircle size={14} /> Correo incompleto o inválido
                        </p>
                    )}
                </div>

                <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 px-1">
                        Nivel de Permisos
                    </label>
                    <div className="relative">
                        <select
                            value={selectedRole}
                            disabled={processing}
                            onChange={(e) => setSelectedRole(e.target.value)}
                            className="w-full p-4 border-2 border-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-50/50 focus:border-indigo-500 outline-none bg-white transition-all cursor-pointer font-bold text-slate-700 appearance-none shadow-sm"
                        >
                            <option value="viewer">🎨 Invitado (Solo Lectura)</option>
                            <option value="nurse_hospital">👩‍⚕️ Enfermería Hospitalaria</option>
                            <option value="doctor_urgency">🩺 Médico de Urgencia</option>
                            <option value="admin">🔑 Administrador Total</option>
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                            <RefreshCw size={18} />
                        </div>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={processing || !isValidEmail}
                    className={`w-full p-5 rounded-2xl text-white font-black uppercase tracking-widest text-xs transition-all shadow-xl active:scale-[0.96] flex items-center justify-center gap-3 ${processing || !isValidEmail
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                        : editingEmail
                            ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'
                            : 'bg-slate-900 hover:bg-black shadow-slate-200'
                        }`}
                >
                    {processing ? (
                        <div className="h-5 w-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    ) : (
                        <>
                            {editingEmail ? <CheckCircle2 size={20} /> : <UserPlus size={20} />}
                            {editingEmail ? 'Guardar Cambios' : 'Conceder Acceso'}
                        </>
                    )}
                </button>
            </form>
        </div>
    );
};
