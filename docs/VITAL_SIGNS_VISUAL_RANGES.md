# Rangos visuales de signos vitales

## Propósito

La columna **Signos** del censo es una ayuda visual de tamizaje. No calcula un diagnóstico ni
reemplaza la evaluación clínica. La interfaz permanece minimalista: sólo cambia el color del valor
y del borde lateral; no añade etiquetas de población ni de estado.

La configuración ejecutable está centralizada en
`src/constants/vitalSignsThresholds.ts`.

## Significado de colores

| Presentación      | Significado                                                      |
| ----------------- | ---------------------------------------------------------------- |
| Gris              | Valor visible sin una banda segura para esa población o métrica. |
| Negro/gris oscuro | Dentro de la banda visual habitual.                              |
| Naranjo           | Fuera de la banda habitual o CEWT 1–2; requiere revisión.        |
| Rojo              | CEWT 3 o desviación marcada; requiere evaluación prioritaria.    |

## Selección de población

| Perfil   | Edad cumplida en la fecha histórica de la medición   |
| -------- | ---------------------------------------------------- |
| Sin edad | Datos insuficientes: todos los valores quedan grises |
| RN       | 0–27 días                                            |
| <1 año   | 28 días hasta antes del primer cumpleaños            |
| 1–4      | 1–4 años                                             |
| 5–11     | 5–11 años                                            |
| 12–17    | 12–17 años                                           |
| Adulto   | 18 años o más                                        |

Se usa primero la fecha de nacimiento y la fecha de la medición. Si faltan, se acepta una edad
explícita en días, meses o años. La cama `NEO1`, `NEO2`, el modo Cuna o ser una subfila **no**
determinan el perfil.

Si no existe fecha de nacimiento ni una edad explícita interpretable, HHR no presume que el
paciente sea adulto: conserva todos los valores en gris hasta disponer de edad suficiente. Cada
fila del historial se clasifica usando la edad que el paciente tenía en la fecha de esa medición.

## Perfiles pediátricos Queensland Health

Las bandas negras son los rangos estándar CEWT de Queensland Health. Las bandas naranjas reúnen
CEWT 1–2 y las rojas corresponden a CEWT 3. En PA, un valor sobre el rango estándar se muestra
naranjo, pero no rojo: la tabla CEWT citada sólo define escalamiento por hipotensión y la hipertensión
pediátrica requiere percentiles y contexto clínico.

| Perfil | PA sistólica normal | PA roja | FC normal | FC roja    | FR normal | FR roja   |
| ------ | ------------------- | ------- | --------- | ---------- | --------- | --------- |
| <1 año | 75–119              | <55     | 100–159   | ≤80 o ≥190 | 21–45     | ≤15 o ≥55 |
| 1–4    | 80–124              | <65     | 90–139    | ≤70 o ≥170 | 16–35     | ≤10 o ≥50 |
| 5–11   | 85–129              | <65     | 80–129    | ≤60 o ≥170 | 16–30     | ≤5 o ≥45  |
| 12–17  | 90–149              | <80     | 60–119    | ≤40 o ≥150 | 16–25     | ≤5 o ≥35  |

Para todos esos perfiles:

- **SatO₂:** negro ≥94%, naranjo 90–93%, rojo <90%.
- **Temperatura:** negro 35,5–37,9 °C; fuera de esa banda, naranjo. Queensland CEWT no aporta una
  banda CEWT 3 de temperatura en la referencia utilizada, por lo que HHR no inventa un umbral rojo.
- **EVA y HGT:** permanecen grises en menores de un año. Desde 1 año conservan las reglas internas
  existentes; no forman parte de esta adopción CEWT.

## Perfil RN (0–27 días)

RN permanece separado porque la interpretación neonatal depende de horas de vida, edad gestacional,
peso y contexto perinatal. Su selección es exclusivamente etaria.

| Métrica  | Negro/gris oscuro              | Naranjo                 | Rojo        |
| -------- | ------------------------------ | ----------------------- | ----------- |
| PA       | Gris: sin clasificación        | —                       | —           |
| FC       | 100–160 lpm                    | 80–99 o 161–180         | <80 o >180  |
| SatO₂    | ≥94%                           | 90–93%                  | <90%        |
| T°       | 36,5–37,5 °C                   | >35,5–<36,5 o >37,5–<38 | ≤35,5 o ≥38 |
| FR       | 30–60 rpm                      | 20–29 o 61–70           | <20 o >70   |
| EVA/HGT  | Gris: sin clasificación        | —                       | —           |
| Ins/Cuad | Registro, no rango fisiológico | —                       | —           |

## Perfil adulto

| Métrica      | Negro/gris oscuro | Naranjo               | Rojo       |
| ------------ | ----------------- | --------------------- | ---------- |
| PA sistólica | 100–160 mmHg      | 91–99 o 161–180       | ≤90 o ≥181 |
| FC           | 50–100 lpm        | 41–49 o 101–129       | ≤40 o ≥130 |
| SatO₂        | ≥94%              | 90–93%                | <90%       |
| T°           | 35,5–37,7 °C      | >35–<35,5 o >37,7–<39 | ≤35 o ≥39  |
| FR           | 12–20 rpm         | 9–11 o 21–24          | ≤8 o ≥25   |
| EVA          | 0–3               | 4–6                   | ≥7         |
| HGT          | 70–180 mg/dL      | 55–69 o 181–399       | ≤54 o ≥400 |

## Referencias y límites

- [Children’s Health Queensland: rangos normales por edad basados en CEWT](https://www.childrens.health.qld.gov.au/for-health-professionals/clinical-education-and-training/paediatric-emergency-education-program/case-based-discussions-introduction-to-paediatric-emergency-medicine)
- [Queensland Health: observaciones clínicas pediátricas estándar](https://www.health.qld.gov.au/__data/assets/pdf_file/0035/736928/a-wts01.pdf)
- [Children’s Health Queensland: parámetros de escalamiento CEWT](https://www.childrens.health.qld.gov.au/__data/assets/pdf_file/0015/180204/gdl-00759.pdf)

Los valores deben interpretarse con la situación clínica, tendencia y metas prescritas. Una banda
negra no excluye deterioro y una banda roja no constituye por sí sola un diagnóstico u orden
terapéutica.
