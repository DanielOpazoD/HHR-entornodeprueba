# Cadencia de mantenimiento

Revisar mensualmente o al cerrar un bloque, y antes si aparece un problema real.
Esta cadencia aplica la [política de cambios](ENGINEERING_CHANGE_DECISION_POLICY.md);
no impone una cuota de shims retirados, tests divididos ni PR creados.

## Elegir un bloque

1. Partir del [estado verificable](../PROJECT_STATUS.md), el commit vigente y
   evidencia reproducible del problema.
2. Elegir pocos frentes con reducción demostrable de riesgo, coste de validación o
   acoplamiento. Antes de añadir algo, considerar eliminar, unificar o simplificar.
3. Agrupar cambios homogéneos por responsabilidad y validación compartida. Una
   migración mecánica de tests puede ser un solo PR; conservar los casos críticos.
4. Separar cambios que tengan riesgos, contratos o rollback diferentes. No partir
   ni fusionar archivos solamente para alcanzar una cifra.
5. Si una brecha ya está cubierta, registrar la evidencia y continuar. Cerrar el
   bloque cuando no quede beneficio demostrado, aunque haya menos cambios previstos.

## Evidencia vigente

Preferir los artefactos de CI del commit evaluado. Para regenerar localmente el
paquete canónico de gobernanza, primero producir la cobertura que ese paquete consume:

```sh
npm run check:critical-coverage
npm run report:governance-snapshots
npm run check:report-freshness:strict
```

`report:governance-snapshots` usa el grafo de dependencias existente; no mantener
otra lista manual de generadores. Los controles pueden señalar evidencia runtime
o de preview ausente: ejecutar el gate pertinente del
[checklist](SAFE_CHANGE_CHECKLIST.md), no inventar métricas ni rebajar el control.
Una ejecución local parcial no sustituye al CI completo del PR.

Los informes versionados pueden ser antiguos. Verificar commit, worktree, huellas
de entradas y origen antes de usar sus valores. Conservar la evidencia con el PR o
como artefacto de la ejecución; evitar copiar cifras en varios documentos de estado.

## Cerrar una iteración

- Documentar problema, beneficio observado, alcance, validación y rollback.
- Ejecutar los gates de la categoría del cambio según el checklist; no repetir
  componentes ya aprobados para el mismo código y entorno.
- Revisar el head definitivo, CI y observaciones pendientes antes de integrar.
- Actualizar instrucciones o enlaces que hayan cambiado. Los trackers cerrados
  permanecen históricos; no reescribir sus resultados como si fueran actuales.
- Conservar compatibilidad clínica hasta cumplir sus criterios de retiro. No crear
  nuevas capas transitorias sin una responsabilidad y una condición de salida.
