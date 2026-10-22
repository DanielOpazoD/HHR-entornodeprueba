import { useState, useCallback } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  getDefaultTemplates,
  getWhatsAppConfig,
  getMessageTemplates,
} from '@/services/integrations/whatsapp/whatsappService';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import { createScopedLogger } from '@/services/utils/loggerScope';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { resolveHandoffShareLinkPlan } from '@/hooks/controllers/handoffShareLinkController';
import { buildManualMedicalHandoffMessageModel } from '@/hooks/controllers/manualMedicalHandoffMessageController';

/**
 * useHandoffCommunication Hook
 *
 * Handles WhatsApp integrations and link sharing for handoffs.
 */
const handoffCommunicationLogger = createScopedLogger('useHandoffCommunication');

/**
 * Configured handoff template, or the standard one when the stored list cannot be read: a
 * handoff should still go out, but the caller must say it did not use the configured text.
 */
const resolveHandoffTemplate = async () => {
  try {
    const templates = await getMessageTemplates();
    return { template: templates.find(t => t.type === 'handoff'), usedStandard: false };
  } catch (error) {
    handoffCommunicationLogger.warn('Handoff templates unavailable; using the standard one', error);
    return { template: getDefaultTemplates().find(t => t.type === 'handoff'), usedStandard: true };
  }
};

export const useHandoffCommunication = (
  record: DailyRecord | null,
  visibleBeds: { id: string }[],
  sendMedicalHandoff: (content: string, groupId: string) => Promise<void>,
  ensureMedicalHandoffSignatureLink: (
    scope?: MedicalHandoffScope
  ) => Promise<ApplicationOutcome<{ handoffUrl: string } | null>>,
  onSuccess: (message: string, description?: string) => void
) => {
  const [whatsappSending, setWhatsappSending] = useState(false);
  const [whatsappSent, setWhatsappSent] = useState(false);

  const buildE2EFallbackSignatureLink = useCallback(
    (scope: MedicalHandoffScope): string | null => {
      if (!record || !isE2ERuntimeEnabled()) {
        return null;
      }

      const origin = defaultBrowserWindowRuntime.getLocationOrigin();
      if (!origin) {
        return null;
      }

      const token = `e2e-${scope}-${Date.now()}`;
      return `${origin}/admin?mode=signature&date=${record.date}&scope=${scope}&token=${token}`;
    },
    [record]
  );

  /**
   * Copies the unique signature link to the system clipboard.
   */
  const handleShareLink = useCallback(
    async (scope: MedicalHandoffScope = 'all') => {
      if (!record) return;
      try {
        const result = await ensureMedicalHandoffSignatureLink(scope);
        const e2eFallbackUrl = buildE2EFallbackSignatureLink(scope);
        const sharePlan = resolveHandoffShareLinkPlan({
          scope,
          result,
          e2eFallbackUrl,
        });

        if (sharePlan.kind === 'copy') {
          await writeClipboardText(sharePlan.text);
          onSuccess(sharePlan.successMessage, sharePlan.successDescription);
          return;
        }

        onSuccess(sharePlan.message);
      } catch (error: unknown) {
        const err = error as Error;
        onSuccess(err.message || 'No se pudo copiar el enlace al portapapeles.');
      }
    },
    [buildE2EFallbackSignatureLink, ensureMedicalHandoffSignatureLink, onSuccess, record]
  );

  /**
   * Sends the medical handoff summary via WhatsApp service.
   */
  const handleSendWhatsApp = useCallback(async () => {
    if (!record) return;
    setWhatsappSending(true);
    try {
      const config = await getWhatsAppConfig();
      const { template: handoffTemplate, usedStandard } = await resolveHandoffTemplate();

      if (!config.handoffNotifications?.targetGroupId) {
        throw new Error('WhatsApp no configurado. Configure el grupo destino en ajustes.');
      }

      if (!handoffTemplate) {
        throw new Error('No se encontró template de entrega médica');
      }

      await sendMedicalHandoff(handoffTemplate.content, config.handoffNotifications.targetGroupId);
      setWhatsappSent(true);
      onSuccess(
        usedStandard
          ? 'Entrega enviada con la plantilla estándar: no se pudieron leer las plantillas configuradas.'
          : 'Entrega enviada a WhatsApp correctamente'
      );
    } catch (error: unknown) {
      const err = error as Error;
      handoffCommunicationLogger.error('Failed to send WhatsApp handoff', err);
      onSuccess(err.message || 'Error al enviar a WhatsApp');
    } finally {
      setWhatsappSending(false);
    }
  }, [record, sendMedicalHandoff, onSuccess]);

  /**
   * Manual WhatsApp sharing pre-filled for browser opening.
   */
  const handleSendWhatsAppManual = useCallback(async () => {
    if (!record) return;
    try {
      const { template: handoffTemplate } = await resolveHandoffTemplate();
      if (!handoffTemplate) {
        throw new Error('No se encontró template de entrega médica');
      }

      const handoffModel = buildManualMedicalHandoffMessageModel(record, visibleBeds);
      const handoffLinkResult = await ensureMedicalHandoffSignatureLink('all');
      if (handoffLinkResult.status !== 'success' || !handoffLinkResult.data?.handoffUrl) {
        throw new Error(
          resolveApplicationOutcomeMessage(
            handoffLinkResult,
            'No se pudo preparar el enlace de firma médica.'
          )
        );
      }
      const handoffUrl = handoffLinkResult.data.handoffUrl;

      const message =
        `\uD83C\uDFE5 Hospital Hanga Roa\n` +
        `\uD83D\uDCCB Entrega de Turno M\u00E9dico\n\n` +
        `\uD83D\uDCC5 Fecha: ${handoffModel.formattedDate}\n` +
        `\uD83D\uDC68\u200D\u2695\uFE0F Entregado por: ${handoffModel.doctorName}\n` +
        `\uD83D\uDD51 Firmado: ${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}\n\n` +
        `\uD83D\uDCCA Resumen:\n` +
        `\u2022 Hospitalizados: ${handoffModel.hospitalized} pacientes\n` +
        `\u2022 Camas libres: ${handoffModel.freeBeds}\n` +
        `\u2022 Nuevos ingresos: 0\n` +
        `\u2022 Altas: 0\n\n` +
        `\uD83D\uDD17 Ver entrega completa:\n` +
        `${handoffUrl}\n\n` +
        `- Enviado manualmente por Sistema HHR`;

      const encodedMessage = encodeURIComponent(message);
      defaultBrowserWindowRuntime.open(
        `https://api.whatsapp.com/send?text=${encodedMessage}`,
        '_blank'
      );
    } catch (error: unknown) {
      const err = error as Error;
      handoffCommunicationLogger.error('Failed to prepare manual WhatsApp handoff', err);
      onSuccess(err.message || 'Error al preparar WhatsApp');
    }
  }, [ensureMedicalHandoffSignatureLink, record, visibleBeds, onSuccess]);

  return {
    whatsappSending,
    whatsappSent,
    handleShareLink,
    handleSendWhatsApp,
    handleSendWhatsAppManual,
  };
};
