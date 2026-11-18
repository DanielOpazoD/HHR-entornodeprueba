# `src/components/modals`

Modales de solicitud de exámenes e imágenes, historial del paciente y configuración. Todos se
construyen sobre `BaseModal`; la validación y las transiciones viven en hooks y controladores, no en
el modal. Un modal que solo abre un área va en esa área: los del censo (alta, traslado, mover o
copiar, camas, personal y datos demográficos) viven en `src/features/census/components/`, y el visor
de radiología, en `src/features/radiology/`. Dónde va cada cosa:
[arquitectura](../../../docs/architecture.md).
