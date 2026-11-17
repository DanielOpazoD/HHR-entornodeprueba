import { createScopedLogger } from '@/services/utils/loggerScope';

export const censusEmailSendPolicyLogger = createScopedLogger('CensusEmailSendPolicy');
export const whatsappConfigLogger = createScopedLogger('WhatsAppConfigStore');
export const whatsappLoggingLogger = createScopedLogger('WhatsAppLogging');
export const whatsappServiceLogger = createScopedLogger('WhatsAppService');
export const whatsappShiftLogger = createScopedLogger('WhatsAppShiftStore');
export const whatsappTemplatesLogger = createScopedLogger('WhatsAppTemplatesStore');
