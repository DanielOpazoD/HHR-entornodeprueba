import React, { useState } from 'react';
import { Syringe } from 'lucide-react';
import {
  DOSE_UNIT_IDS,
  MASS_UNITS,
  isUnitCompatibleWithMass,
  type DoseUnitId,
  type InfusionDilution,
  type MassUnit,
} from '../../domain/infusionCalculator';
import {
  INFUSION_PRESETS,
  INFUSION_PRESET_GROUP_LABELS,
  findInfusionPreset,
  type InfusionPreset,
  type InfusionPresetGroup,
} from '../../domain/infusionPresets';
import { parseLocalizedDecimal } from '../../domain/numberInput';
import { InfusionResultPanel } from './InfusionResultPanel';
import { presentInfusion, type InfusionMode } from './infusionPresentation';
import { NumberField, SegmentedControl, SelectField, ToolSection } from './ToolField';
import { ToolFrame } from './ToolFrame';

export const CUSTOM_PRESET_ID = 'custom';

const PRESET_GROUPS = (Object.keys(INFUSION_PRESET_GROUP_LABELS) as InfusionPresetGroup[]).map(
  group => ({
    label: INFUSION_PRESET_GROUP_LABELS[group],
    options: INFUSION_PRESETS.filter(preset => preset.group === group).map(preset => ({
      value: preset.id,
      label: preset.name,
    })),
  })
);

const PRESET_SELECT_GROUPS = [
  ...PRESET_GROUPS,
  { label: 'Otra', options: [{ value: CUSTOM_PRESET_ID, label: 'Dilución personalizada' }] },
];

const firstCompatibleUnit = (mass: MassUnit): DoseUnitId =>
  DOSE_UNIT_IDS.find(unit => isUnitCompatibleWithMass(unit, mass)) ?? 'mg/h';

const resolvePreset = (presetId: string): InfusionPreset | null =>
  presetId === CUSTOM_PRESET_ID ? null : (findInfusionPreset(presetId) ?? null);

export const InfusionCalculatorTool: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [presetId, setPresetId] = useState<string>(INFUSION_PRESETS[0].id);
  const [dilutionIndex, setDilutionIndex] = useState(0);
  const [customAmount, setCustomAmount] = useState('');
  const [customMassUnit, setCustomMassUnit] = useState<MassUnit>('mg');
  const [customVolume, setCustomVolume] = useState('250');
  const [weight, setWeight] = useState('');
  const [mode, setMode] = useState<InfusionMode>('dose');
  const [doseText, setDoseText] = useState('');
  const [rateText, setRateText] = useState('');
  const [unit, setUnit] = useState<DoseUnitId>(INFUSION_PRESETS[0].defaultUnit);

  const preset = resolvePreset(presetId);
  const presetDilution = preset ? (preset.dilutions[dilutionIndex] ?? preset.dilutions[0]) : null;
  const massUnit: MassUnit = presetDilution ? presetDilution.amountUnit : customMassUnit;
  const allowedUnits: ReadonlyArray<DoseUnitId> = preset
    ? preset.allowedUnits
    : DOSE_UNIT_IDS.filter(candidate => isUnitCompatibleWithMass(candidate, massUnit));

  const dilution: InfusionDilution | null = presetDilution
    ? {
        amount: presetDilution.amount,
        amountUnit: presetDilution.amountUnit,
        volumeMl: presetDilution.volumeMl,
      }
    : (() => {
        const amount = parseLocalizedDecimal(customAmount);
        const volume = parseLocalizedDecimal(customVolume);
        return amount !== null && volume !== null
          ? { amount, amountUnit: customMassUnit, volumeMl: volume }
          : null;
      })();

  const weightKg = parseLocalizedDecimal(weight);
  const presentation = presentInfusion({
    mode,
    unit,
    weightKg,
    dilution,
    doseText,
    rateText,
    preset,
  });

  const selectPreset = (nextId: string): void => {
    setPresetId(nextId);
    setDilutionIndex(0);
    const nextPreset = resolvePreset(nextId);
    setUnit(nextPreset ? nextPreset.defaultUnit : firstCompatibleUnit(customMassUnit));
  };

  const selectCustomMassUnit = (nextMass: MassUnit): void => {
    setCustomMassUnit(nextMass);
    if (!isUnitCompatibleWithMass(unit, nextMass)) setUnit(firstCompatibleUnit(nextMass));
  };

  const unitNeedsWeight = unit.includes('/kg/');

  return (
    <ToolFrame
      title="Dilución y velocidad de infusión"
      description="Convierte la dosis indicada en mL/h de la bomba, o al revés, con la dilución elegida."
      icon={<Syringe size={16} aria-hidden="true" />}
      onBack={onBack}
      testId="library-tool-infusion"
    >
      <ToolSection title="Fármaco y dilución">
        <SelectField
          id="infusion-preset"
          label="Fármaco"
          value={presetId}
          onChange={selectPreset}
          groups={PRESET_SELECT_GROUPS}
        />
        <div className="mt-2">
          {preset ? (
            <SelectField
              id="infusion-dilution"
              label="Dilución de referencia"
              value={String(dilutionIndex)}
              onChange={value => setDilutionIndex(Number(value))}
              options={preset.dilutions.map((item, index) => ({
                value: String(index),
                label: item.label,
              }))}
              hint="Confirmar con el protocolo local y farmacia."
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                id="infusion-custom-amount"
                label="Cantidad"
                value={customAmount}
                onChange={setCustomAmount}
                placeholder="4"
              />
              <SelectField
                id="infusion-custom-unit"
                label="Unidad"
                value={customMassUnit}
                onChange={selectCustomMassUnit}
                options={MASS_UNITS.map(item => ({ value: item, label: item }))}
              />
              <NumberField
                id="infusion-custom-volume"
                label="Volumen"
                unit="mL"
                value={customVolume}
                onChange={setCustomVolume}
                placeholder="250"
              />
            </div>
          )}
        </div>
      </ToolSection>

      <ToolSection title="Paciente y dosis">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            id="infusion-weight"
            label="Peso"
            unit="kg"
            value={weight}
            onChange={setWeight}
            placeholder="70"
            hint={unitNeedsWeight ? 'Necesario para dosis por kilo.' : undefined}
          />
          <SegmentedControl
            label="Modo de cálculo"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'dose', label: 'Dosis → mL/h' },
              { value: 'rate', label: 'mL/h → Dosis' },
            ]}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {mode === 'dose' ? (
            <NumberField
              id="infusion-dose"
              label="Dosis indicada"
              value={doseText}
              onChange={setDoseText}
              placeholder="0,1"
            />
          ) : (
            <NumberField
              id="infusion-rate"
              label="Velocidad de la bomba"
              unit="mL/h"
              value={rateText}
              onChange={setRateText}
              placeholder="10"
            />
          )}
          <SelectField
            id="infusion-unit"
            label="Unidad de dosis"
            value={unit}
            onChange={setUnit}
            options={allowedUnits.map(item => ({ value: item, label: item }))}
          />
        </div>
      </ToolSection>

      <InfusionResultPanel presentation={presentation} preset={preset} />
    </ToolFrame>
  );
};
