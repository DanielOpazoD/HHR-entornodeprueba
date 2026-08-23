export type VitalStatus = 'neutral' | 'normal' | 'warn' | 'alert';
export type VitalSignsProfile =
  | 'unknown'
  | 'newborn'
  | 'infant'
  | 'child_1_4'
  | 'child_5_11'
  | 'adolescent_12_17'
  | 'adult';
export type VitalSignsMetricKey = 'pa' | 'fc' | 'spo2' | 'temp' | 'fr' | 'eva' | 'hgt' | 'ins';

export const VITAL_STATUS_MEANINGS: Readonly<Record<VitalStatus, string>> = {
  neutral: 'Gris: valor visible sin una banda segura para esta población o métrica.',
  normal: 'Negro/gris oscuro: dentro de la banda visual habitual.',
  warn: 'Naranjo: fuera de la banda habitual; requiere revisión clínica.',
  alert: 'Rojo: desviación marcada; requiere evaluación prioritaria.',
};

export const VITAL_SIGNS_PROFILE_DEFINITIONS: Readonly<Record<VitalSignsProfile, string>> = {
  unknown:
    'Edad desconocida o insuficiente en la fecha de la medición. Todos los valores permanecen grises.',
  newborn:
    'Recién nacido de 0 a 27 días completos en la fecha de la medición. La cama o ubicación no define el perfil.',
  infant: 'Lactante desde 28 días completos hasta antes de cumplir 1 año.',
  child_1_4: 'Paciente pediátrico desde 1 año hasta 4 años completos.',
  child_5_11: 'Paciente pediátrico desde 5 años hasta 11 años completos.',
  adolescent_12_17: 'Paciente pediátrico desde 12 años hasta 17 años completos.',
  adult: 'Paciente de 18 años o más.',
};

interface RangeRule {
  kind: 'range';
  normal: { min: number; max: number };
  /** Values meeting either alert boundary are red; remaining out-of-normal values are orange. */
  alert: {
    low?: { value: number; inclusive: boolean };
    high?: { value: number; inclusive: boolean };
  };
}

interface LowRule {
  kind: 'low';
  normalAtOrAbove: number;
  alertBelow: number;
}

interface HighRule {
  kind: 'high';
  warnAtOrAbove: number;
  alertAtOrAbove: number;
}

interface FixedRule {
  kind: 'fixed';
  status: Extract<VitalStatus, 'neutral' | 'normal'>;
  reason: string;
}

export type VitalThresholdRule = RangeRule | LowRule | HighRule | FixedRule;

export interface VitalMetricThreshold {
  label: string;
  unit: string;
  rule: VitalThresholdRule;
}

type VitalThresholdProfile = Readonly<Record<VitalSignsMetricKey, VitalMetricThreshold>>;

const unknownMetric = (label: string, unit: string): VitalMetricThreshold => ({
  label,
  unit,
  rule: {
    kind: 'fixed',
    status: 'neutral',
    reason: 'No existe edad suficiente para seleccionar una banda poblacional segura.',
  },
});

const unknown: VitalThresholdProfile = {
  pa: unknownMetric('Presión arterial sistólica', 'mmHg'),
  fc: unknownMetric('Frecuencia cardiaca', 'lpm'),
  spo2: unknownMetric('Saturación de oxígeno', '%'),
  temp: unknownMetric('Temperatura', '°C'),
  fr: unknownMetric('Frecuencia respiratoria', 'rpm'),
  eva: unknownMetric('Dolor EVA', '/10'),
  hgt: unknownMetric('Hemoglucotest capilar', 'mg/dL'),
  ins: unknownMetric('Insulina y cuadrante', 'UI'),
};

const adult: VitalThresholdProfile = {
  pa: {
    label: 'Presión arterial sistólica',
    unit: 'mmHg',
    rule: {
      kind: 'range',
      normal: { min: 100, max: 160 },
      alert: {
        low: { value: 90, inclusive: true },
        high: { value: 181, inclusive: true },
      },
    },
  },
  fc: {
    label: 'Frecuencia cardiaca',
    unit: 'lpm',
    rule: {
      kind: 'range',
      normal: { min: 50, max: 100 },
      alert: {
        low: { value: 40, inclusive: true },
        high: { value: 130, inclusive: true },
      },
    },
  },
  spo2: {
    label: 'Saturación de oxígeno',
    unit: '%',
    rule: { kind: 'low', normalAtOrAbove: 94, alertBelow: 90 },
  },
  temp: {
    label: 'Temperatura',
    unit: '°C',
    rule: {
      kind: 'range',
      normal: { min: 35.5, max: 37.7 },
      alert: {
        low: { value: 35, inclusive: true },
        high: { value: 39, inclusive: true },
      },
    },
  },
  fr: {
    label: 'Frecuencia respiratoria',
    unit: 'rpm',
    rule: {
      kind: 'range',
      normal: { min: 12, max: 20 },
      alert: {
        low: { value: 8, inclusive: true },
        high: { value: 25, inclusive: true },
      },
    },
  },
  eva: {
    label: 'Dolor EVA',
    unit: '/10',
    rule: { kind: 'high', warnAtOrAbove: 4, alertAtOrAbove: 7 },
  },
  hgt: {
    label: 'Hemoglucotest capilar',
    unit: 'mg/dL',
    rule: {
      kind: 'range',
      normal: { min: 70, max: 180 },
      alert: {
        low: { value: 54, inclusive: true },
        high: { value: 400, inclusive: true },
      },
    },
  },
  ins: {
    label: 'Insulina y cuadrante',
    unit: 'UI',
    rule: { kind: 'fixed', status: 'normal', reason: 'Es un registro, no un rango fisiológico.' },
  },
};

const newborn: VitalThresholdProfile = {
  pa: {
    label: 'Presión arterial',
    unit: 'mmHg',
    rule: {
      kind: 'fixed',
      status: 'neutral',
      reason: 'Requiere edad gestacional, peso y edad posnatal para interpretarse.',
    },
  },
  fc: {
    label: 'Frecuencia cardiaca',
    unit: 'lpm',
    rule: {
      kind: 'range',
      normal: { min: 100, max: 160 },
      alert: {
        low: { value: 80, inclusive: false },
        high: { value: 180, inclusive: false },
      },
    },
  },
  spo2: {
    label: 'Saturación de oxígeno',
    unit: '%',
    rule: { kind: 'low', normalAtOrAbove: 94, alertBelow: 90 },
  },
  temp: {
    label: 'Temperatura',
    unit: '°C',
    rule: {
      kind: 'range',
      normal: { min: 36.5, max: 37.5 },
      alert: {
        low: { value: 35.5, inclusive: true },
        high: { value: 38, inclusive: true },
      },
    },
  },
  fr: {
    label: 'Frecuencia respiratoria',
    unit: 'rpm',
    rule: {
      kind: 'range',
      normal: { min: 30, max: 60 },
      alert: {
        low: { value: 20, inclusive: false },
        high: { value: 70, inclusive: false },
      },
    },
  },
  eva: {
    label: 'Dolor EVA',
    unit: '/10',
    rule: {
      kind: 'fixed',
      status: 'neutral',
      reason: 'En RN se requiere una escala de dolor apropiada para la edad.',
    },
  },
  hgt: {
    label: 'Hemoglucotest capilar',
    unit: 'mg/dL',
    rule: {
      kind: 'fixed',
      status: 'neutral',
      reason: 'Depende de horas de vida y factores de riesgo perinatales.',
    },
  },
  ins: {
    label: 'Insulina y cuadrante',
    unit: 'UI',
    rule: { kind: 'fixed', status: 'normal', reason: 'Es un registro, no un rango fisiológico.' },
  },
};

interface PediatricProfileInput {
  systolic: { min: number; max: number; alertBelow: number };
  heartRate: { min: number; max: number; alertAtOrBelow: number; alertAtOrAbove: number };
  respiratoryRate: {
    min: number;
    max: number;
    alertAtOrBelow: number;
    alertAtOrAbove: number;
  };
  ageAppropriateEva: boolean;
}

/** Queensland Health CEWT bands. CEWT 1–2 is orange and CEWT 3 is red. */
const buildPediatricProfile = ({
  systolic,
  heartRate,
  respiratoryRate,
  ageAppropriateEva,
}: PediatricProfileInput): VitalThresholdProfile => ({
  pa: {
    label: 'Presión arterial sistólica',
    unit: 'mmHg',
    rule: {
      kind: 'range',
      normal: { min: systolic.min, max: systolic.max },
      alert: { low: { value: systolic.alertBelow, inclusive: false } },
    },
  },
  fc: {
    label: 'Frecuencia cardiaca',
    unit: 'lpm',
    rule: {
      kind: 'range',
      normal: { min: heartRate.min, max: heartRate.max },
      alert: {
        low: { value: heartRate.alertAtOrBelow, inclusive: true },
        high: { value: heartRate.alertAtOrAbove, inclusive: true },
      },
    },
  },
  spo2: {
    label: 'Saturación de oxígeno',
    unit: '%',
    rule: { kind: 'low', normalAtOrAbove: 94, alertBelow: 90 },
  },
  temp: {
    label: 'Temperatura',
    unit: '°C',
    // Queensland CEWT defines 35.5–37.9 °C as the standard band. Values outside it require
    // review, but the cited tool does not provide a CEWT-3 temperature band to justify red.
    rule: { kind: 'range', normal: { min: 35.5, max: 37.9 }, alert: {} },
  },
  fr: {
    label: 'Frecuencia respiratoria',
    unit: 'rpm',
    rule: {
      kind: 'range',
      normal: { min: respiratoryRate.min, max: respiratoryRate.max },
      alert: {
        low: { value: respiratoryRate.alertAtOrBelow, inclusive: true },
        high: { value: respiratoryRate.alertAtOrAbove, inclusive: true },
      },
    },
  },
  eva: ageAppropriateEva
    ? adult.eva
    : {
        label: 'Dolor EVA',
        unit: '/10',
        rule: {
          kind: 'fixed',
          status: 'neutral',
          reason: 'En lactantes se requiere una escala de dolor apropiada para la edad.',
        },
      },
  hgt: ageAppropriateEva
    ? adult.hgt
    : {
        label: 'Hemoglucotest capilar',
        unit: 'mg/dL',
        rule: {
          kind: 'fixed',
          status: 'neutral',
          reason: 'La interpretación depende del contexto clínico y alimentario.',
        },
      },
  ins: adult.ins,
});

const infant = buildPediatricProfile({
  systolic: { min: 75, max: 119, alertBelow: 55 },
  heartRate: { min: 100, max: 159, alertAtOrBelow: 80, alertAtOrAbove: 190 },
  respiratoryRate: { min: 21, max: 45, alertAtOrBelow: 15, alertAtOrAbove: 55 },
  ageAppropriateEva: false,
});

const child1To4 = buildPediatricProfile({
  systolic: { min: 80, max: 124, alertBelow: 65 },
  heartRate: { min: 90, max: 139, alertAtOrBelow: 70, alertAtOrAbove: 170 },
  respiratoryRate: { min: 16, max: 35, alertAtOrBelow: 10, alertAtOrAbove: 50 },
  ageAppropriateEva: true,
});

const child5To11 = buildPediatricProfile({
  systolic: { min: 85, max: 129, alertBelow: 65 },
  heartRate: { min: 80, max: 129, alertAtOrBelow: 60, alertAtOrAbove: 170 },
  respiratoryRate: { min: 16, max: 30, alertAtOrBelow: 5, alertAtOrAbove: 45 },
  ageAppropriateEva: true,
});

const adolescent12To17 = buildPediatricProfile({
  systolic: { min: 90, max: 149, alertBelow: 80 },
  heartRate: { min: 60, max: 119, alertAtOrBelow: 40, alertAtOrAbove: 150 },
  respiratoryRate: { min: 16, max: 25, alertAtOrBelow: 5, alertAtOrAbove: 35 },
  ageAppropriateEva: true,
});

export const VITAL_SIGNS_THRESHOLDS: Readonly<Record<VitalSignsProfile, VitalThresholdProfile>> = {
  unknown,
  newborn,
  infant,
  child_1_4: child1To4,
  child_5_11: child5To11,
  adolescent_12_17: adolescent12To17,
  adult,
};

const meetsLowAlert = (value: number, boundary: RangeRule['alert']['low']): boolean =>
  boundary != null && (boundary.inclusive ? value <= boundary.value : value < boundary.value);

const meetsHighAlert = (value: number, boundary: RangeRule['alert']['high']): boolean =>
  boundary != null && (boundary.inclusive ? value >= boundary.value : value > boundary.value);

export const classifyVitalSign = (
  profile: VitalSignsProfile,
  metric: VitalSignsMetricKey,
  value: number
): VitalStatus => {
  const rule = VITAL_SIGNS_THRESHOLDS[profile][metric].rule;
  if (rule.kind === 'fixed') return rule.status;
  if (rule.kind === 'low') {
    if (value < rule.alertBelow) return 'alert';
    return value < rule.normalAtOrAbove ? 'warn' : 'normal';
  }
  if (rule.kind === 'high') {
    if (value >= rule.alertAtOrAbove) return 'alert';
    return value >= rule.warnAtOrAbove ? 'warn' : 'normal';
  }
  if (meetsLowAlert(value, rule.alert.low) || meetsHighAlert(value, rule.alert.high)) {
    return 'alert';
  }
  return value < rule.normal.min || value > rule.normal.max ? 'warn' : 'normal';
};
