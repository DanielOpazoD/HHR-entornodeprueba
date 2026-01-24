import React, { useState, useEffect } from 'react';
import { roleService, UserRoleMap } from '../../services/admin/roleService';
import { useAuth } from '../../context/AuthContext';

const RoleManagementView: React.FC = () => {
    const { role: userRole } = useAuth();
    const [roles, setRoles] = useState<UserRoleMap>({});
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [selectedRole, setSelectedRole] = useState('viewer');
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        loadRoles();
    }, []);

    const loadRoles = async () => {
        try {
            setLoading(true);
            const data = await roleService.getRoles();
            setRoles(data);
        } catch (error) {
            console.error('Error loading roles:', error);
            setMessage({ type: 'error', text: 'Error al cargar roles.' });
        } finally {
            setLoading(false);
        }
    };

    const handleAddRole = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setProcessing(true);
        setMessage(null);

        try {
            await roleService.setRole(email, selectedRole);

            // Attempt to force sync if function is available (optional but good ux)
            try {
                await roleService.forceSyncUser(email, selectedRole);
                setMessage({ type: 'success', text: `Rol ${selectedRole} asignado a ${email} y sincronizado.` });
            } catch (syncError) {
                console.warn('Sync failed (user might not exist yet), but config saved:', syncError);
                setMessage({ type: 'success', text: `Rol configurado. Se aplicará cuando ${email} inicie sesión.` });
            }

            setEmail('');
            await loadRoles();
        } catch (error) {
            console.error('Error adding role:', error);
            setMessage({ type: 'error', text: 'Error al guardar el rol.' });
        } finally {
            setProcessing(false);
        }
    };

    const handleDelete = async (targetEmail: string) => {
        if (!window.confirm(`¿Estás seguro de quitar el rol a ${targetEmail}?`)) return;

        try {
            await roleService.removeRole(targetEmail);
            // Optionally force sync to 'unauthorized' or 'viewer'
            // await roleService.forceSyncUser(targetEmail, 'unauthorized'); 
            await loadRoles();
            setMessage({ type: 'success', text: `Rol eliminado para ${targetEmail}` });
        } catch (error) {
            console.error('Error removing role:', error);
            setMessage({ type: 'error', text: 'Error al eliminar rol.' });
        }
    };

    if (userRole !== 'admin') {
        return <div className="p-8 text-center text-red-600">Acceso Denegado. Solo administradores.</div>;
    }

    return (
        <div className="max-w-4xl mx-auto p-6">
            <h1 className="text-2xl font-bold mb-6 text-gray-800">Gestión de Roles y Permisos</h1>

            {/* Notification */}
            {message && (
                <div className={`p-4 mb-6 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {message.text}
                </div>
            )}

            {/* Add New Role Form */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
                <h2 className="text-lg font-semibold mb-4 text-gray-700">Agregar Nuevo Usuario</h2>
                <form onSubmit={handleAddRole} className="flex flex-col md:flex-row gap-4 align-bottom">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="ejemplo@hospital.cl"
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="w-full md:w-48">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Rol Asignado</label>
                        <select
                            value={selectedRole}
                            onChange={(e) => setSelectedRole(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="viewer">Invitado (Viewer)</option>
                            <option value="nurse_hospital">Enfermería</option>
                            <option value="doctor_urgency">Médico Urgencia</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </div>
                    <div className="flex items-end">
                        <button
                            type="submit"
                            disabled={processing}
                            className={`px-6 py-2 rounded text-white font-medium transition-colors ${processing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            {processing ? 'Guardando...' : 'Asignar Rol'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Roles List */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-700">Usuarios Configurados</h2>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-gray-500">Cargando roles...</div>
                ) : Object.keys(roles).length === 0 ? (
                    <div className="p-8 text-center text-gray-500">No hay roles configurados en la base de datos dinámica.</div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Usuario</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Rol</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {Object.entries(roles).map(([userEmail, role]) => (
                                <tr key={userEmail} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{userEmail}</td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${role === 'admin' ? 'bg-purple-100 text-purple-800' :
                                            role === 'nurse_hospital' ? 'bg-green-100 text-green-800' :
                                                role === 'doctor_urgency' ? 'bg-blue-100 text-blue-800' :
                                                    'bg-gray-100 text-gray-800'
                                            }`}>
                                            {role === 'nurse_hospital' ? 'Enfermería' :
                                                role === 'doctor_urgency' ? 'Médico' :
                                                    role.charAt(0).toUpperCase() + role.slice(1)}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => handleDelete(userEmail)}
                                            className="text-red-500 hover:text-red-700 text-sm font-medium hover:underline"
                                        >
                                            Eliminar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default RoleManagementView;
