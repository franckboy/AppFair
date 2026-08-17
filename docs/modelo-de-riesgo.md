# Especificación técnica del modelo de riesgo de AppFair

Documento normativo del motor cuantitativo. Describe **lo que el código hace**, no lo que podría
hacer: cada constante y cada fórmula de aquí está tomada de la base de código y verificada por la
suite de regresión. Si este documento y el código discrepan, el código manda y este documento está
mal.

> **Deslinde de normas.** Los porcentajes, escalas y fórmulas de este documento son **metodología
> cuantitativa propia de AppFair**. ISO 31000, ISO 28000 y ASIS aportan el marco de proceso
> (contexto, identificación, análisis, evaluación, tratamiento, controles), pero **no prescriben
> estas cifras ni estas fórmulas**, y la app no debe afirmar lo contrario.

**Estado: calibración 5** (modelo compuesto de frecuencia, §7.1). Archivos de referencia:

| Pieza                                                  | Archivo                                  |
| ------------------------------------------------------ | ---------------------------------------- |
| Calibración, eje de contienda, acceso, re-centrado     | `backend/src/lib/autocalc.js`            |
| Perfiles y bandas de confianza                         | `backend/src/data/profiles.js`           |
| Monte Carlo, modelo de frecuencia, curva de excedencia | `backend/src/lib/simulation.js`          |
| Agregación de portafolio y cascada                     | `backend/src/lib/portfolioSimulation.js` |
| Residual del Tratamiento                               | `backend/src/lib/autocalc.js`            |
| Frecuencia sugerida                                    | `frontend/src/modules/utils.js`          |
| Equilibrio de Nash (panel aparte)                      | `backend/src/lib/nashEquilibrium.js`     |
| Invariantes ejecutables                                | `backend/test/lib.test.js`               |

---

## 1. Desacoplamiento de magnitudes

El motor nunca trata una puntuación de intensidad como si fuera una probabilidad. Hay cuatro tipos
de magnitud y no son intercambiables:

| Nivel                       | Símbolo     | Dominio      | Naturaleza                                   |
| --------------------------- | ----------- | ------------ | -------------------------------------------- |
| Puntaje semántico de perfil | FA, ENC     | `[0, 100]`   | Intensidad ordinal. **No es probabilidad.**  |
| Eje de contienda            | C, R        | `(0, ∞)`     | Fuerza comparable. **No es porcentaje.**     |
| Vulnerabilidad              | V           | `[0,005, 1]` | Probabilidad de que un intento cause pérdida |
| Frecuencia                  | TEF, LEF    | `[0, ∞)`     | Sucesos por año                              |
| Pérdida                     | ALE, CVaR95 | USD          | Dinero                                       |

El error que motivó esta separación: comparar FA contra ENC punto a punto asume que un punto de
atacante vale lo mismo que un punto de defensa, y eso nunca se validó. El eje de contienda
(§3) existe exactamente para corregirlo.

---

## 2. Entradas

### 2.1 Perfiles de Atacante

`FA = media aritmética de los 5 atributos.`

| Clave              | Motivación | Recursos | Capacidad | Persistencia | Sofisticación | FA       |
| ------------------ | ---------- | -------- | --------- | ------------ | ------------- | -------- |
| `oportunista`      | 30         | 10       | 20        | 20           | 10            | **18,0** |
| `vandalismo`       | 55         | 40       | 50        | 30           | 40            | **43,0** |
| `empleado-desleal` | 80         | 52       | 58        | 62           | 48            | **60,0** |
| `organizado`       | 65         | 60       | 60        | 65           | 50            | **60,0** |
| `estado-nacion`    | 90         | 90       | 90        | 90           | 90            | **90,0** |

`empleado-desleal` comparte FA con `organizado` a propósito: la ventaja real de un insider es el
**acceso**, no la capacidad, y el acceso se modela aparte (§4). El perfil anterior (FA 68) afirmaba
que un empleado descontento tiene más capacidad y sofisticación que una organización criminal
profesional, lo cual no se sostiene.

### 2.2 Perfiles de Defensa

`ENC = media aritmética de los 6 atributos.`

| Clave      | ENC  |
| ---------- | ---- |
| `basica`   | 26,7 |
| `estandar` | 55,0 |
| `avanzada` | 73,3 |
| `elite`    | 90,8 |

La escala de defensa **no** tiene curva de calibración propia: se usa cruda. Esto no es un descuido
— se validó fuera de muestra (§6.2) y resultó internamente consistente.

### 2.3 Bandas de confianza

Incertidumbre **epistémica**: qué tan seguro está el analista de su propio estimado.

| Nivel   | min  | max  |
| ------- | ---- | ---- |
| `alto`  | 0,85 | 1,15 |
| `medio` | 0,60 | 1,40 |
| `bajo`  | 0,35 | 1,80 |

`medio` es el **nivel de referencia**: es el único en el que el modelo está anclado a juicio
experto. La banda `bajo` es asimétrica (−0,65 / +0,80); el re-centrado (§5) lo absorbe.

---

## 3. Eje de contienda del atacante

Traduce el puntaje semántico a la escala en la que de verdad compite contra la defensa.
Interpolación lineal monótona entre nodos; por encima del último, extiende la pendiente final.

```
C = attackerContestStrength(FA)
```

| FA  | C          |
| --- | ---------- |
| 0   | 0          |
| 18  | **14,614** |
| 43  | **22,682** |
| 60  | **56,911** |
| 90  | **75,748** |

**Regla de implementación crítica:** se aplica **una sola vez, al promedio del perfil** — nunca a
cada muestra de Monte Carlo. Aplicarla por muestra introduce un sesgo de Jensen de hasta **11
puntos porcentuales** (la curva es convexa, así que el promedio de la curva supera a la curva del
promedio) y descalibra el modelo respecto a las anclas. La banda PERT se abre **después**, ya sobre
el eje de contienda.

---

## 4. Nivel de Acceso / Proximidad

Propiedad **del riesgo**, no del perfil: el mismo empleado tiene acceso total a su bodega y ninguno
al centro de datos. Modula la Resistencia, nunca la Capacidad.

```
R_eff = ENC × α
```

| Clave   | Nombre              | α                  |
| ------- | ------------------- | ------------------ |
| `nulo`  | Nulo / Externo      | **1,00** (default) |
| `bajo`  | Bajo / Perimetral   | **0,878**          |
| `medio` | Medio / Operativo   | **0,703**          |
| `alto`  | Alto / Privilegiado | **0,568**          |

**Por qué modula R y no C.** Bajo Tullock solo cuenta la razón `C/R`, así que `R·α` y `C/α` son casi
equivalentes — pero no del todo: el triángulo de Resistencia tiene un tope duro en 100 que ya muerde
con defensa avanzada y élite, así que escalar R hacia abajo lo libera mientras que subir C no.
Medido contra defensa élite, las dos rutas difieren hasta **4,7 puntos**, y modular R da el
resultado conservador.

**Los α están despejados, no elegidos.** Se anclan sobre **una sola pareja fija** —`organizado`
(C = 56,911) vs `estándar` (ENC = 55,0)— variando únicamente el Nivel de Acceso. Al mantener C y R
constantes, ambos se cancelan y la variación de Vulnerabilidad es función pura de α: cada ancla
despeja su factor de forma unívoca, y la monotonía sale por construcción.

| Acceso | Ancla de Vulnerabilidad    | α despejado |
| ------ | -------------------------- | ----------- |
| nulo   | 60 % (es el ancla base #3) | 1,000       |
| bajo   | 72 %                       | 0,878       |
| medio  | 88 %                       | 0,703       |
| alto   | 96 %                       | 0,568       |

La pareja se eligió por estar en la **zona central de la sigmoide**, donde `m = 6,8254` tiene su
mejor resolución.

**Por qué NO se ancla cruzando celdas.** Un intento anterior usó tres combinaciones distintas de
atacante y defensa. Los α despejados salieron **0,614** (bajo), **0,777** (medio) y **0,686** (alto)
— **no monótonos**: "bajo/perimetral" habría desarmado más controles que "alto/privilegiado". La
causa fue anclar en celdas pegadas al piso de 0,5 %, donde mover la Vulnerabilidad unos décimos
exige recortes enormes de α. **Regla: el acceso se ancla sobre una pareja fija en la zona central,
nunca cruzando celdas.**

**`α = 1,00` es un no-op exacto**, y por eso las ocho anclas siguen valiendo sin recalibrar.

---

## 5. Vulnerabilidad

### 5.1 Función de contienda de Tullock

```
V(C, R) = C^m / (C^m + R^m)          m = 6,8254
```

Es una **razón**, no una resta: un empate a cualquier escala (10 vs 10, o 90 vs 90) da 50 %
siempre. `m` controla qué tan decisiva es la ventaja.

### 5.2 Triángulos de muestreo

```
tcap = { min: C × spread.min,  mode: C,    max: C × spread.max }
rs   = { min: R_eff × spread.min, mode: R_eff, max: min(100, R_eff × spread.max) }
```

TCap **no** lleva tope: el eje de contienda no es un porcentaje. RS **sí** conserva el tope en 100
(ver §9.2, deuda conocida).

### 5.3 Resolución de una iteración

```
tcap_i ~ BetaPERT(tcap.min, tcap.mode, tcap.max, λ=4)
rs_i   ~ BetaPERT(rs.min,   rs.mode,   rs.max,   λ=4)

# Escalada no determinista por persistencia
si rs_i > tcap_i  y  U(0,1) < persistencia/100:
    tcap_i ← tcap_i × (1 + U(0,1) × 0,30)

V_i = max(0,005, Tullock(tcap_i, rs_i, m))
```

**Escalada:** un atacante persistente que va perdiendo puede reforzarse en vez de desistir. Se
vuelve a tirar cada iteración — nunca es un `if` seco. Cuenta la Persistencia dos veces (ya está en
FA), y se conserva a propósito: la calibración lo absorbe por completo, así que quitarlo sería un
cambio de modelo sin beneficio medible.

**Piso de 0,005 (0,5 %):** ninguna defensa es perfecta. Sin él, las combinaciones más desparejas
daban 0,0 %, que afirma invulnerabilidad.

### 5.4 Re-centrado por confianza (bisección)

**Problema.** La confianza es incertidumbre epistémica, pero al ensanchar la banda PERT movía
también el centro, porque Tullock con `m = 6,8254` es muy convexo y las iteraciones donde el
atacante sale alto dominan el promedio (Jensen). Medido antes del arreglo: declarar confianza baja
subía la Vulnerabilidad de un oportunista contra defensa básica de **5,0 % a 11,8 %** — 4,7 veces
más vulnerable por admitir que no estás seguro de tus datos.

**Solución.** Se resuelve por bisección un factor `k` sobre C tal que la media de **este** nivel de
confianza iguale la del nivel de referencia:

```
objetivo = media(C, R_eff, persistencia, spread[medio])
buscar k ∈ [0,2 , 5] por bisección (24 pasos) tal que
        media(C × k, R_eff, persistencia, spread[confianza]) = objetivo
C_final = C × k
```

- La estimación de la media usa **muestreo fijo y sembrado** (`mulberry32(0x5eed)`, 2000
  iteraciones). Es determinista a propósito: una calibración que cambiara de corrida en corrida
  haría irreproducible la simulación que alimenta.
- El resultado se **memoiza** por `(C, R_eff, persistencia, confianza)`. Sin la caché, el costo se
  multiplicaría por 10.000, porque el muestreo pareado reconstruye los triángulos en cada iteración.
- Con `confianza = medio` el factor es exactamente 1 (sin cálculo).

**Resultado medido** (`organizado vs estandar`):

| Confianza | p10  | p50  | p90  | **media** | ancho p10–p90 |
| --------- | ---- | ---- | ---- | --------- | ------------- |
| alto      | 43,8 | 59,8 | 75,1 | **59,6**  | 31,2          |
| medio     | 22,3 | 62,6 | 89,9 | **59,6**  | 67,6          |
| bajo      | 6,1  | 63,5 | 97,9 | **57,7**  | 91,8          |

La media queda clavada; el abanico se abre casi 3×. Razón baja/alta en las ocho anclas: de **4,71×**
a **0,96–1,01×**.

---

## 6. Las ocho anclas

Son el cimiento del modelo y la única fuente de sus parámetros. Emitidas por un experto en
seguridad patrimonial, todas con **confianza media** y **acceso nulo**.

### 6.1 Las seis de calibración

| #   | Atacante         | Defensa  | Vulnerabilidad |
| --- | ---------------- | -------- | -------------- |
| 1   | oportunista      | básica   | 5 %            |
| 2   | vandalismo       | básica   | 35 %           |
| 3   | organizado       | estándar | 60 %           |
| 4   | organizado       | élite    | 15 %           |
| 5   | empleado desleal | avanzada | 30 %           |
| 6   | estado-nación    | élite    | 45 %           |

**`m` no se eligió: las anclas 3 y 4 lo identifican.** Comparten atacante contra dos defensas
distintas, así que el eje de contienda se cancela y solo sobrevive `m`:

```
(C/55)^m = 60/40 = 1,5        (C/90,8)^m = 15/85 = 0,17647
    ⇒  (90,8/55)^m = 8,50     ⇒  m = 4,2688     ← sobre la FÓRMULA CENTRAL
```

**Ese 4,2688 no es el valor que usa el código.** La derivación de arriba resuelve la fórmula de
Tullock evaluada en los valores centrales, pero el modelo real no evalúa un punto: promedia 10.000
iteraciones con muestreo Beta-PERT, escalada por persistencia y piso. Sobre esa media simulada, las
mismas dos anclas exigen:

```
m = 6,8254     ← el valor del código
```

La diferencia es sesgo de Jensen otra vez: con una función convexa, la media de la simulación no
coincide con la función de la media. **Toda calibración de este modelo debe ajustarse contra la
media simulada, nunca contra la fórmula central** — hacerlo mal desplaza los resultados varios
puntos porcentuales.

Lo que las anclas 3 y 4 aportan es la **identificación**: sin dos anclas que compartan atacante,
`m` quedaría confundido con la separación de la escala de defensa y no se podría despejar ninguno de
los dos por separado. Con `m` fijo, cada ancla restante despeja su propio nodo del eje de contienda.

### 6.2 Las dos de validación fuera de muestra

Emitidas **después** de fijar `m` y el eje, sin que el modelo se ajustara para acertarlas:

| #   | Atacante   | Defensa  | Ancla | Predicción previa del modelo |
| --- | ---------- | -------- | ----- | ---------------------------- |
| 7   | organizado | básica   | 98 %  | **98,5 %**                   |
| 8   | organizado | avanzada | 30 %  | **30,8 %**                   |

Confirman que la escala de Defensa es internamente consistente y **no necesita curva de calibración
propia**. Esta es la validación más fuerte del modelo: no se ajustó nada para conseguirla.

### 6.3 Grilla resultante

Vulnerabilidad media (%), confianza media, acceso nulo. `*` = celda anclada.

| Atacante         | básica     | estándar   | avanzada   | élite      |
| ---------------- | ---------- | ---------- | ---------- | ---------- |
| oportunista      | **5,0\***  | 0,5        | 0,5        | 0,5        |
| vandalismo       | **35,1\*** | 1,2        | 0,5        | 0,5        |
| empleado desleal | 98,5       | 59,3       | **30,4\*** | 14,7       |
| organizado       | **98,5\*** | **59,6\*** | **30,8\*** | **15,0\*** |
| estado-nación    | 99,8       | 84,4       | 62,1       | **45,1\*** |

Rango cubierto: **0,5 % – 99,8 %**. El modelo anterior (`m = 1`, sin eje de contienda) comprimía
toda la grilla entre 17,7 % y 76,3 %: pasar de defensa básica a élite apenas dividía la
Vulnerabilidad a la mitad, así que la app **subvaloraba sistemáticamente la inversión en
seguridad**, y eso alimentaba directo a la estrategia de Mitigar.

---

## 7. Ruta crítica

```
Perfil de Atacante ──► FA ──► attackerContestStrength ──► C
                                                          │
                              re-centrado por confianza ──┤  C_final
                                                          │
Perfil de Defensa ──► ENC ──► × α (Nivel de Acceso) ──► R_eff
                                                          │
                                                          ▼
                    triángulos PERT (λ=4) ──► escalada por persistencia
                                                          │
                                          Tullock(m=6,8254) + piso 0,005
                                                          ▼
                                                  Vulnerabilidad V_i
                                                          │
              TEF_i ~ BetaPERT ────────────► LEF_i = TEF_i × V_i
                                                          │
                                                          │
              N_i ~ Poisson(LEF_i) ─────────► cuántos eventos ESTE año
                                                          │
              Magnitud_i ~ Lognormal ──────► Pérdida_i = Σ_{j=1..N_i} Magnitud_j
                                                          ▼
                        10.000 iteraciones ──► distribución de pérdidas
                                                          ▼
                  ALE · p90 · CVaR95 · LEC · años en cero · sensibilidad
```

### 7.1 Núcleo de la simulación

```
para i en 1..10.000:
    tef_i       ~ BetaPERT(tef.min, tef.mode, tef.max, λ=4)
    vuln_i      = sampleVuln(rng)                    # §5.3
    lef_i       = tef_i × vuln_i
    n_i         ~ Poisson(lef_i)                     # cuántos eventos ESTE año
    pérdida_i   = Σ_{j=1..n_i} Σ_categorías Lognormal(min, mode, max)
```

**Modelo COMPUESTO de frecuencia** (colectivo de riesgo clásico), default desde la calibración 5.
El modelo anterior calculaba `pérdida_i = lef_i × magnitud_i`: repartía la frecuencia como una
fracción continua de evento en TODOS los años por igual. Con `LEF = 0,1` afirmaba que cada año se
pierde la décima parte de un incendio — algo que no le pasa a nadie: o hay incendio, o no lo hay.

No era un híbrido inocente. Ya había promediado la variabilidad del **conteo** pero conservaba
entera la de la **magnitud**, y de ahí salían dos errores en direcciones **opuestas**:

- Donde los eventos son **raros**, la variabilidad del conteo _es_ todo el riesgo —0 contra 1 evento
  es la diferencia entera— y la había borrado.
- Donde son **frecuentes**, la suma de ~20 eventos se promedia sola y su dispersión relativa cae;
  pero `20 × M` conserva la dispersión completa de UN evento: inventaba incertidumbre.

El ALE **se conserva al cambiar de modelo, por construcción** (`E[N]×E[M] = LEF×E[M]`), así que este
cambio NO reabre las ocho anclas de §6. Lo que cambia es la COLA. Medido con la misma semilla:

| Régimen                  | ALE      | CVaR95     | Años en cero |
| ------------------------ | -------- | ---------- | ------------ |
| raro-severo (LEF 0,05)   | −0,5 %\* | **× 4,8**  | 95 %         |
| anual (LEF 1)            | −1,7 %   | × 1,25     | 36 %         |
| frecuente-menor (LEF 20) | +0,4 %   | **× 0,63** | 0 %          |
| muy frecuente (LEF 475)  | −0,1 %   | × 0,72     | 0 %          |

\* promedio sobre 40 semillas; en una sola corrida es ruido de muestreo.

Se puede comparar sobre datos propios en `POST /api/simulate/frequency-models`, que corre ambos con
la **misma semilla** para que la diferencia sea el modelo y no el azar.

**Tope de frecuencia.** Por encima de `tef.max = 500` el compuesto cae solo al modelo anterior y lo
reporta en `frequencyModel`. No es modelado: a esa frecuencia los dos modelos ya coinciden (ALE
−0,1 %) y el compuesto solo costaría tiempo, porque sortea una magnitud por CADA evento. Es una
caída silenciosa a propósito — desde que el compuesto es el default, un riesgo muy frecuente es un
riesgo válido y corriente, no una petición mal formada.

- **TEF y Vulnerabilidad → Beta-PERT (λ = 4)**, no triangular: PERT da 4× más peso al valor "más
  probable" que a los extremos, que es lo que un experto quiere decir al dar tres números.
- **Magnitud → lognormal calibrada por momentos**, no por percentiles: se ajusta para tener la
  **misma varianza y la misma moda** que la triangular con ese min/moda/max. Se preserva el ancho de
  incertidumbre que el usuario quiso decir y solo cambia la forma: sesgo a la derecha y cola
  realista sin techo duro. Una pérdida simulada **sí** puede superar el "peor caso" estimado — que
  es justamente el motivo de reportar CVaR95.
- Si una categoría tiene `mode = 0` (no aplica a este riesgo), cae a triangular para esa muestra:
  la lognormal no está definida en 0.

### 7.2 Frecuencia de Eventos de Amenaza (TEF)

Sugerencia anclada a escenarios reales, con interpolación **logarítmica** (las anclas abarcan tres
órdenes de magnitud):

| FA  | Escenario                           | Intentos/año              |
| --- | ----------------------------------- | ------------------------- |
| 18  | Hurto oportunista en bodega urbana  | **18**                    |
| 60  | Robo de carga por crimen organizado | **1,2**                   |
| 90  | Terrorismo / sabotaje industrial    | **0,02** (1 cada 50 años) |

**La relación con la capacidad es inversa**, y eso corrige una premisa equivocada del modelo
anterior (que partía de 10 intentos/año para todos y los subía con Motivación y Persistencia). La
frecuencia con la que un activo recibe intentos la mandan **cuántos actores de ese tipo hay sueltos
y qué tan indiscriminados son**, no el empeño de cada uno — el empeño determina si el intento tiene
**éxito**, y eso ya es la Vulnerabilidad.

No hay piso en 1 evento/año. El modelo anterior lo tenía y hacía imposible expresar una amenaza de
baja frecuencia y alto impacto.

### 7.3 Métricas de salida

| Métrica          | Definición                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALE**          | Media aritmética de las 10.000 pérdidas anuales                                                                                                                                 |
| **p90**          | `sorted[floor(n × 0,9)]`                                                                                                                                                        |
| **CVaR95**       | **Media del peor 5 %** de las pérdidas. **No es un percentil** — por eso vale más que uno para dimensionar cobertura                                                            |
| **LEC**          | Curva de excedencia: pérdida asociada a cada una de **34 probabilidades** entre 100 % y 0,1 %, con la probabilidad **recalculada empíricamente** sobre las pérdidas (ver abajo) |
| **Años en cero** | `zeroLossYearsPercent`: qué % de los años simulados no registró ningún evento                                                                                                   |
| **Sensibilidad** | Correlación de **Spearman** (rangos) entre cada variable de entrada y la pérdida simulada                                                                                       |

> **No existe `p95` en la salida.** Las métricas de cola son p90, CVaR95 y la LEC completa.

**Por qué la LEC recalcula su probabilidad.** La curva se arma buscando, para cada probabilidad de
la escalera, el cuantil correspondiente. Con una distribución continua la etiqueta y la realidad
coinciden; en cuanto hay **empates**, el cuantil deja de ser inyectivo y la etiqueta miente. Con el
modelo compuesto, un riesgo raro tiene el 95 % de sus años en `$0` exacto, así que los puntos de
100 %, 99 %, 98 %… caían todos en `$0` y afirmaban _"100 % de probabilidad de perder más de \$0"_
cuando la respuesta real es 5 %. Esa curva alimenta el eje Y de la Matriz de Riesgos y el punto
residual, así que el error no se quedaba en el dibujo.

**Por qué Spearman y no Pearson.** El modelo no es lineal y Pearson solo mide relación lineal:
Tullock con `m = 6,8254` es fuertemente convexo y la Magnitud es lognormal de cola pesada, así que
unos pocos sorteos enormes dominaban la covarianza y aplastaban el peso aparente de los demás
factores. Medido sobre el modelo real, Pearson subestimaba Frecuencia y Vulnerabilidad **a la
mitad** (0,244 vs 0,367 y 0,323 vs 0,496). Spearman es robusto a cualquier relación monótona, que
es exactamente el caso.

**El P90 en `$0` es una respuesta, no un error.** En un riesgo raro, el p90 y a veces la mediana
salen en cero, porque nueve de cada diez años no traen ningún evento. Es justo lo que el modelo
anterior escondía. La interfaz lo acompaña siempre de `zeroLossYearsPercent` — un `$0` a secas se
lee como si la app estuviera rota.

---

## 8. Agregación de portafolio

Todo lo anterior describe **un riesgo**. Esta capa responde la pregunta del comité: _¿cuánto expone
la organización entera, y qué tan mal puede ir un año?_

Motor: `backend/src/lib/portfolioSimulation.js`. Ruta: `GET /api/register/portfolio-simulation`.

### 8.1 Por qué no basta con sumar

El **ALE sí se puede sumar** — la esperanza es lineal, `E[X+Y] = E[X] + E[Y]`. Un **percentil no**:
`p90(X+Y) ≠ p90(X) + p90(Y)`.

CVaR es una medida coherente y por tanto **subaditiva**: `CVaR(X+Y) ≤ CVaR(X) + CVaR(Y)`. Sumar los
CVaR individuales **sobrestima** la cola salvo que todos los riesgos se materialicen el mismo año.
Era conservador, no peligroso, pero tenía un costo real: la app no podía mostrar **ningún** beneficio
de diversificación, así que 20 riesgos independientes aparecían con una cola tan gorda como si los
20 ocurrieran a la vez.

Medido con riesgos idénticos e independientes:

| Riesgos | Suma de CVaR95 | CVaR95 conjunto | Sobrestimación |
| ------- | -------------- | --------------- | -------------- |
| 1       | 58.848         | 58.848          | 0 %            |
| 2       | 118.563        | 93.404          | 21 %           |
| 5       | 297.250        | 183.902         | 38 %           |
| 20      | 1.190.290      | 583.373         | **51 %**       |

### 8.2 Simulación conjunta

```
para cada riesgo r utilizable:
    annualLosses_r = runMonteCarloSimulation(r, semilla = base + índice × 7919)
    para i en 1..10.000:  portfolioLosses[i] += annualLosses_r[i]
```

Sumar **por iteración** es la diferencia: cada índice `i` es "un año posible" vivido por todos los
riesgos a la vez, y de esa distribución conjunta salen percentiles reales.

- **Semilla derivada por posición** (`base + índice × 7919`): reproducible, y distinta por riesgo.
  Con la misma semilla para todos, los riesgos quedarían perfectamente correlacionados por accidente
  y el resultado volvería a ser la suma que se está corrigiendo.
- **Semilla base fija** (`20260813`): una cifra de portafolio que baila sin que cambien los datos es
  imposible de auditar.
- **Se excluyen y se reportan** las oportunidades y los riesgos sin `tef`/`vuln`/`lossMagnitudes`
  (`skippedCount`, `skippedRiskNames`) — nunca se cuentan como cero en silencio.

### 8.3 Correlación: el Árbol de Cascada

La independencia es una hipótesis fuerte: dos riesgos que comparten causa —un apagón que dispara
robo **y** parada de producción— caen juntos, y asumirlos independientes **subestima** la cola.

La correlación **no se estima ni se inventa**: sale de las dependencias que el analista ya declaró
en el Árbol de Riesgos en Cascada (`triggeredBy`, con su probabilidad por arista). No hay matriz de
correlaciones ajustada ni cópula: son las aristas dibujadas por el usuario, con sus probabilidades.

```
para i en 1..10.000:
    activos = padres con  U(0,1) < 1 − e^(−LEF_i)      # ocurrió este año
    alcanzados = walkMarkovChain(activos, aristas)      # a quién arrastran

para cada riesgo del portafolio:
    tasa_inducida = veces que un padre lo arrastró / 10.000
    tasa_propia   = LEF medio declarado
    share         = tasa_inducida / tasa_propia         # qué fracción EXPLICA la cascada
    espontánea    = max(0, 1 − share)

    para i en 1..10.000:
        sobreviven = Binomial(n_i, espontánea)          # adelgazado de eventos, §7.1
        coupled[i] += (sobreviven / n_i) × propias[i]
        si fue arrastrado este año:  coupled[i] += magnitud_i
```

**Tres reglas que no son negociables:**

1. **Se SUMA sobre la base independiente, nunca la reemplaza.** Un portafolio sin dependencias
   declaradas da **exactamente** los mismos números que antes de existir esta capa — verificado con
   igualdad estricta y fijado con un test. Conectar la cascada no reescribe ninguna evaluación
   existente en silencio.

2. **La cascada EXPLICA ocurrencias, no las añade.** El TEF capturado es la frecuencia **propia** del
   riesgo, estimada de datos de incidentes — y esos datos no vienen etiquetados por causa: ya
   incluyen las veces que el hijo ocurrió _porque_ ocurrió el padre. Sumar la cascada encima contaba
   esas veces **dos veces**. Con pocas aristas era un detalle; con un árbol denso pasaba a ser el
   efecto dominante, y peor en los riesgos raros y severos (un hijo de 0,02/año arrastrado por un
   padre frecuente podía multiplicar su aporte por decenas).

    Por eso la parte espontánea se **adelgaza** en la proporción que la cascada explica, y se añade la
    arrastrada. El total esperado de cada riesgo queda igual al declarado —su ALE individual no se
    mueve y el Registro no cambia— pero esas ocurrencias caen **el mismo año** que las del padre, que
    es lo que engorda la cola conjunta.

    Si los padres declarados inducen **más** ocurrencias de las que el hijo dice tener (`share > 1`),
    los datos se contradicen entre sí. El motor acota la parte espontánea a cero y **lo reporta**
    (`overCoupledRiskNames`); el Dashboard nombra esos riesgos y da las dos salidas: bajar la
    probabilidad de esas causas, o subir la frecuencia del riesgo.

3. **Adelgazar es quitar EVENTOS, no multiplicar la cifra del año.** Un año con UN evento adelgazado
   al 30 % no cuesta el 30 % de un incendio: cuesta un incendio el 30 % de las veces y cero el resto.
   Multiplicar es la misma falacia del evento fraccionario que el modelo compuesto vino a corregir
   (§7.1), e inventaba años imposibles a la vez que aplanaba la cola justo donde la cascada debía
   engordarla. Con muchos eventos en el año las dos cosas convergen, así que arriba de 30 se
   multiplica y ya.

4. **Un descendiente arrastrado aporta solo su MAGNITUD**, no `LEF × Magnitud`. La compuerta de
   cascada ya decidió "ocurrió este año", y volver a multiplicar por su `lef_i` descontaría la
   frecuencia dos veces. Para un riesgo raro pero severo —el perfil típico de un riesgo
   patrimonial— ese doble descuento subestima el aporte en órdenes de magnitud.

**Efecto medido** (5 riesgos, 3 aristas, mismos riesgos con y sin aristas). El efecto sobre la cola
depende del **régimen de frecuencia**, y es máximo justo donde las cascadas importan:

| LEF de los riesgos | ALE     | CVaR95      |
| ------------------ | ------- | ----------- |
| 0,05               | +0,45 % | **+17,9 %** |
| 0,2                | −0,29 % | +7,7 %      |
| 0,5                | −0,14 % | +2,2 %      |
| 1                  | +0,20 % | +0,7 %      |
| 3                  | −0,12 % | −0,6 %      |

Tiene sentido: con eventos frecuentes, un año ya trae muchas ocurrencias de cada riesgo y hacer que
algunas coincidan con el padre cambia poco; con eventos raros, que el año malo sea compartido o no
**es toda la pregunta**. El ALE no se mueve en ningún régimen, que es la garantía de que la cascada
reubica pérdida esperada en vez de crearla.

### 8.4 Qué se muestra

Gestión de Riesgos presenta la cifra conjunta **junto a** la suma conservadora, con cuánto menos es y
por qué — nunca en su lugar. Cambiar el número de golpe dejaría a un analista sin cómo explicar en
un comité por qué su exposición cayó a la mitad. Si hay dependencias declaradas, la línea lo dice.

El texto es sensible al Modo Simple: `CVaR95`/`p90` son jerga vetada ahí (ver
`simple-mode-no-jargon.spec.js`), así que en ese modo se dicen las mismas dos cifras en palabras.

## 9. Invariantes verificados por la suite

`backend/test/lib.test.js` convierte el criterio experto en regresión ejecutable: nadie puede tocar
`m`, el eje de contienda, los factores de acceso ni los atributos de un perfil sin que la suite
avise que el modelo dejó de coincidir con ese criterio.

| Invariante                | Verificación                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Las 8 anclas**          | \|media simulada − ancla\| **≤ 1,5 puntos porcentuales** (60.000 iteraciones, semilla `0x5eed`)               |
| **Monotonía en defensa**  | Para cada atacante: más defensa nunca sube la Vulnerabilidad (tolerancia 0,05)                                |
| **Monotonía en atacante** | Para cada defensa: oportunista ≤ vandalismo ≤ empleado desleal ≤ organizado ≤ estado-nación (tolerancia 0,05) |
| **Piso**                  | Ninguna combinación da 0 %; y el piso no infla el resultado (`< 2 %` en oportunista vs élite)                 |
| **Eje de contienda**      | Reproduce exactamente sus nodos calibrados, y es monótono creciente en `[0, 100]` con paso 0,5                |

Las dos pruebas de monotonía cubren las **14 celdas que ningún ancla toca**: sin ellas, una
calibración podría acertar las 8 anclas y aun así producir absurdos en el resto de la grilla — que
es exactamente lo que pasaba con los ajustes de forma libre antes de restringir la monotonía del
eje.

### 9.1 Versionado de calibración

`CALIBRATION_VERSION = 5`. Se sube cada vez que cambie algo que mueva los números de una simulación:
`m`, el eje de contienda, el piso, los atributos de un perfil, o **el modelo de frecuencia del
motor**.

> Se llamaba `VULNERABILITY_CALIBRATION_VERSION` mientras solo sellaba la calibración de
> Vulnerabilidad. Desde la versión 5 sella también cómo se convierte la frecuencia en pérdida anual,
> así que el nombre viejo quedaba corto. El campo persistido siempre se llamó `calibrationVersion`,
> de modo que el cambio es interno y no toca ningún dato guardado.

| Versión | Cambio                                                                                       |
| ------- | -------------------------------------------------------------------------------------------- |
| 1       | Tullock `m = 1` sobre el promedio crudo del perfil, sin piso                                 |
| 2       | Eje de contienda calibrado con 6 anclas, `m = 6,8254`, piso 0,5 %                            |
| 3       | El Nivel de Confianza deja de mover la media                                                 |
| 4       | Los factores α del Nivel de Acceso pasan de juicio directo a despejados por anclas           |
| 5       | **Modelo compuesto de frecuencia** (§7.1). El ALE de cada riesgo se conserva; cambia la cola |

Cada simulación sella su resultado con esta versión y el Registro la guarda. Los riesgos calculados
con una versión anterior **no se recalculan solos**: en una herramienta de GRC, sobrescribir en
silencio la evaluación guardada de un analista destruye la trazabilidad de por qué se decidió lo
que se decidió. Se marcan con `⟳ Recalibrar` y el analista decide cuáles vuelve a simular.

Existe una **recalibración masiva** como salida explícita a esa regla: la dispara una persona, dice
antes qué va a cambiar, y la evaluación anterior de cada riesgo pasa a su Historial de Revisiones
(ISO 31000, 6.6). Añade historia en vez de borrarla. Va por el mismo camino que una re-simulación
manual (`POST /api/simulate` + `PUT /api/register`), no por un atajo propio, para que no existan dos
maneras distintas de producir un riesgo actualizado.

### 9.1.1 Residual del Tratamiento

Reducir la Vulnerabilidad y topar el daño por evento son **dos palancas distintas** que producen la
misma media y colas completamente distintas: prevenir escala la frecuencia, contener trunca cada
evento. El motor las expone por separado — la Vulnerabilidad por el sampler, y `magnitudeCap` como
tope **por evento**, aplicado `min(lm_i, cap)` escenario por escenario, nunca sobre el promedio.

**La escala la fija el usuario; la forma, la simulación.** En modo manual, _"reduce mi pérdida anual
un r %"_ es una **definición**, no un estimado: `residualALE = currentALE × (1 − r/100)`, exacto. Ver
`$39.847` después de teclear 60 % se lee como un error de la app. Lo que no se puede deducir del
porcentaje es la cola, así que se corren los mismos inputs **dos veces con la misma semilla** —una
tal cual y otra con la Vulnerabilidad escalada— y se compara la razón cola/media de cada corrida:

```
factorDeCola = (CVaR/media)_residual ÷ (CVaR/media)_actual
residualCVaR = currentCVaR × k × factorDeCola
```

`factorDeCola` vale **1 exacto** con el modelo de frecuencia anterior y sin tope de daño, así que
este mecanismo no movió ningún número al introducirse. Se despega de 1 justo donde el escalado
proporcional deja de ser cierto: **baja** con un tope de daño (medido −51,6 %: la contención aplana
la cola más que el promedio) y **sube** con el modelo compuesto.

> **Corrección de una conclusión anterior.** Con el modelo de valor esperado, escalar la
> Vulnerabilidad multiplicaba toda la distribución por una constante y la razón cola/media quedaba
> **congelada**: de ahí salía la afirmación de que "la prevención no puede cambiar la forma de la
> cola, solo su tamaño". Era un **artefacto del modelo**, no del mundo. Con el compuesto, prevenir
> **sube** esa razón: reduce la cantidad de eventos, no lo que cuesta cada uno — hace los malos años
> más **raros**, no menos malos. Un control que corta la pérdida promedio un 60 % **no** corta el mal
> año un 60 %. El caso para la contención sale reforzado, no debilitado.

**La Decisión guarda la receta, no solo el resultado.** De un solo número (`residualALE`) no se puede
reconstruir una distribución: fija la media, nunca la forma. El portafolio reproducía cualquier
tratamiento como si hubiera sido prevención pura — acertaba el ALE ($43.018 real contra $42.918
reconstruido) y **casi triplicaba la cola** ($181.141 real contra $517.514). Por eso
`treatmentDecision.residualInputs` guarda con qué se simuló: `targetDefenseKey` (modo automático,
para reconstruir el mismo sampler calibrado) o `preventionScale` (modo manual), más `damageCap`.

El tope se **copia** dentro de la decisión en vez de leerse del formulario: si el portafolio leyera
el campo vivo, editarlo tras adoptar cambiaría la cola mientras `residualALE` sigue congelado, y los
dos números se contradirían sin avisar.

### 9.2 Deuda conocida

- **Tope de 100 en el triángulo de Resistencia.** Muerde en defensa avanzada (73,3 × 1,4 = 102,6) y
  élite (90,8 × 1,4 = 127,1). Liberarlo desviaría `estado-nación vs élite` de 45,0 % a 40,4 %,
  fuera de la tolerancia de ±1,5, y exigiría re-ajustar el nodo superior del eje de contienda.
  Mantenido a propósito hasta que se pague ese re-ajuste.
- **La Persistencia se cuenta dos veces** (dentro de FA y en la escalada). Absorbido por la
  calibración; documentado en el código.
- **Decisiones adoptadas antes de `residualInputs`** no traen receta y el portafolio las reconstruye
  con el escalado proporcional de siempre: exacto para prevención pura, aproximado si hubo
  contención. Se resuelve solo al volver a adoptar la estrategia, y ya vienen marcadas con
  `⟳ Recalibrar` por el salto a la calibración 5.
- **El tope de 100 se conserva a propósito.** Quitarlo no es un ajuste de un nodo: rompe también
  `organizado vs élite` (15,0 % → 13,7 %), y ese perfil está en el nodo FA=60, no en el superior.
  Como `organizado` tiene dos anclas y un solo nodo, sin el tope ya no caben las dos a la vez —
  habría que **re-derivar `m`**, porque el tope estaba activo en una de las dos anclas que lo
  determinan y no en la otra. Es una recalibración completa, no un parche.

---

## 10. Deslinde: el Equilibrio de Nash está FUERA de la ruta crítica

**El Equilibrio de Nash es un panel exploratorio "qué pasaría si". No participa —ni directa ni
indirectamente— en el cálculo de la Vulnerabilidad, el LEF, el ALE ni ninguna métrica del Registro.**

Hechos verificables en el código:

- `solveNashEquilibrium` se invoca desde **un único punto**: `POST /api/autocalc/nash-equilibrium`
  (`backend/src/routes/autocalc.js`), disparado por un botón explícito del usuario.
- `POST /api/simulate` **no lo importa ni lo llama**.
- El `m` del panel de Nash es un campo del formulario, **deliberadamente independiente** del
  `TULLOCK_M = 6,8254` calibrado. Nunca puede cambiar en silencio el resultado de la simulación real.
- Su resultado no se persiste en el Registro y no alimenta Tratamiento ni Gestión de Riesgos.

**Por qué se mantiene desacoplado.** Nash exige el **costo y el beneficio del atacante** — las
únicas dos cifras de toda la app que un responsable de seguridad no puede obtener de ninguna fuente.
Meterlo en la ruta crítica haría que el ALE, el número que sustenta una decisión de inversión,
dependa de dos valores inventados. Todo el trabajo de calibración de este documento va en dirección
contraria: quitarle precisión falsa al modelo.

**Qué es, entonces.** Un contraste útil: dado un Valor en Juego y un costo unitario de esfuerzo para
cada lado, ¿cuánto le convendría esforzarse a cada uno, y qué vulnerabilidad saldría de ahí? Sirve
para razonar sobre disuasión, no para calcular una pérdida.

**Cómo lo resuelve** (para evitar confusión con lo que _no_ es): mejor respuesta iterada sobre un
espacio de esfuerzo **continuo**, con búsqueda ternaria en cada paso hasta converger. **No** es una
matriz de pagos, **no** resuelve estrategias puras o mixtas sobre combinaciones discretas, y **no**
selecciona un par `(a*, d*)` que después alimente el muestreo.

La comparación "a esfuerzo fijo" que muestra el panel sí pasa por el eje de contienda calibrado,
pero usa la `m` **de ese panel**, no la calibrada — por eso puede no coincidir con la Vulnerabilidad
del Paso 2, y la interfaz lo advierte de forma explícita.

---

## 11. Registro de decisiones de modelado

Decisiones tomadas con su razón, para que quien retome esto no las revierta por desconocimiento.

| Decisión                                            | Razón                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Tullock sobre un eje calibrado, no `FA × (1 − ENC)` | La segunda tiene techo estructural (`V ≤ FA`): estado-nación contra defensa básica quedaba topado en 66 % cuando debe rondar 98 % |
| `m` derivado, no ajustado                           | Dos anclas que comparten atacante cancelan el eje y lo determinan sin suposiciones                                                |
| Eje de contienda solo en el atacante                | Validado fuera de muestra: la escala de defensa resultó consistente sin curva propia                                              |
| Acceso modula R, no C                               | El tope de 100 rompe la equivalencia; modular R es el lado conservador                                                            |
| Acceso es del riesgo, no del perfil                 | El mismo insider tiene acceso distinto a cada activo                                                                              |
| Confianza no mueve la media                         | Es incertidumbre epistémica: habla del analista, no del atacante                                                                  |
| La frecuencia baja con la capacidad                 | La mandan cuántos actores hay y qué tan indiscriminados son, no el empeño de cada uno                                             |
| Nash fuera de la ruta crítica                       | Sus insumos no son observables                                                                                                    |
| Los riesgos viejos no se recalculan solos           | Sobrescribir una evaluación guardada destruye la trazabilidad                                                                     |
| La pérdida del año es una SUMA de eventos           | `LEF × Magnitud` reparte fracciones de evento en todos los años; borra la variabilidad del conteo donde ésa _es_ todo el riesgo   |
| La cascada explica ocurrencias, no las añade        | El TEF se estima de datos que ya incluyen las veces que un padre lo causó; sumarla encima las cuenta dos veces                    |
| Adelgazar la cascada quita eventos, no escala       | Escalar la cifra del año inventa años que cuestan una fracción de incendio — la misma falacia que el modelo compuesto corrige     |
| La LEC recalcula su probabilidad empíricamente      | Con empates, la etiqueta de la escalera miente; y esa curva alimenta el eje Y de la Matriz                                        |
| El residual guarda su receta, no solo su resultado  | Un número fija la media, nunca la forma: prevenir y contener dan la misma media y colas al triple                                 |
