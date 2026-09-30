import type { ModuleType } from '@/constants/navigationConfig';

/** Only the module identifier enters this guide, never a patient or record. */
export const getMoaHelpContext = (module?: ModuleType) => {
  switch (module) {
    case 'CENSUS':
      return {
        title: 'Censo diario',
        description:
          'Comprueba la fecha del registro. Usa «Más opciones del censo» para buscar pacientes y abrir las herramientas disponibles.',
      };
    case 'NURSING_HANDOFF':
      return {
        title: 'Entrega de enfermería',
        description:
          'Comprueba la fecha y el turno. Revisa los campos pendientes antes de exportar o compartir, si tu perfil lo permite.',
      };
    case 'MEDICAL_HANDOFF':
      return {
        title: 'Entrega médica',
        description:
          'Comprueba la fecha y la especialidad de la entrega. La edición, firma y envío dependen de tu perfil.',
      };
    case 'CUDYR':
      return {
        title: 'Categorización CUDYR',
        description:
          'Comprueba la fecha y el paciente antes de revisar la categorización. La edición depende de tu perfil y del día seleccionado.',
      };
    default:
      return {
        title: 'Herramientas de HHR',
        description:
          'Abre las opciones del módulo actual. Los accesos disponibles dependen de tu perfil.',
      };
  }
};
