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
  Si no recupera `m = 6,8254`, el nodo 60 = 56,911 y el nodo 54,2 = 40,911, el análisis está
  midiendo el error del método y lo dice. Medido: `m = 6,9126` (1,3 % de desviación), nodo 60 =
  57,086 (0,3 %) y nodo 54,2 = 40,854 (0,1 %).

También descarta las perturbaciones **imposibles**: el piso de Vulnerabilidad es 0,5 %, así que
"oportunista vs básica (5 %) menos 8 puntos" pediría un −3 % inalcanzable. La bisección saturaría y
devolvería un número con toda la pinta de una medición. Esas filas se marcan, no se inventan.

## Resultados (20.000 iteraciones)

### 1. El modelo NO es frágil

| Ancla                           | pp de grilla por punto de error | peor caso (±8) |
| ------------------------------- | ------------------------------- | -------------- |
| 3. organizado vs estándar       | 1,00                            | 8,4 pp         |
| 6. estado-nación vs élite       | 1,00                            | 8,1 pp         |
| 2. vandalismo vs básica         | 1,00                            | 8,1 pp         |
| 4. organizado vs élite          | 1,00                            | 8,0 pp         |
| 1. oportunista vs básica        | 1,00                            | 8,0 pp         |
| 5. empleado desleal vs avanzada | 0,90                            | 7,2 pp         |

> Los números de esta tabla son POSTERIORES a la calibración 6. En la medición original el ancla 5
> daba **1,09** (la única por encima de 1) y su peor caso era de 9,9 pp — porque compartía nodo con
> `organizado`. Arreglado eso (ver §3), bajó a 0,90 y dejó de ser la excepción.

Una sensibilidad de 1,00 significa que equivocarse un punto en un ancla mueve la grilla un punto.
**El error no se amplifica.** Y se queda **local**: la celda que más se mueve es la del propio
ancla, y el RMSE sobre las 20 celdas es ~1,8 pp para un error de 8 puntos — o sea que el resto de
la grilla casi no se entera. (En la medición original esto valía para cinco de las seis anclas; la
sexta era la 5, y por eso se investigó — ver §3.)

### 2. `m = 6,8254` tiene falsa precisión

`m` oscila entre **4,68 y 9,64** a lo largo del rango de perturbación, aunque la grilla apenas se
mueva. Con un error de solo ±3 puntos en el ancla 3 —perfectamente plausible en un juicio experto—
`m` va de 6,17 a 7,79: **±12 %**.

`m` y el nodo 60 se compensan mutuamente para preservar las anclas, así que el **par** está bien
identificado aunque `m` por separado no lo esté. Publicarlo con cuatro decimales afirma una
precisión que el método no sostiene.

### 3. El hallazgo que no buscábamos: dos perfiles de atacante eran el mismo — y la causa no era la obvia

En la medición original, el ancla 5 era la única con sensibilidad > 1 y la única cuya celda más
movida **no era la suya** (movía `empleado-desleal vs estándar` y, a +8, `organizado vs avanzada`).
Investigando por qué:

```
empleado-desleal   FA=60,0  C=56,911   motivación=80 recursos=52 capacidad=58 persistencia=62 sofisticación=48
organizado         FA=60,0  C=56,911   motivación=65 recursos=60 capacidad=60 persistencia=65 sofisticación=50
```

**Atributos distintos, mismo promedio, misma fuerza de contienda.** El modelo no los distinguía:
daban la misma Vulnerabilidad contra cualquier defensa (98,5 / 59,3 / 30,4 / 14,7 contra 98,5 /
59,6 / 30,8 / 15,0 — la diferencia era ruido de muestreo). De los cinco perfiles de atacante, solo
cuatro eran distinguibles.

#### La explicación intuitiva era falsa

La primera lectura fue que el Factor de Amenaza, al ser un **promedio simple**, es lossy: un
insider muy motivado pero poco sofisticado colapsa al mismo número que un grupo de crimen
organizado equilibrado. De ahí salía la recomendación obvia —**ponderar los atributos**— y resultó
estar equivocada. Medido:

| FA del insider (bajándolo a mano) | nodo re-despejado | grilla resultante             |
| --------------------------------- | ----------------- | ----------------------------- |
| 60,0 (la de entonces)             | 56,911            | 98,5 / 59,3 / 30,5 / 14,7     |
| 57,3                              | 56,810            | 98,4 / 58,8 / 30,0 / 14,2     |
| 55,0                              | 57,058            | 98,5 / 58,9 / 30,0 / 14,1     |
| 50,0                              | 57,575            | 98,6 / 59,2 / 30,0 / 14,1     |
| 45,0                              | 58,126            | 98,7 / 59,7 / 30,0 / 14,0     |

Bajar el FA **quince puntos** movía la grilla menos de un punto: el nodo se re-ajustaba hacia
arriba y compensaba. Y como cualquier ponderación de atributos solo puede mover el FA, **ninguna
ponderación habría arreglado nada**. (Se comprobó además que las ponderaciones que preservan las
anclas de los otros cuatro perfiles forman una familia de una sola dimensión, y que el FA del
insider solo se puede mover dentro de ella entre 57,3 y 61,5 — de todos modos irrelevante.)

#### La causa real: el ancla, no el promedio

El ancla 5 —"empleado desleal vs defensa avanzada = 30 %"— se emitió sobre el eje de **acceso
nulo**, como las otras cinco. Pero "un insider sin ningún acceso" es una contradicción de términos.
Para hacer que un empleado *sin acceso* diera 30 % contra defensa avanzada, la calibración tenía
que empujar su nodo de contienda hasta 56,911 —la fuerza bruta de una banda criminal— compensando
un acceso que el modelo **ya cuenta aparte** en el Nivel de Acceso. Es el mismo error de *"está
adentro" se coló dentro de "es capaz"* que ya se había corregido en los atributos del perfil, pero
que el ancla volvía a meter por la puerta de atrás.

Mientras el ancla dijera 30 % a acceso nulo, los dos perfiles **no se podían separar**: el ancla
era la que afirmaba que son igual de fuertes.

#### Arreglado en la calibración 6

El ancla 5 se relee con **acceso medio** (que es lo que un insider tiene por definición) y el perfil
estrena nodo propio en el eje (FA 60,0 → 54,2, nodo 40,911). El juicio del experto se conserva
intacto —con acceso medio el modelo sigue dando 30,0 %— y lo que cambia es el insider contra un
activo al que **no** tiene acceso:

| empleado desleal | básica | estándar | avanzada | élite |
| ---------------- | ------ | -------- | -------- | ----- |
| acceso nulo      | 90,0   | 24,2     | 6,9      | 2,1   |
| acceso bajo      | 94,9   | 36,5     | 12,9     | 4,5   |
| acceso medio     | 98,7   | 60,2     | **30,0** | 13,4  |
| acceso alto      | 99,7   | 80,1     | 52,3     | 30,0  |
| `organizado`     | 98,5   | 59,6     | 30,8     | 15,0  |

Los otros cuatro perfiles no se movieron **ni un décimo** — medido celda por celda. Y el propio
ancla 5 dejó de contaminar celdas ajenas: su sensibilidad bajó de 1,09 a 0,90 y su celda más movida
ahora es la suya.

## Qué se hace con esto

**La recalibración para quitar el tope de 100 es de BAJO riesgo.** Ésa era la pregunta que este
análisis venía a responder, y la respuesta es que sí: como los errores no se amplifican y se quedan
locales, mover la calibración no desestabiliza la grilla. Se puede acometer con confianza.

Pendientes que este análisis destapó, en orden de valor:

1. ~~Ponderar los atributos del Factor de Amenaza~~ — **hecho, pero no así**: el diagnóstico era
   equivocado y ponderar no habría servido. Arreglado en la calibración 6 releyendo el ancla 5 con
   el Nivel de Acceso que le corresponde (ver §3).
2. **Publicar `m` con la precisión que tiene** (≈ 6,8 ± 0,8), no con cuatro decimales.
3. Quitar el tope de 100 en el triángulo de Resistencia y recalibrar — este análisis dice que es de
   bajo riesgo.

Y una lección de método que vale más que las tres: **la explicación intuitiva de un síntoma puede
ser falsa aunque suene impecable.** "El promedio simple es lossy" era cierto y era irrelevante.
Solo medirlo lo mostró.
