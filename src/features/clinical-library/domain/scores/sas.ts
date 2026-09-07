import type { ScoreDefinition } from '../scoreEngine';

export const SAS: ScoreDefinition = {
  id: 'sas',
  name: 'SAS (Sedation-Agitation Scale de Riker)',
  shortName: 'SAS',
  purpose:
    'Nivel de sedación o agitación del paciente crítico para titular sedantes a un objetivo.',
  items: [
    {
      id: 'level',
      kind: 'choice',
      label: 'Estado observado',
      options: [
        { value: '7', label: 'Agitación peligrosa: tira de tubos o catéteres, agrede', points: 7 },
        {
          value: '6',
          label: 'Muy agitado: no se calma con la voz, muerde el tubo, requiere contención',
          points: 6,
        },
        {
          value: '5',
          label: 'Agitado: ansioso o inquieto, se calma con indicaciones verbales',
          points: 5,
        },
        {
          value: '4',
          label: 'Tranquilo y cooperador: despierta fácil, obedece órdenes',
          points: 4,
        },
        {
          value: '3',
          label: 'Sedado: despierta a estímulo verbal o sacudida suave, se vuelve a dormir',
          points: 3,
        },
        {
          value: '2',
          label: 'Muy sedado: despierta a estímulo físico, no obedece órdenes',
          points: 2,
        },
        {
          value: '1',
          label: 'No despertable: mínima o nula respuesta a estímulo doloroso',
          points: 1,
        },
      ],
    },
  ],
  bands: [
    {
      min: 1,
      max: 2,
      label: 'Sedación profunda',
      tone: 'warning',
      detail: 'Por debajo del objetivo habitual: reevaluar dosis de sedantes y necesidad clínica.',
    },
    {
      min: 3,
      max: 3,
      label: 'Sedado',
      tone: 'info',
      detail: 'Sedación ligera; objetivo aceptable en ventilación mecánica según protocolo.',
    },
    {
      min: 4,
      max: 4,
      label: 'Tranquilo y cooperador',
      tone: 'success',
      detail: 'Objetivo habitual de sedación en el paciente crítico.',
    },
    {
      min: 5,
      max: 7,
      label: 'Agitación',
      tone: 'danger',
      detail:
        'Buscar causa (dolor, delirium, hipoxemia, abstinencia) antes de aumentar sedación; con 6 a 7 proteger vía aérea y dispositivos.',
    },
  ],
  reference: {
    citation:
      'Riker RR, Picard JT, Fraser GL. Prospective evaluation of the Sedation-Agitation Scale for adult critically ill patients. Crit Care Med. 1999;27(7):1325-1329.',
    url: 'https://doi.org/10.1097/00003246-199907000-00022',
  },
};
