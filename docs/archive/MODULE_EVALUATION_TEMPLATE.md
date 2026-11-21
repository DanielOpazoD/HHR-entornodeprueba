# Planilla Estándar de Evaluación por Módulo

## Propósito

Esta planilla sirve para evaluar cada módulo del programa de forma comparable, repetible y accionable.

La idea no es solo poner una nota, sino:

- entender el estado real del módulo
- detectar riesgos y deuda técnica relevante
- proponer mejoras de alto valor sin sobreingeniería
- cerrar cada análisis con un plan verificable

---

## Metadatos del módulo

- **Módulo:**
- **Ruta(s) principal(es):**
- **Owner / responsable actual:**
- **Fecha de evaluación:**
- **Versión / commit de referencia:**
- **Evaluador:**
- **Estado general:** `verde / amarillo / rojo`

---

## 1. Nota global

- **Nota global (1 a 7):**
- **Resumen ejecutivo breve:**

Guía rápida:

- `1.0 – 2.9`: módulo frágil o muy desordenado
- `3.0 – 4.4`: módulo funcional pero con deuda importante
- `4.5 – 5.7`: módulo aceptable, con base útil pero todavía con fricción real
- `5.8 – 6.4`: módulo serio, mantenible y bastante maduro
- `6.5 – 6.8`: módulo muy sólido, con deuda controlada
- `6.9 – 7.0`: excelencia práctica, deuda residual menor

---

## 2. Evaluación multiparamétrica

Poner nota 1–7 y comentario corto en cada dimensión.

| Dimensión                        | Nota | Comentario |
| -------------------------------- | ---: | ---------- |
| Calidad general                  |      |            |
| Estructura                       |      |            |
| Organización                     |      |            |
| Buenas prácticas de codificación |      |            |
| Coherencia funcional             |      |            |
| Separación y límites             |      |            |
| Estabilidad                      |      |            |
| Escalabilidad                    |      |            |
| Documentación                    |      |            |
| Tests                            |      |            |

---

## 3. Qué hace bien este módulo

Listar fortalezas reales y específicas.

-
-
-

---

## 4. Hallazgos principales

Describir lo más importante que hoy limita calidad, velocidad o estabilidad.

-
-
-

---

## 5. Riesgos actuales

Separar el riesgo técnico del riesgo operativo.

### Riesgo técnico

-
-

### Riesgo operativo / clínico

-
-

---

## 6. Hotspots y archivos clave

Anotar los archivos con más peso, churn o sensibilidad.

| Archivo | Rol | Riesgo / observación |
| ------- | --- | -------------------- |
|         |     |                      |
|         |     |                      |
|         |     |                      |

---

## 7. Guardrails y checks relevantes

Marcar qué checks aplican a este módulo.

- `npm run typecheck`
- `npm run check:quality`
- suite focalizada del módulo
- `bash scripts/run-firestore-rules-ci.sh` si toca permisos
- build si toca loaders, impresión, PDFs, assets o lazy-loading
- otros:

Resultado actual:

- **Typecheck:**
- **Quality:**
- **Tests focalizados:**
- **Otros checks:**

---

## 8. Deuda técnica priorizada

Ordenar por impacto y retorno.

### P1

-
-

### P2

-
-

### P3

-
-

---

## 9. Plan de mejoras por bloques

Cada bloque debe ser pequeño, verificable y con retorno claro.

### Bloque 1

- **Objetivo:**
- **Cambio esperado:**
- **Archivos probables:**
- **Tests / checks requeridos:**
- **Criterio de cierre:**

### Bloque 2

- **Objetivo:**
- **Cambio esperado:**
- **Archivos probables:**
- **Tests / checks requeridos:**
- **Criterio de cierre:**

### Bloque 3

- **Objetivo:**
- **Cambio esperado:**
- **Archivos probables:**
- **Tests / checks requeridos:**
- **Criterio de cierre:**

---

## 10. Recomendación de estrategia

Elegir una sola:

- **Mantención prudente:** está suficientemente sano; solo ajustes chicos
- **Saneamiento focalizado:** conviene una ronda de mejoras por bloques
- **Reorganización moderada:** necesita convergencia estructural limitada
- **Intervención prioritaria:** hoy es una fuente real de riesgo

Justificación:

-

---

## 11. Estado deseado después de la ronda

Describir cómo se vería el módulo si la siguiente ola sale bien.

-
-
-

---

## 12. Cierre de evaluación

- **¿Se recomienda abrir mejora ahora?** `sí / no`
- **Siguiente módulo sugerido después de este:**
- **Notas adicionales:**
