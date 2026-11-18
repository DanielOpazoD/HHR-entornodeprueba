import React from 'react';
import { BellRing, MessageSquare } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AccessRestricted } from './internal/AccessRestricted';
import { AdminTabsShell } from './internal/AdminTabsShell';
import { ReminderAdminView } from '@/features/reminders/public';
import { WhatsAppIntegrationView } from '@/features/whatsapp/public';
import { canAccessAppModuleRoute } from '@/shared/access/operationalAccessPolicy';

// Communications view — admin-only page grouping staff-facing communications:
//   - "Avisos al personal" (Reminders)   ← was REMINDERS menu item
//   - "WhatsApp"           (integration) ← was WHATSAPP menu item
// REMINDERS and WHATSAPP module slots remain accessible via direct URL as fallback.
export const CommunicationsView: React.FC = () => {
  const { role } = useAuth();

  if (!canAccessAppModuleRoute({ role, module: 'COMMUNICATIONS' })) {
    return <AccessRestricted />;
  }

  return (
    <AdminTabsShell
      title="Comunicación"
      icon={MessageSquare}
      tabs={[
        {
          id: 'REMINDERS',
          label: 'Avisos al personal',
          icon: BellRing,
          color: 'text-amber-400',
          content: <ReminderAdminView />,
        },
        {
          id: 'WHATSAPP',
          label: 'WhatsApp',
          icon: MessageSquare,
          color: 'text-emerald-400',
          content: <WhatsAppIntegrationView />,
        },
      ]}
    />
  );
};
