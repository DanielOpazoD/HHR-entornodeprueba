import React from 'react';
import {
  VITAL_SIGNS_THRESHOLDS,
  type VitalSignsMetricKey,
  type VitalSignsProfile,
  type VitalThresholdRule,
} from '@/constants/vitalSignsThresholds';

const PROFILES: ReadonlyArray<{ key: VitalSignsProfile; label: string }> = [
  { key: 'unknown', label: 'Sin edad suficiente' },
  { key: 'newborn', label: 'RN · 0–27 días' },
  { key: 'infant', label: '<1 año · desde 28 días' },
  { key: 'child_1_4', label: '1–4 años' },
  { key: 'child_5_11', label: '5–11 años' },
  { key: 'adolescent_12_17', label: '12–17 años' },
  { key: 'adult', label: 'Adulto · ≥18 años' },
];

const METRICS: ReadonlyArray<{ key: VitalSignsMetricKey; label: string }> = [
  { key: 'pa', label: 'PA sistólica' },
  { key: 'fc', label: 'FC' },
  { key: 'spo2', label: 'SatO₂' },
  { key: 'temp', label: 'T°' },
  { key: 'fr', label: 'FR' },
];

const normalBand = (rule: VitalThresholdRule): string => {
  if (rule.kind === 'fixed') return 'Sin banda';
  if (rule.kind === 'low') return `≥${rule.normalAtOrAbove}`;
  if (rule.kind === 'high') return `<${rule.warnAtOrAbove}`;
  return `${rule.normal.min}–${rule.normal.max}`;
};

const redBand = (rule: VitalThresholdRule): string => {
  if (rule.kind === 'fixed') return '—';
  if (rule.kind === 'low') return `<${rule.alertBelow}`;
  if (rule.kind === 'high') return `≥${rule.alertAtOrAbove}`;
  const limits = [
    rule.alert.low ? `${rule.alert.low.inclusive ? '≤' : '<'}${rule.alert.low.value}` : null,
    rule.alert.high ? `${rule.alert.high.inclusive ? '≥' : '>'}${rule.alert.high.value}` : null,
  ].filter(Boolean);
  return limits.length > 0 ? limits.join(' / ') : '—';
};

export const VitalSignsVisualRangesSettings: React.FC = () => (
  <details className="mt-5 rounded-xl border border-slate-200 bg-slate-50">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-800">
      Alarmas visuales de signos vitales
    </summary>
    <div className="border-t border-slate-200 px-4 py-4">
      <p className="text-xs text-slate-600">
        El perfil se elige sólo por edad cumplida en la fecha de la medición; la cama no lo
        modifica. Negro indica banda habitual, naranjo revisión y rojo evaluación prioritaria. En
        cada celda se muestra «habitual · rojo»; los valores intermedios son naranjos.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-[900px] w-full border-collapse text-left text-[11px] text-slate-600">
          <thead>
            <tr className="border-b border-slate-200 text-slate-700">
              <th className="py-2 pr-3 font-semibold">Población</th>
              {METRICS.map(metric => (
                <th key={metric.key} className="px-3 py-2 font-semibold">
                  {metric.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PROFILES.map(profile => (
              <tr key={profile.key} className="border-b border-slate-200/80 last:border-0">
                <th className="py-2 pr-3 font-semibold text-slate-700">{profile.label}</th>
                {METRICS.map(metric => {
                  const threshold = VITAL_SIGNS_THRESHOLDS[profile.key][metric.key];
                  return (
                    <td key={metric.key} className="px-3 py-2 tabular-nums">
                      <span className="text-slate-700">{normalBand(threshold.rule)}</span>
                      <span className="text-slate-400"> · rojo {redBand(threshold.rule)}</span>
                      <span className="ml-1 text-slate-400">{threshold.unit}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Pediatría usa Queensland Health CEWT. RN conserva un perfil neonatal separado. Esto es una
        ayuda visual y no reemplaza metas individuales ni evaluación clínica.
      </p>
    </div>
  </details>
);
