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
import { PLAUSIBLE_RANGES, plausibleValue, rangeHint } from './plausibleRanges';
import { formatClinicalNumber } from '../libraryPresentation';
import { NumberField, ResultTile, SegmentedControl, SelectField, ToolSection } from './ToolField';
import { ToolFrame } from './ToolFrame';

const BMI_LABELS: Readonly<Record<BmiCategory, string>> = {
  underweight: 'Bajo peso',
  normal: 'Normal',
  overweight: 'Sobrepeso',
  obesity: 'Obesidad',
};

const kgLabel = (value: number | null): string =>
  value === null ? 'no disponible' : `${formatClinicalNumber(value, 1)} kg`;

export const DosingCalculatorTool: React.FC<{ onBack: () => void }> = ({ onBack }) => {
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
  const ageYears = ageInput.value;
  const creatinineMgDl = creatinineInput.value;

  const bmi = weightKg !== null && heightCm !== null ? computeBmi(weightKg, heightCm) : null;
  const ideal = heightCm !== null ? idealBodyWeightDevine(heightCm, sex) : null;
  const adjusted = weightKg !== null && ideal ? adjustedBodyWeight(weightKg, ideal.kg) : null;
  const bsa =
    weightKg !== null && heightCm !== null ? bodySurfaceAreaMosteller(weightKg, heightCm) : null;
  const clearance =
    ageYears !== null && weightKg !== null && creatinineMgDl !== null
      ? cockcroftGaultClearance({ ageYears, weightKg, creatinineMgDl, sex })
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
      title="Cálculo de dosis y antropometría"
      description="Peso ideal y ajustado, IMC, superficie corporal, clearance de creatinina y dosis por kilo."
      icon={<Calculator size={16} aria-hidden="true" />}
      onBack={onBack}
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
            invalid={ageInput.invalid}
            hint={rangeHint(ageInput, PLAUSIBLE_RANGES.ageYears)}
            label="Edad"
            unit="años"
            value={age}
            onChange={setAge}
            placeholder="65"
          />
          <NumberField
            id="dosing-weight"
            invalid={weightInput.invalid}
            hint={rangeHint(weightInput, PLAUSIBLE_RANGES.weightKg)}
            label="Peso real"
            unit="kg"
            value={weight}
            onChange={setWeight}
            placeholder="70"
          />
          <NumberField
            id="dosing-height"
            invalid={heightInput.invalid}
            hint={rangeHint(heightInput, PLAUSIBLE_RANGES.heightCm)}
            label="Talla"
            unit="cm"
            value={height}
            onChange={setHeight}
            placeholder="170"
          />
          <NumberField
            id="dosing-creatinine"
            invalid={creatinineInput.invalid}
            hint={rangeHint(creatinineInput, PLAUSIBLE_RANGES.creatinineMgDl)}
            label="Creatinina"
            unit="mg/dL"
            value={creatinine}
            onChange={setCreatinine}
            placeholder="1,0"
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
            hint={bmi !== null ? BMI_LABELS[classifyBmi(bmi)] : 'Peso y talla'}
          />
          <ResultTile
            testId="dosing-ideal"
            label="Peso ideal"
            value={ideal ? formatClinicalNumber(ideal.kg, 1) : null}
            unit="kg"
            hint={ideal?.extrapolated ? 'Devine; extrapolado bajo 152 cm' : 'Devine'}
          />
          <ResultTile
            testId="dosing-adjusted"
            label="Peso ajustado"
            value={adjusted !== null ? formatClinicalNumber(adjusted, 1) : null}
            unit="kg"
            hint={
              adjusted !== null
                ? 'Ideal + 40 % del exceso'
                : 'Sólo si el peso real supera al ideal en 20 % o más'
            }
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
            hint="Cockcroft-Gault con el peso real ingresado; sólo adultos"
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
            options={[
              {
                value: 'actual',
                label: `Real · ${kgLabel(basisWeights.actual)}`,
                disabled: basisWeights.actual === null,
              },
              {
                value: 'ideal',
                label: `Ideal · ${kgLabel(basisWeights.ideal)}`,
                disabled: basisWeights.ideal === null,
              },
              {
                value: 'adjusted',
                label: `Ajustado · ${kgLabel(basisWeights.adjusted)}`,
                disabled: basisWeights.adjusted === null,
                title: 'Disponible cuando el peso real supera al ideal en 20 % o más',
              },
            ]}
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
                ? `Con peso ${effectiveBasis === 'actual' ? 'real' : effectiveBasis === 'ideal' ? 'ideal' : 'ajustado'} de ${kgLabel(doseWeight)}`
                : 'Dosis por kilo y peso'
            }
            emphasis
          />
          <ResultTile
            testId="dosing-volume"
            label="Volumen a administrar"
            value={doseResult?.volumeMl != null ? formatClinicalNumber(doseResult.volumeMl) : null}
            unit="mL"
            hint="Según la presentación ingresada"
          />
        </div>
      </ToolSection>
    </ToolFrame>
  );
};
