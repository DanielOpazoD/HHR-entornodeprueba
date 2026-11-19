/**
 * WhatsApp Integration Types
 *
 * Types for shift parsing and handoff delivery via WhatsApp
 */

// ============================================
// SHIFT MANAGEMENT
// ============================================

/**
 * Weekly shift schedule for operating room staff
 */
export interface WeeklyShift {
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** End date in YYYY-MM-DD format */
  endDate: string;
  /** Where this shift data came from */
  source: 'whatsapp' | 'manual';
  /** When this was parsed/created */
  parsedAt: string;
  /** List of staff members on duty */
  staff: ShiftStaffMember[];
  /** Original WhatsApp message (for reference) */
  originalMessage?: string;
}

/**
 * Individual staff member on shift
 */
export interface ShiftStaffMember {
  /** Role/position (e.g., "Cirujana", "Anestesista") */
  role: string;
  /** Full name */
  name: string;
  /** Phone number in format +56 9 XXXX XXXX */
  phone: string;
  /** WhatsApp deep link */
  whatsappUrl: string;
  /** Notes about this staff member */
  notes?: string;
  /** Replacement info if they change mid-week */
  replacement?: {
    name: string;
    phone: string;
    whatsappUrl: string;
    /** When replacement starts (ISO date string) */
    startDate: string;
  };
}

// ============================================
// WHATSAPP CONFIGURATION
// ============================================

/**
 * WhatsApp integration configuration
 */
export interface WhatsAppConfig {
  /** Whether WhatsApp integration is enabled */
  enabled: boolean;
  /** Connection status */
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  /** Last connection time */
  lastConnected?: string;
  /** Shift parser configuration */
  shiftParser: {
    enabled: boolean;
    /** WhatsApp group ID to monitor for shifts */
    sourceGroupId: string;
  };
  /** Handoff notification configuration */
  handoffNotifications: {
    enabled: boolean;
    /** WhatsApp group ID to send notifications to */
    targetGroupId: string;
    /** Auto-send time (HH:MM) */
    autoSendTime: string;
  };
}

// ============================================
// LOGS
// ============================================

/**
 * Log entry for WhatsApp operations
 */
export interface WhatsAppLog {
  id: string;
  timestamp: string;
  type: 'HANDOFF_SENT' | 'SHIFT_PARSED' | 'MESSAGE_RECEIVED' | 'ERROR';
  method?: 'MANUAL' | 'AUTO';
  userId?: string;
  groupId?: string;
  messageId?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}
