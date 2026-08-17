# Análisis de sensibilidad de las anclas

Toda la calibración de Vulnerabilidad de AppFair descansa en **ocho juicios de un experto**
(ver §6 de `docs/modelo-de-riesgo.md`). Nadie había medido qué pasa si ese experto se equivocó.

Esta herramienta lo mide: perturba cada ancla ±3, ±5 y ±8 puntos, **re-deriva** el parámetro que
esa ancla determina, y compara la grilla completa de 5×4 combinaciones contra la actual.

```bash
node tools/anchor-sensitivity/analizar.js --iteraciones 20000
node tools/anchor-sensitivity/analizar.js --json > sensibilidad.json
```

Es **diagnóstico**: no escribe nada, no toca la app, no se integra a la suite. Corre offline.

## Cómo evita medir su propio error

Tres cosas, y sin ellas el resultado no significaría nada:

- **Se ajusta contra la media SIMULADA, nunca contra la fórmula central.** Es la advertencia más
  fuerte del documento: con una función convexa la media de la simulación no coincide con la
  función de la media, y ajustar sobre la fórmula desplaza los resultados varios puntos. Aquí no
  hay álgebra, hay bisección sobre corridas Monte Carlo reales.
- **Números aleatorios comunes.** Todas las corridas comparten semilla, así que la diferencia entre
  dos calibraciones es la calibración y no el ruido de muestreo.
- **Control de autoconsistencia.** Antes de nada, re-deriva la calibración **sin perturbar** nada.
  Si no recupera `m = 6,8254` y el nodo 60 = 56,911, el análisis está midiendo el error del método y
  lo dice. Medido: `m = 6,9126` (1,3 % de desviación) y nodo 60 = 57,086 (0,3 %).

También descarta las perturbaciones **imposibles**: el piso de Vulnerabilidad es 0,5 %, así que
"oportunista vs básica (5 %) menos 8 puntos" pediría un −3 % inalcanzable. La bisección saturaría y
devolvería un número con toda la pinta de una medición. Esas filas se marcan, no se inventan.

## Resultados (20.000 iteraciones)

### 1. El modelo NO es frágil

| Ancla                          | pp de grilla por punto de error | peor caso (±8) |
| ------------------------------ | ------------------------------- | -------------- |
| 5. empleado desleal vs avanzada | **1,09**                        | 9,9 pp         |
| 3. organizado vs estándar       | 1,00                            | 8,4 pp         |
| 6. estado-nación vs élite       | 1,00                            | 8,1 pp         |
| 2. vandalismo vs básica         | 1,00                            | 8,1 pp         |
| 4. organizado vs élite          | 1,00                            | 8,0 pp         |
| 1. oportunista vs básica        | 1,00                            | 8,0 pp         |

Una sensibilidad de 1,00 significa que equivocarse un punto en un ancla mueve la grilla un punto.
**El error no se amplifica.** Y se queda **local**: para cinco de las seis anclas, la celda que más
se mueve es la del propio ancla, y el RMSE sobre las 20 celdas es ~1,8 pp para un error de 8 puntos
— o sea que el resto de la grilla casi no se entera.

### 2. `m = 6,8254` tiene falsa precisión

`m` oscila entre **4,68 y 9,64** a lo largo del rango de perturbación, aunque la grilla apenas se
mueva. Con un error de solo ±3 puntos en el ancla 3 —perfectamente plausible en un juicio experto—
`m` va de 6,17 a 7,79: **±12 %**.

`m` y el nodo 60 se compensan mutuamente para preservar las anclas, así que el **par** está bien
identificado aunque `m` por separado no lo esté. Publicarlo con cuatro decimales afirma una
precisión que el método no sostiene.

### 3. El hallazgo que no buscábamos: dos perfiles de atacante son el mismo

El ancla 5 es la única con sensibilidad > 1 y la única cuya celda más movida **no es la suya**
(mueve `empleado-desleal vs estándar` y, a +8, `organizado vs avanzada`). Investigando por qué:

```
empleado-desleal   FA=60,0  C=56,911   motivación=80 recursos=52 capacidad=58 persistencia=62 sofisticación=48
organizado         FA=60,0  C=56,911   motivación=65 recursos=60 capacidad=60 persistencia=65 sofisticación=50
```

**Atributos distintos, mismo promedio, misma fuerza de contienda.** El modelo no los distingue: dan
la misma Vulnerabilidad contra cualquier defensa (98,5 / 59,3 / 30,4 / 14,7 contra 98,5 / 59,6 /
30,8 / 15,0 — la diferencia es ruido de muestreo). De los cinco perfiles de atacante, **cuatro son
distinguibles**.

La causa es que el Factor de Amenaza es un **promedio simple** de los cinco atributos, y eso es
lossy: un insider muy motivado pero poco sofisticado colapsa al mismo número que un grupo de crimen
organizado equilibrado. Un analista que elige entre "Empleado desleal" y "Crimen organizado" está
eligiendo entre dos etiquetas que producen el mismo resultado.

> Matiz honesto: lo que de verdad distingue a un insider —que ya está adentro— sí se modela aparte,
> en el **Nivel de Acceso**. Así que el colapso no es tan grave como parece a primera vista. Pero
> sigue siendo cierto que la motivación (80 vs 65) se pierde por completo en el promedio.

## Qué se hace con esto

**La recalibración para quitar el tope de 100 es de BAJO riesgo.** Ésa era la pregunta que este
análisis venía a responder, y la respuesta es que sí: como los errores no se amplifican y se quedan
locales, mover la calibración no desestabiliza la grilla. Se puede acometer con confianza.

Pendientes que este análisis destapó, en orden de valor:

1. **Ponderar los atributos del Factor de Amenaza** en vez de promediarlos simple, o reconocer en la
   interfaz que ambos perfiles dan el mismo resultado. Hoy la app ofrece una distinción que no
   existe en el cálculo.
2. **Publicar `m` con la precisión que tiene** (≈ 6,8 ± 0,8), no con cuatro decimales.
3. Si alguna vez se re-emiten anclas, la 5 es la que más conviene revisar: es la única que contamina
   celdas ajenas, por compartir nodo con `organizado`.
