# `src/components/modals`

Modales usados desde más de un lugar: acciones clínicas (`actions/`), camas, personal,
datos demográficos, historial del paciente y configuración. Todos se construyen sobre
`BaseModal`; la validación y las transiciones viven en hooks y controladores, no en el modal.
Un modal que solo abre un área va en esa área. Dónde va cada cosa:
[arquitectura](../../../docs/architecture.md).
