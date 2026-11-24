// NT MINSAL 234, §7.2 and annexes 1.1–1.2; age groups from HHR GCL 2.2, §§8.1–8.2.
// Options summarize clinical anchors. The evaluating professional selects each subscore.
const scored = (id, label, anchors) => ({
  id,
  label,
  required: true,
  type: 'choice',
  options: anchors.map((anchor, i) => ({ label: i + 1 + ' · ' + anchor, points: i + 1 })),
});

const mobility = scored('movilidad', 'Movilidad', [
  'Inmóvil. Sin cambios de posición del cuerpo o las extremidades sin ayuda.',
  'Muy limitada. Hace cambios leves ocasionales. Precisa ayuda para cambios frecuentes o importantes.',
  'Ligeramente limitada. Hace cambios frecuentes y leves sin ayuda.',
  'Sin limitación. Hace cambios frecuentes e importantes sin ayuda.',
]);
const sensation = scored('percepcion', 'Percepción sensorial', [
  'Completamente limitada. Sin respuesta al dolor o con pérdida de sensibilidad en la mayor parte del cuerpo.',
  'Muy limitada. Solo responde al dolor, con gemidos o inquietud, o presenta un déficit sensitivo extenso.',
  'Ligeramente limitada. Responde a órdenes, pero no siempre comunica malestar, o tiene déficit sensitivo en una o dos extremidades.',
  'Sin limitación. Responde y puede sentir y comunicar el malestar por presión.',
]);
const activity = [
  'Permanece en cama.',
  'En silla. Marcha muy limitada o ausente. Precisa ayuda para sentarse o no soporta su peso.',
  'Camina ocasionalmente distancias cortas. Pasa la mayor parte del turno en cama o en silla.',
];
const evaluation = [
  { id: 'fecha', label: 'Fecha de valoración', type: 'date', required: true },
  { id: 'hora', label: 'Hora de valoración (Rapa Nui)', type: 'time', required: true },
  {
    id: 'piel',
    label: 'Valoración de la piel, prominencias óseas y zonas de contacto con dispositivos',
    type: 'text',
    required: true,
  },
];

const adult = {
  id: 'hhr-lpp-braden-adulto',
  version: 1,
  title: 'LPP · Braden adulto (desde 15 años)',
  riskBands: { highMax: 12, moderateMax: 15 },
  fields: [
    sensation,
    scored('humedad', 'Exposición a la humedad', [
      'Constante. Piel húmeda cada vez que se moviliza.',
      'Frecuente. Requiere cambiar la ropa de cama al menos una vez por turno.',
      'Ocasional. Requiere aproximadamente un cambio adicional de ropa de cama al día.',
      'Rara. Piel habitualmente seca. Basta el cambio de ropa de rutina.',
    ]),
    scored('actividad', 'Actividad física', [
      ...activity,
      'Camina fuera de la habitación al menos dos veces al día y dentro al menos cada dos horas mientras está en vigilia.',
    ]),
    mobility,
    scored('nutricion', 'Nutrición', [
      'Muy deficiente. Rara vez come más de un tercio, ingesta proteica y líquida escasa, o ayuno, líquidos claros o suero IV por más de 5 días.',
      'Probablemente inadecuada. Come cerca de la mitad, hasta tres raciones proteicas al día, o recibe alimentación por sonda insuficiente.',
      'Adecuada. Come más de la mitad y cuatro raciones proteicas al día, o el soporte nutricional cubre la mayoría de sus necesidades.',
      'Excelente. Come la mayoría de las comidas, cuatro o más raciones proteicas al día y no precisa suplementos.',
    ]),
    scored('friccion', 'Fricción y cizalla', [
      'Problema. Precisa ayuda moderada o máxima, se desliza repetidamente o presenta fricción casi constante.',
      'Problema potencial. Se mueve con debilidad o ayuda mínima. Hay roce o deslizamientos ocasionales.',
      'Sin problema aparente. Se eleva y mueve sin ayuda, y mantiene una buena posición.',
    ]),
    ...evaluation,
  ],
};
const pediatric = {
  id: 'hhr-lpp-braden-q',
  version: 1,
  title: 'LPP · Braden Q pediátrica (desde 30 días hasta antes de los 15 años)',
  riskBands: { highMax: 16, moderateMax: 21 },
  fields: [
    mobility,
    scored('actividad', 'Actividad física según desarrollo', [
      ...activity,
      'Por edad aún no le corresponde caminar, o camina fuera de la habitación dos veces al día y dentro al menos cada dos horas en vigilia.',
    ]),
    { ...sensation, label: 'Percepción sensorial según el desarrollo' },
    scored('humedad', 'Exposición a la humedad', [
      'Constante. Se detecta humedad cada vez que se gira o mueve.',
      'Frecuente. Requiere cambiar la ropa de cama al menos cada 8 horas.',
      'Ocasional. Requiere cambiar la ropa de cama cada 12 horas.',
      'Rara. Piel casi siempre seca. Pañales de rutina y cambio de ropa de cama cada 24 horas.',
    ]),
    scored('friccion', 'Fricción y cizallamiento', [
      'Problema significativo. Espasticidad, contracturas, prurito o agitación causan fricción casi constante.',
      'Problema. Precisa ayuda moderada o máxima, roza las sábanas y se desliza con frecuencia.',
      'Problema potencial. Se mueve con debilidad o ayuda mínima y se desliza ocasionalmente.',
      'Sin problema aparente. Se eleva sin roce, se mueve con independencia y mantiene una buena postura.',
    ]),
    scored(
      'nutricion',
      'Nutrición según edad y soporte (descriptores abreviados del anexo 1.2 de la NT 234)',
      [
        'Muy pobre. Ayuno, dieta líquida o sueroterapia prolongada, o ingesta muy escasa, con dos o menos raciones proteicas al día.',
        'Inadecuada. Soporte enteral o parenteral insuficiente para la edad, o suele comer solo la mitad, con unas tres raciones proteicas al día.',
        'Adecuada. Soporte nutricional suficiente para la edad, o come la mitad de la mayoría de las comidas y cuatro raciones proteicas al día.',
        'Excelente. Dieta suficiente para la edad. Come o bebe la mayoría de cada comida o toma y no precisa suplementos.',
      ]
    ),
    scored('perfusion', 'Perfusión tisular y oxigenación', [
      'Muy comprometida. Hipotensión (PAM menor de 50 mmHg) o intolerancia fisiológica al cambio postural.',
      'Comprometida. Normotensión con pH menor de 7,40. Puede haber saturación menor de 95 %, hemoglobina baja o relleno capilar mayor de 2 s.',
      'Adecuada. Normotensión con pH normal. Puede haber saturación menor de 95 %, hemoglobina baja o relleno capilar mayor de 2 s.',
      'Excelente. Normotensión, saturación mayor de 95 %, hemoglobina normal y relleno capilar menor de 2 segundos.',
    ]),
    ...evaluation,
  ],
};

module.exports = { pressureInjuryTemplates: [adult, pediatric] };
