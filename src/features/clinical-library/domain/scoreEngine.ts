/**
 * Motor declarativo de scores clínicos: cada score es datos (ítems, puntajes,
 * bandas de interpretación y referencia) y este módulo los evalúa. Los ítems
 * booleanos no respondidos cuentan 0; los de elección requieren respuesta para
 * que el resultado se considere completo (p. ej. Glasgow).
 */

export type ScoreTone = 'success' | 'info' | 'warning' | 'danger';

export interface ScoreChoiceOption {
  value: string;
  label: string;
  points: number;
}

export interface ScoreBooleanItem {
  id: string;
  kind: 'boolean';
  label: string;
  points: number;
  help?: string;
}

export interface ScoreChoiceItem {
  id: string;
  kind: 'choice';
  label: string;
  options: ReadonlyArray<ScoreChoiceOption>;
  help?: string;
}

export type ScoreItem = ScoreBooleanItem | ScoreChoiceItem;

export interface ScoreBand {
  min: number;
  max: number;
  label: string;
  tone: ScoreTone;
  detail: string;
}

export interface ScoreReference {
  citation: string;
  url?: string;
}

export interface ScoreDefinition {
  id: string;
  name: string;
  shortName: string;
  purpose: string;
  items: ReadonlyArray<ScoreItem>;
  bands: ReadonlyArray<ScoreBand>;
  notes?: ReadonlyArray<string>;
  /**
   * Ítem cuyo puntaje cuenta en el total pero no en la banda (p. ej. sexo femenino en
   * CHA₂DS₂-VASc: modifica el riesgo, no indica anticoagulación por sí solo).
   */
  bandModifierItemId?: string;
  reference: ScoreReference;
}

export type ScoreAnswers = Readonly<Record<string, boolean | string | undefined>>;

export interface ScoreEvaluation {
  total: number;
  /** Total usado para elegir la banda; difiere de `total` sólo con `bandModifierItemId`. */
  bandTotal: number;
  maxTotal: number;
  complete: boolean;
  missingItemIds: string[];
  band: ScoreBand | null;
}

export const scoreItemMaxPoints = (item: ScoreItem): number =>
  item.kind === 'boolean' ? item.points : Math.max(...item.options.map(option => option.points));

export const scoreMaxTotal = (definition: ScoreDefinition): number =>
  definition.items.reduce((sum, item) => sum + scoreItemMaxPoints(item), 0);

export const findScoreBand = (bands: ReadonlyArray<ScoreBand>, total: number): ScoreBand | null =>
  bands.find(band => total >= band.min && total <= band.max) ?? null;

export const evaluateScore = (
  definition: ScoreDefinition,
  answers: ScoreAnswers
): ScoreEvaluation => {
  let total = 0;
  let modifierPoints = 0;
  const missingItemIds: string[] = [];
  for (const item of definition.items) {
    const answer = answers[item.id];
    if (item.kind === 'boolean') {
      if (answer === true) {
        total += item.points;
        if (item.id === definition.bandModifierItemId) modifierPoints += item.points;
      }
      continue;
    }
    const option = item.options.find(candidate => candidate.value === answer);
    if (!option) {
      missingItemIds.push(item.id);
      continue;
    }
    total += option.points;
  }
  const complete = missingItemIds.length === 0;
  const bandTotal = total - modifierPoints;
  return {
    total,
    bandTotal,
    maxTotal: scoreMaxTotal(definition),
    complete,
    missingItemIds,
    band: complete ? findScoreBand(definition.bands, bandTotal) : null,
  };
};

/** Totales alcanzables por el score (para verificar que las bandas los cubren todos). */
export const reachableScoreTotals = (definition: ScoreDefinition): number[] => {
  let totals = new Set<number>([0]);
  for (const item of definition.items) {
    const increments =
      item.kind === 'boolean' ? [0, item.points] : item.options.map(option => option.points);
    const next = new Set<number>();
    for (const total of totals) for (const increment of increments) next.add(total + increment);
    totals = next;
  }
  return [...totals].sort((left, right) => left - right);
};
