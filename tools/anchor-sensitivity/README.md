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
  Si no recupera los valores vigentes —que lee del propio eje calibrado, nunca escritos a mano— el
  análisis está midiendo el error del método y lo dice. Medido contra la calibración 7: `m = 6,4279`
  (0,3 % de desviación), nodo 60 = 57,347 (0,0 %) y nodo 54,2 = 40,304 (0,1 %).

También descarta las perturbaciones **imposibles**: el piso de Vulnerabilidad es 0,5 %, así que
"oportunista vs básica (5 %) menos 8 puntos" pediría un −3 % inalcanzable. La bisección saturaría y
devolvería un número con toda la pinta de una medición. Esas filas se marcan, no se inventan.

## Resultados (20.000 iteraciones)

### 1. El modelo NO es frágil

| Ancla                           | pp de grilla por punto de error | peor caso (±8) |
| ------------------------------- | ------------------------------- | -------------- |
| 4. organizado vs élite          | 1,01                            | 8,5 pp         |
| 2. vandalismo vs básica         | 1,00                            | 8,1 pp         |
| 6. estado-nación vs élite       | 1,00                            | 8,1 pp         |
| 3. organizado vs estándar       | 1,00                            | 8,0 pp         |
| 1. oportunista vs básica        | 1,00                            | 8,0 pp         |
| 5. empleado desleal vs avanzada | 0,89                            | 7,3 pp         |

> Medido sobre la calibración 7. El resultado **se sostuvo a través de dos recalibraciones
> completas** (la 6 y la 7), que es la mejor evidencia de que describe el modelo y no una
> configuración de números en particular. En la medición original (calibración 5) el ancla 5 daba
> **1,09** —la única por encima de 1— y su peor caso era de 9,9 pp, porque compartía nodo con
> `organizado`; arreglado eso (ver §3), bajó a 0,89 y dejó de ser la excepción.

Una sensibilidad de 1,00 significa que equivocarse un punto en un ancla mueve la grilla un punto.
**El error no se amplifica.** Y se queda **local**: la celda que más se mueve es la del propio
ancla, y el RMSE sobre las 20 celdas es ~1,8 pp para un error de 8 puntos — o sea que el resto de
la grilla casi no se entera. (En la medición original esto valía para cinco de las seis anclas; la
sexta era la 5, y por eso se investigó — ver §3.)

### 2. `m` tiene falsa precisión

`m` oscila entre **4,27 y 13,58** a lo largo del rango de perturbación, aunque la grilla apenas se
mueva. Con un error de solo ±3 puntos en el ancla 3 —perfectamente plausible en un juicio experto—
`m` va de 5,75 a 7,22: **±12 %**.

`m` y el nodo 60 se compensan mutuamente para preservar las anclas, así que el **par** está bien
identificado aunque `m` por separado no lo esté. Publicarlo con cuatro decimales afirma una
precisión que el método no sostiene: los decimales del código son para **reproducir** el ajuste, y
al citarlo fuera de ahí se dice «≈ 6,4», nunca «6,4073». Así quedó anotado junto a `TULLOCK_M`.

### 3. El hallazgo que no buscábamos: dos perfiles de atacante eran el mismo — y la causa no era la obvia

En la medición original, el ancla 5 era la única con sensibilidad > 1 y la única cuya celda más
movida **no era la suya** (movía `empleado-desleal vs estándar` y, a +8, `organizado vs avanzada`).
Investigando por qué:

```
empleado-desleal   FA=60,0  C=56,911   motivación=80 recursos=52 capacidad=58 persistencia=62 sofisticación=48
organizado         FA=60,0  C=56,911   motivación=65 recursos=60 capacidad=60 persistencia=65 sofisticación=50
```

(Los números de esta sección son los de la calibración 5, la que se estaba midiendo. La 7 los movió
todos; lo que no cambió es el razonamiento.)

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
estrena nodo propio en el eje (FA 60,0 → 54,2). El juicio del experto se conserva intacto —con
acceso medio el modelo sigue dando 30,0 %— y lo que cambia es el insider contra un activo al que
**no** tiene acceso. Cifras ya de la calibración 7 (nodo 40,340):

| empleado desleal | básica | estándar | avanzada | élite |
| ---------------- | ------ | -------- | -------- | ----- |
| acceso nulo      | 88,5   | 23,7     | 7,0      | 2,3   |
| acceso bajo      | 93,9   | 35,6     | 12,8     | 4,6   |
| acceso medio     | 98,3   | 59,2     | **30,0** | 13,7  |
| acceso alto      | 99,6   | 79,4     | 52,4     | 30,7  |
| `organizado`     | 98,3   | 60,0     | 31,7     | 15,0  |

Al hacer el cambio, los otros cuatro perfiles no se movieron **ni un décimo** — medido celda por
celda. (La calibración 7, posterior, sí los movió: es una recalibración completa.) Y el propio ancla
5 dejó de contaminar celdas ajenas: su sensibilidad bajó de 1,09 a 0,89 y su celda más movida ahora
es la suya.

## Qué se hizo con esto

**La recalibración para quitar el tope de 100 es de BAJO riesgo.** Ésa era la pregunta que este
análisis venía a responder, y la respuesta fue que sí: como los errores no se amplifican y se quedan
locales, mover la calibración no desestabiliza la grilla. Se acometió, y el pronóstico se cumplió —
la calibración 7 reproduce las seis anclas con residuo ≤ 0,15 pp y el ranking de criticidad de arriba
casi no se movió.

Los tres pendientes que el análisis destapó, cerrados:

1. ~~Ponderar los atributos del Factor de Amenaza~~ — **hecho, pero no así**: el diagnóstico era
   equivocado y ponderar no habría servido. Arreglado en la calibración 6 releyendo el ancla 5 con
   el Nivel de Acceso que le corresponde (ver §3).
2. ~~Publicar `m` con la precisión que tiene~~ — anotado junto a `TULLOCK_M`: los decimales son para
   reproducir, se cita «≈ 6,4».
3. ~~Quitar el tope de 100 en el triángulo de Resistencia y recalibrar~~ — calibración 7. Costo
   honesto: el ancla de validación `organizado vs avanzada` empeoró su residuo de +0,8 a +1,7 pp,
   porque el tope mordía justo en esa banda. Se aceptó porque el tope sesgaba TODA la grilla contra
   la defensa fuerte, y eso pesa más que 0,9 pp en una celda de comprobación.

Y una lección de método que vale más que las tres: **la explicación intuitiva de un síntoma puede
ser falsa aunque suene impecable.** "El promedio simple es lossy" era cierto y era irrelevante.
Solo medirlo lo mostró.
