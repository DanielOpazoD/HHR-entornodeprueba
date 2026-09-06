import React, { useState } from 'react';
import { Calculator } from 'lucide-react';
import {
  adjustedBodyWeight,
  bodySurfaceAreaMosteller,
  classifyBmi,
  cockcroftGaultClearance,
  computeBmi,
  computeWeightBasedDose,
  idealBodyWeightDevine,
  type BiologicalSex,
  type BmiCategory,
  type WeightBasis,
} from '../../domain/doseCalculator';
import { MASS_UNITS, type MassUnit } from '../../domain/infusionCalculator';
import { parseLocalizedDecimal } from '../../domain/numberInput';
import { formatClinicalNumber } from '../../controllers/libraryPresentation';
import { PLAUSIBLE_RANGES, plausibleValue, rangeHint } from '../../controllers/plausibleRanges';
import { NumberField, ResultTile, SegmentedControl, SelectField, ToolSection } from './ToolField';
import { ToolFrame, type ToolComponentProps } from './ToolFrame';

const BMI_LABELS: Readonly<Record<BmiCategory, string>> = {
  underweight: 'Bajo peso',
  normal: 'Normal',
  overweight: 'Sobrepeso',
  obesity: 'Obesidad',
};

const BASIS_LABELS: Readonly<Record<WeightBasis, string>> = {
  actual: 'Real',
  ideal: 'Ideal',
  adjusted: 'Ajustado',
};

const kgLabel = (value: number | null): string =>
  value === null ? '—' : `${formatClinicalNumber(value, 1)} kg`;

export const DosingCalculatorTool: React.FC<ToolComponentProps> = ({ onBack, onClose }) => {
  const [sex, setSex] = useState<BiologicalSex>('male');
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [creatinine, setCreatinine] = useState('');
  const [dosePerKg, setDosePerKg] = useState('');
  const [doseUnit, setDoseUnit] = useState<MassUnit>('mg');
  const [weightBasis, setWeightBasis] = useState<WeightBasis>('actual');
  const [presentationAmount, setPresentationAmount] = useState('');
  const [presentationVolume, setPresentationVolume] = useState('');

  const weightInput = plausibleValue(weight, PLAUSIBLE_RANGES.weightKg);
  const heightInput = plausibleValue(height, PLAUSIBLE_RANGES.heightCm);
  const ageInput = plausibleValue(age, PLAUSIBLE_RANGES.ageYears);
  const creatinineInput = plausibleValue(creatinine, PLAUSIBLE_RANGES.creatinineMgDl);
  const weightKg = weightInput.value;
  const heightCm = heightInput.value;

  const bmi = weightKg !== null && heightCm !== null ? computeBmi(weightKg, heightCm) : null;
  const ideal = heightCm !== null ? idealBodyWeightDevine(heightCm, sex) : null;
  const adjusted = weightKg !== null && ideal ? adjustedBodyWeight(weightKg, ideal.kg) : null;
  const bsa =
    weightKg !== null && heightCm !== null ? bodySurfaceAreaMosteller(weightKg, heightCm) : null;
  const clearance =
    ageInput.value !== null && weightKg !== null && creatinineInput.value !== null
      ? cockcroftGaultClearance({
          ageYears: ageInput.value,
          weightKg,
          creatinineMgDl: creatinineInput.value,
          sex,
        })
      : null;

  const basisWeights: Readonly<Record<WeightBasis, number | null>> = {
    actual: weightKg,
    ideal: ideal?.kg ?? null,
    adjusted,
  };
  // Si la base elegida deja de estar disponible (p. ej. se borra la talla), vuelve al peso real.
  const effectiveBasis: WeightBasis = basisWeights[weightBasis] === null ? 'actual' : weightBasis;
  const doseWeight = basisWeights[effectiveBasis];
  const dosePerKgValue = parseLocalizedDecimal(dosePerKg);
  const amount = parseLocalizedDecimal(presentationAmount);
  const volume = parseLocalizedDecimal(presentationVolume);
  const doseResult =
    dosePerKgValue !== null && doseWeight !== null
      ? computeWeightBasedDose({
          dosePerKg: dosePerKgValue,
          doseUnit,
          weightKg: doseWeight,
          presentation: amount !== null && volume !== null ? { amount, volumeMl: volume } : null,
        })
      : null;

  return (
    <ToolFrame
      title="Dosis y antropometría"
      icon={<Calculator size={16} aria-hidden="true" />}
      onBack={onBack}
      onClose={onClose}
      testId="library-tool-dosing"
    >
      <ToolSection title="Paciente">
        <div className="grid grid-cols-2 gap-2">
          <SegmentedControl
            label="Sexo"
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: 'Hombre' },
              { value: 'female', label: 'Mujer' },
            ]}
          />
          <NumberField
            id="dosing-age"
            label="Edad"
            unit="años"
            value={age}
            onChange={setAge}
            placeholder="65"
            invalid={ageInput.invalid}
            hint={rangeHint(ageInput, PLAUSIBLE_RANGES.ageYears)}
          />
          <NumberField
            id="dosing-weight"
            label="Peso real"
            unit="kg"
            value={weight}
            onChange={setWeight}
            placeholder="70"
            invalid={weightInput.invalid}
            hint={rangeHint(weightInput, PLAUSIBLE_RANGES.weightKg)}
          />
          <NumberField
            id="dosing-height"
            label="Talla"
            unit="cm"
            value={height}
            onChange={setHeight}
            placeholder="170"
            invalid={heightInput.invalid}
            hint={rangeHint(heightInput, PLAUSIBLE_RANGES.heightCm)}
          />
          <NumberField
            id="dosing-creatinine"
            label="Creatinina"
            unit="mg/dL"
            value={creatinine}
            onChange={setCreatinine}
            placeholder="1,0"
            invalid={creatinineInput.invalid}
            hint={rangeHint(creatinineInput, PLAUSIBLE_RANGES.creatinineMgDl)}
          />
        </div>
      </ToolSection>

      <ToolSection title="Antropometría y función renal">
        <div className="grid grid-cols-2 gap-2">
          <ResultTile
            testId="dosing-bmi"
            label="IMC"
            value={bmi !== null ? formatClinicalNumber(bmi, 1) : null}
            unit="kg/m²"
            hint={bmi !== null ? BMI_LABELS[classifyBmi(bmi)] : undefined}
          />
          <ResultTile
            testId="dosing-ideal"
            label="Peso ideal"
            value={ideal ? formatClinicalNumber(ideal.kg, 1) : null}
            unit="kg"
            hint={ideal?.extrapolated ? 'Devine, extrapolado bajo 152 cm' : 'Devine'}
          />
          <ResultTile
            testId="dosing-adjusted"
            label="Peso ajustado"
            value={adjusted !== null ? formatClinicalNumber(adjusted, 1) : null}
            unit="kg"
            hint={adjusted !== null ? 'Ideal + 40 % del exceso' : 'Desde +20 % del peso ideal'}
          />
          <ResultTile
            testId="dosing-bsa"
            label="Superficie corporal"
            value={bsa !== null ? formatClinicalNumber(bsa, 2) : null}
            unit="m²"
            hint="Mosteller"
          />
          <ResultTile
            testId="dosing-clearance"
            label="Clearance de creatinina"
            value={clearance !== null ? formatClinicalNumber(clearance, 0) : null}
            unit="mL/min"
            hint="Cockcroft-Gault con peso real; sólo adultos"
          />
        </div>
      </ToolSection>

      <ToolSection title="Dosis por peso">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            id="dosing-dose-per-kg"
            label="Dosis por kilo"
            value={dosePerKg}
            onChange={setDosePerKg}
            placeholder="1,5"
          />
          <SelectField
            id="dosing-dose-unit"
            label="Unidad"
            value={doseUnit}
            onChange={setDoseUnit}
            options={MASS_UNITS.map(item => ({ value: item, label: `${item}/kg` }))}
          />
        </div>
        <div className="mt-2">
          <SegmentedControl
            label="Peso para el cálculo"
            value={effectiveBasis}
            onChange={setWeightBasis}
            options={(['actual', 'ideal', 'adjusted'] as const).map(basis => ({
              value: basis,
              label: `${BASIS_LABELS[basis]} · ${kgLabel(basisWeights[basis])}`,
              disabled: basisWeights[basis] === null,
            }))}
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField
            id="dosing-presentation-amount"
            label="Presentación (opcional)"
            unit={doseUnit}
            value={presentationAmount}
            onChange={setPresentationAmount}
            placeholder="40"
          />
          <NumberField
            id="dosing-presentation-volume"
            label="en volumen"
            unit="mL"
            value={presentationVolume}
            onChange={setPresentationVolume}
            placeholder="2"
          />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2" role="status" aria-live="polite">
          <ResultTile
            testId="dosing-total"
            label="Dosis total"
            value={doseResult ? formatClinicalNumber(doseResult.totalDose) : null}
            unit={doseUnit}
            hint={
              doseResult
                ? `Peso ${BASIS_LABELS[effectiveBasis].toLowerCase()} ${kgLabel(doseWeight)}`
                : undefined
            }
            emphasis
          />
          <ResultTile
            testId="dosing-volume"
            label="Volumen a administrar"
            value={doseResult?.volumeMl != null ? formatClinicalNumber(doseResult.volumeMl) : null}
            unit="mL"
          />
        </div>
      </ToolSection>
    </ToolFrame>
  );
};
