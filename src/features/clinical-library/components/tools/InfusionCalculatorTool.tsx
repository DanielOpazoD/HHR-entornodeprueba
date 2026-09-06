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
import {
  formatDilutionLabel,
  presentInfusion,
  type InfusionMode,
} from '../../controllers/infusionPresentation';
import { PLAUSIBLE_RANGES, plausibleValue, rangeHint } from '../../controllers/plausibleRanges';
import { InfusionResultPanel } from './InfusionResultPanel';
import { NumberField, SegmentedControl, SelectField, ToolSection } from './ToolField';
import { ToolFrame, type ToolComponentProps } from './ToolFrame';

export const CUSTOM_PRESET_ID = 'custom';

const PRESET_SELECT_GROUPS = [
  ...(Object.keys(INFUSION_PRESET_GROUP_LABELS) as InfusionPresetGroup[]).map(group => ({
    label: INFUSION_PRESET_GROUP_LABELS[group],
    options: INFUSION_PRESETS.filter(preset => preset.group === group).map(preset => ({
      value: preset.id,
      label: preset.name,
    })),
  })),
  { label: 'Otra', options: [{ value: CUSTOM_PRESET_ID, label: 'Dilución personalizada' }] },
];

const firstCompatibleUnit = (mass: MassUnit): DoseUnitId =>
  DOSE_UNIT_IDS.find(unit => isUnitCompatibleWithMass(unit, mass)) ?? 'mg/h';

const resolvePreset = (presetId: string): InfusionPreset | null =>
  presetId === CUSTOM_PRESET_ID ? null : (findInfusionPreset(presetId) ?? null);

const customDilution = (
  amountText: string,
  amountUnit: MassUnit,
  volumeText: string
): InfusionDilution | null => {
  const amount = parseLocalizedDecimal(amountText);
  const volumeMl = parseLocalizedDecimal(volumeText);
  return amount !== null && volumeMl !== null ? { amount, amountUnit, volumeMl } : null;
};

export const InfusionCalculatorTool: React.FC<ToolComponentProps> = ({ onBack, onClose }) => {
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
    ? presetDilution
    : customDilution(customAmount, customMassUnit, customVolume);

  const weightInput = plausibleValue(weight, PLAUSIBLE_RANGES.weightKg);
  const presentation = presentInfusion({
    mode,
    unit,
    weightKg: weightInput.value,
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

  return (
    <ToolFrame
      title="Dilución y velocidad de infusión"
      icon={<Syringe size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
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
              label="Dilución"
              value={String(dilutionIndex)}
              onChange={value => setDilutionIndex(Number(value))}
              options={preset.dilutions.map((item, index) => ({
                value: String(index),
                label: formatDilutionLabel(item),
              }))}
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
            invalid={weightInput.invalid}
            hint={rangeHint(weightInput, PLAUSIBLE_RANGES.weightKg)}
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
