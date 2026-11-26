/**
 * Clinical interpretation of the Braden scale (LPP / pressure-injury risk) per Hospital Hanga Roa's
 * table. Pure and UI-agnostic: given a Braden total and the patient's age it yields the risk level,
 * the planned care ("conducta") and the reapplication due-date, so nursing can see the risk and a
 * visual reminder of when the scale must be re-applied.
 *
 * Risk bands (by age; adult = 15+ years, pediatric = 0–14). The hospital's stated ranges leave gaps
 * (15/16 and 12 uncategorized), so we take the explicit "Medio" band as the pivot — below it = Alto,
 * above it = Bajo — giving contiguous, gap-free bands:
 *   Adulto (≥15a):   ≤12 Alto · 13–14 Medio · ≥15 Bajo
 *   Pediátrico(0–14): ≤12 Alto · 13–15 Medio · ≥16 Bajo
 * (So 12 → Alto, the safer side, and 15/16 → Bajo.)
 *
 * Downton (falls) is a separate scale with its own direction/table and is intentionally NOT handled
 * here yet — pending its conducta table.
 */

import { addCalendarDays, diffCalendarDays } from '@/utils/clinicalDateUtils';
import type { BradenRiskLevel } from '@/types/domain/evaluationScores';

/** A patient is scored as an adult from this age (years); below it, the pediatric band applies. */
export const BRADEN_ADULT_MIN_AGE = 15;

/** Classify a Braden total into the hospital's risk level, using the age-appropriate band. */
export const classifyBradenRisk = (total: number, ageYears: number): BradenRiskLevel => {
  const medioMax = ageYears >= BRADEN_ADULT_MIN_AGE ? 14 : 15;
  if (total <= 12) return 'alto';
  if (total <= medioMax) return 'medio';
  return 'bajo';
};

/** Planned care + reapplication cadence for a Braden risk level (the hospital's conducta table). */
export interface BradenConducta {
  /** Display label, e.g. "Riesgo Bajo". */
  riskLabel: string;
  /** Days until the scale must be re-applied. */
  reapplyDays: number;
  /** Human cadence label, e.g. "Cada 7 días" / "Diariamente". */
  aplicacion: string;
  /** Planned nursing interventions ("cada intervención debe tener su registro"). */
  cuidados: string[];
}

export const BRADEN_CONDUCTA: Record<BradenRiskLevel, BradenConducta> = {
  bajo: {
    riskLabel: 'Riesgo Bajo',
    reapplyDays: 7,
    aplicacion: 'Cada 7 días',
    cuidados: ['Cuidados básicos de atención de enfermería'],
  },
  medio: {
    riskLabel: 'Riesgo Medio',
    reapplyDays: 3,
    aplicacion: 'Cada 3 días',
    cuidados: [
      'Cambio de posición cada 4 h',
      'Protección de prominencias óseas (adultos)',
      'Mantener la piel seca y lubricada',
    ],
  },
  alto: {
    riskLabel: 'Riesgo Alto',
    reapplyDays: 1,
    aplicacion: 'Diariamente',
    cuidados: [
      'Cambio de posición cada 2 h',
      'Protección de prominencias óseas (adulto y pediátrico)',
      'Mantener la piel seca y lubricada',
      'Colchón antiescaras o viscoelástico',
    ],
  },
};

export type ReapplicationUrgency = 'ok' | 'due' | 'overdue';

export interface ReapplicationStatus {
  /** ISO day the scale is next due — recordedDate + reapplyDays. */
  dueDate: string;
  /** Days from the reference day until due; negative when overdue, 0 when due today. */
  daysUntilDue: number;
  urgency: ReapplicationUrgency;
}

/**
 * Whether the scale is due for reapplication as of `referenceDate` (typically the census day). Both
 * dates are ISO YYYY-MM-DD in the same local frame (Rapa Nui) — see the timezone note in memory.
 */
export const bradenReapplicationStatus = (
  recordedDate: string,
  riskLevel: BradenRiskLevel,
  referenceDate: string
): ReapplicationStatus => {
  const dueDate = addCalendarDays(recordedDate, BRADEN_CONDUCTA[riskLevel].reapplyDays);
  const daysUntilDue = diffCalendarDays(referenceDate, dueDate) ?? 0;
  const urgency: ReapplicationUrgency =
    daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due' : 'ok';
  return { dueDate, daysUntilDue, urgency };
};

export interface BradenAssessment {
  riskLevel: BradenRiskLevel;
  conducta: BradenConducta;
  reapplication: ReapplicationStatus;
}

/** Full display-ready Braden assessment: risk level + conducta + reapplication status. */
export const assessBraden = (
  total: number,
  ageYears: number,
  recordedDate: string,
  referenceDate: string
): BradenAssessment => {
  const riskLevel = classifyBradenRisk(total, ageYears);
  return {
    riskLevel,
    conducta: BRADEN_CONDUCTA[riskLevel],
    reapplication: bradenReapplicationStatus(recordedDate, riskLevel, referenceDate),
  };
};
