import { useState, useEffect, useMemo, useCallback } from 'react';
import { roleService, UserRoleMap } from '@/services/admin/roleService';

export const useRoleManagement = () => {
    const [roles, setRoles] = useState<UserRoleMap>({});
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [selectedRole, setSelectedRole] = useState('viewer');
    const [editingEmail, setEditingEmail] = useState<string | null>(null);
    const [processing, setProcessing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const isValidEmail = useMemo(() => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }, [email]);

    const loadRoles = useCallback(async () => {
        try {
            setLoading(true);
            const data = await roleService.getRoles();
            setRoles(data);
        } catch (error) {
            console.error('[RoleManagement] Load error:', error);
            setMessage({ type: 'error', text: 'Error de conexión con Firestore.' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadRoles();
    }, [loadRoles]);

    // Success auto-hide
    useEffect(() => {
        if (message?.type === 'success') {
            const timer = setTimeout(() => setMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    const resetForm = useCallback(() => {
        setEmail('');
        setSelectedRole('viewer');
        setEditingEmail(null);
        setMessage(null);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidEmail || processing) return;

        setProcessing(true);
        setMessage(null);

        try {
            if (editingEmail && email !== editingEmail) {
                await roleService.removeRole(editingEmail);
            }

            await roleService.setRole(email, selectedRole);

            setMessage({
                type: 'success',
                text: editingEmail
                    ? (email !== editingEmail ? 'Usuario renombrado y actualizado.' : 'Rol actualizado correctamente.')
                    : `Acceso otorgado a ${email}.`
            });

            resetForm();
            await loadRoles();
        } catch (error) {
            console.error('[RoleManagement] Save error:', error);
            setMessage({ type: 'error', text: 'Error al guardar cambios. Verifica tu conexión.' });
        } finally {
            setProcessing(false);
        }
    };

    const handleEdit = useCallback((targetEmail: string, currentRole: string) => {
        setEmail(targetEmail);
        setSelectedRole(currentRole);
        setEditingEmail(targetEmail);
        setMessage(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleDeleteClick = useCallback((targetEmail: string) => {
        setDeleteConfirm(targetEmail);
    }, []);

    const confirmDelete = async () => {
        if (!deleteConfirm) return;

        setProcessing(true);
        try {
            await roleService.removeRole(deleteConfirm);
            setMessage({ type: 'success', text: `Acceso eliminado para ${deleteConfirm}` });
            setDeleteConfirm(null);
            await loadRoles();
        } catch (error) {
            console.error('[RoleManagement] Delete error:', error);
            setMessage({ type: 'error', text: 'Error al eliminar. Revisa tu perfil de Administrador.' });
        } finally {
            setProcessing(false);
        }
    };

    return {
        roles,
        loading,
        email,
        setEmail,
        selectedRole,
        setSelectedRole,
        editingEmail,
        processing,
        message,
        setMessage,
        deleteConfirm,
        setDeleteConfirm,
        isValidEmail,
        loadRoles,
        handleSubmit,
        handleEdit,
        resetForm,
        handleDeleteClick,
        confirmDelete
    };
};
