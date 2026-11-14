import { useState, useEffect, useMemo, useCallback } from 'react';
import { roleService, UserRoleMap } from '@/services/admin/roleService';
import { isManagedUserRole, type ManagedUserRole } from '@/shared/access/roleAccessMatrix';
import { createScopedLogger } from '@/services/utils/loggerScope';

const roleManagementLogger = createScopedLogger('RoleManagement');

export const useRoleManagement = () => {
  const [roles, setRoles] = useState<UserRoleMap>({});
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState('viewer');
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isValidEmail = useMemo(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }, [email]);

  const syncNormalizedLegacyClaims = useCallback(
    async (roles: UserRoleMap, migratedLegacyEntries: string[]) => {
      const syncCandidates = migratedLegacyEntries
        .map(migratedEmail => ({
          email: migratedEmail,
          role: roles[migratedEmail],
        }))
        .filter((candidate): candidate is { email: string; role: ManagedUserRole } =>
          isManagedUserRole(candidate.role)
        );

      const results = await Promise.allSettled(
        syncCandidates.map(({ email, role }) => roleService.forceSyncUser(email, role))
      );

      const failedEmails = results.flatMap((result, index) =>
        result.status === 'rejected' ? [syncCandidates[index].email] : []
      );

      if (failedEmails.length > 0) {
        roleManagementLogger.warn('Legacy role claim sync warning', { failedEmails });
      }

      return {
        attempted: syncCandidates.length,
        failedEmails,
      };
    },
    []
  );

  const loadRoles = useCallback(async () => {
    try {
      setLoading(true);
      const snapshot = await roleService.getRolesSnapshot();
      setRoles(snapshot.roles);
      const syncSummary =
        snapshot.migratedLegacyEntries.length > 0
          ? await syncNormalizedLegacyClaims(snapshot.roles, snapshot.migratedLegacyEntries)
          : null;
      setMessage(currentMessage => {
        if (currentMessage || snapshot.migratedLegacyEntries.length === 0) {
          return currentMessage;
        }

        const normalizedCount = snapshot.migratedLegacyEntries.length;
        if (syncSummary && syncSummary.failedEmails.length > 0) {
          return {
            type: 'success',
            text:
              `Se normalizaron ${normalizedCount} registro(s) legacy en config/roles. ` +
              `No se pudo sincronizar el claim de ${syncSummary.failedEmails.length} usuario(s); ` +
              'deben cerrar sesión y volver a entrar o revisar functions.',
          };
        }

        return {
          type: 'success',
          text:
            `Se normalizaron ${normalizedCount} registro(s) legacy en config/roles ` +
            'y se reintentó sincronizar su claim de Firebase.',
        };
      });
    } catch (error) {
      roleManagementLogger.error('Load error', error);
      setMessage({ type: 'error', text: 'Error de conexión con Firestore.' });
    } finally {
      setLoading(false);
    }
  }, [syncNormalizedLegacyClaims]);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  // Success auto-hide
  useEffect(() => {
    if (message?.type !== 'success') return undefined;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const resetForm = useCallback((options: { preserveMessage?: boolean } = {}) => {
    setEmail('');
    setSelectedRole('viewer');
    setEditingEmail(null);
    if (!options.preserveMessage) {
      setMessage(null);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail || processing) return;

    setProcessing(true);
    setMessage(null);

    try {
      let syncWarning: string | null = null;

      if (editingEmail && email !== editingEmail) {
        await roleService.removeRole(editingEmail);
      }

      await roleService.setRole(email, selectedRole);
      try {
        await roleService.forceSyncUser(
          email,
          selectedRole as Parameters<typeof roleService.forceSyncUser>[1]
        );
      } catch (error) {
        roleManagementLogger.warn('Role claim sync warning', error);
        syncWarning =
          ' El rol fue guardado, pero no se pudo sincronizar el claim de Firebase. El usuario debe cerrar sesión y volver a entrar, o revisar despliegue/functions.';
      }

      setMessage({
        type: 'success',
        text:
          (editingEmail
            ? email !== editingEmail
              ? 'Usuario renombrado y actualizado.'
              : 'Rol actualizado correctamente.'
            : `Acceso otorgado a ${email}.`) + (syncWarning || ''),
      });

      resetForm({ preserveMessage: true });
      await loadRoles();
    } catch (error) {
      roleManagementLogger.error('Save error', error);
      setMessage({ type: 'error', text: 'Error al guardar cambios. Verifica tu conexión.' });
    } finally {
      setProcessing(false);
    }
  };

  const handleEdit = useCallback((targetEmail: string, currentRole: string) => {
    if (!isManagedUserRole(currentRole)) {
      setMessage({
        type: 'error',
        text: 'Este rol legacy ya no es editable. Quita el acceso y reasigna un rol canónico.',
      });
      return;
    }

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
      roleManagementLogger.error('Delete error', error);
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
    confirmDelete,
  };
};
