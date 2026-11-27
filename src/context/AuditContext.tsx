/**
 * Audit Context
 * Provides audit logging functionality throughout the app with user context.
 */

import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { useAudit, type AuditLoggers } from '@/hooks/useAudit';
import { useAuth, type AuthUser } from '@/context/authContextCore';
import { ANONYMOUS_AUDIT_ACTOR } from '@/domain/audit/auditActorPolicy';

export { ANONYMOUS_AUDIT_ACTOR };

export const resolveAuditActor = (currentUser: AuthUser | null): string => {
  if (!currentUser) return ANONYMOUS_AUDIT_ACTOR;
  if (currentUser.email) return currentUser.email;
  if (currentUser.uid) return currentUser.uid;
  return ANONYMOUS_AUDIT_ACTOR;
};

interface AuditContextValue extends AuditLoggers {
  /** Who the events are written as (`resolveAuditActor`). */
  userId: string;
}

const AuditContext = createContext<AuditContextValue | undefined>(undefined);

interface AuditProviderProps {
  children: ReactNode;
}

export const AuditProvider: React.FC<AuditProviderProps> = ({ children }) => {
  const { currentUser } = useAuth();
  const userId = useMemo(() => resolveAuditActor(currentUser), [currentUser]);
  const auditFunctions = useAudit(userId);
  const value = useMemo(() => ({ ...auditFunctions, userId }), [auditFunctions, userId]);

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
};

export const useAuditContext = (): AuditContextValue => {
  const context = useContext(AuditContext);
  if (!context) {
    throw new Error('useAuditContext must be used within an AuditProvider');
  }
  return context;
};
