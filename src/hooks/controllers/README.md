# `src/hooks/controllers`

Controladores puros que usan los hooks compartidos: decisiones, estado derivado y traducción
de errores a mensajes, probados sin montar React. Un controlador propio del censo vive en
`src/features/census/controllers`; no puede haber dos implementaciones activas del mismo
controlador entre ambas rutas. Dónde va cada cosa:
[arquitectura](../../../docs/architecture.md).
