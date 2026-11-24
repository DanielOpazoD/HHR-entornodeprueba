// NT MINSAL 234 & Hospital Hanga Roa Pauta Braden adulto / Braden Q pediátrico.
// Exact dimension order, labels, cutoffs and planned care from Pauta-Braden-adulto-y-pediatrico-NT234.pdf.
const scored = (id, shortCode, label, anchors) => ({
  id,
  shortCode,
  label,
  required: true,
  type: 'choice',
  options: anchors.map((anchor, i) => ({ label: i + 1 + ' · ' + anchor, points: i + 1 })),
});

const CARE_PLANS = {
  bajo: ['Cuidados básicos de enfermería.'],
  moderado: [
    'Posición: cada 4 h con SEMP adecuada; sin ella, cada 2 h.',
    'Proteger prominencias óseas; mantener piel seca e hidratada.',
  ],
  alto: [
    'Posición: cada 3 h con SEMP adecuada; sin ella, cada 2 h.',
    'Proteger prominencias óseas; mantener piel seca e hidratada.',
    'SEMP adecuada: colchón antiescaras/viscoelástico según indicación.',
  ],
};

const evaluation = [
  { id: 'fecha', label: 'Fecha de valoración', type: 'date', required: true },
  { id: 'hora', label: 'Hora de valoración (Rapa Nui)', type: 'time', required: true },
  {
    id: 'piel',
    label: 'Observaciones de piel e intervenciones',
    type: 'text',
    required: false,
  },
];

const adult = {
  id: 'hhr-lpp-braden-adulto',
  version: 2,
  scaleGroup: 'braden',
  ageRangeLabel: '≥15 años | Total: 6-23',
  title: 'LPP · Braden adulto (≥15 años)',
  riskBands: { highMax: 12, moderateMax: 15 },
  carePlans: CARE_PLANS,
  fields: [
    scored('percepcion', 'PS', 'PS · Percepción sensorial', [
      'Completamente limitada',
      'Muy limitada',
      'Ligeramente limitada',
      'No limitada',
    ]),
    scored('humedad', 'H', 'H · Humedad', [
      'Constantemente húmeda',
      'Muy húmeda',
      'Ocasionalmente húmeda',
      'Raramente húmeda',
    ]),
    scored('actividad', 'A', 'A · Actividad', [
      'Postrado en cama',
      'En silla de ruedas',
      'Anda ocasionalmente',
      'Anda con frecuencia',
    ]),
    scored('movilidad', 'M', 'M · Movilidad', [
      'Completamente inmóvil',
      'Muy limitada',
      'Ligeramente limitada',
      'Sin limitación',
    ]),
    scored('nutricion', 'N', 'N · Nutrición', [
      'Muy deficiente',
      'Probablemente inadecuada',
      'Adecuada',
      'Excelente',
    ]),
    scored('friccion', 'F', 'F · Fricción y cizalla', [
      'Problema',
      'Posibles problemas',
      'Sin problemas aparentes',
    ]),
    ...evaluation,
  ],
};

const pediatric = {
  id: 'hhr-lpp-braden-q',
  version: 2,
  scaleGroup: 'braden',
  ageRangeLabel: '30 días a <15 años | Total: 7-28',
  title: 'LPP · Braden Q pediátrico (30 días a <15 años)',
  riskBands: { highMax: 16, moderateMax: 21 },
  carePlans: CARE_PLANS,
  fields: [
    scored('percepcion', 'PS', 'PS · Percepción sensorial', [
      'Completamente limitada',
      'Muy limitada',
      'Ligeramente limitada',
      'Sin limitaciones',
    ]),
    scored('humedad', 'H', 'H · Humedad', [
      'Constantemente húmeda',
      'Muy húmeda',
      'Ocasionalmente húmeda',
      'Raramente húmeda',
    ]),
    scored('actividad', 'A', 'A · Actividad', [
      'Encamado',
      'En silla',
      'Camina ocasionalmente',
      'Demasiado joven para caminar o camina frecuentemente',
    ]),
    scored('movilidad', 'M', 'M · Movilidad', [
      'Completamente inmóvil',
      'Muy limitada',
      'Ligeramente limitada',
      'Sin limitaciones',
    ]),
    scored('nutricion', 'N', 'N · Nutrición', ['Muy pobre', 'Inadecuada', 'Adecuada', 'Excelente']),
    scored('friccion', 'F', 'F · Fricción y cizallamiento', [
      'Problema significativo',
      'Problema',
      'Problema potencial',
      'Sin problema aparente',
    ]),
    scored('perfusion', 'PO', 'PO · Perfusión y oxigenación', [
      'Muy comprometida: Hipotensión (PAM <50 mmHg) o intolerancia fisiológica a cambios posturales.',
      'Comprometida: Normotenso; pH <7,40. Puede presentar SatO2 <95%, Hb <10 g/dL o relleno capilar >2 s.',
      'Adecuada: Normotenso; pH normal. Puede presentar SatO2 <95%, Hb <10 g/dL o relleno capilar >2 s.',
      'Excelente: Normotenso; SatO2 >95%, Hb normal y relleno capilar <2 s.',
    ]),
    ...evaluation,
  ],
};

module.exports = { CARE_PLANS, pressureInjuryTemplates: [adult, pediatric] };
