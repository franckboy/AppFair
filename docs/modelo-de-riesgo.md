# Especificación técnica del modelo de riesgo de AppFair

Documento normativo del motor cuantitativo. Describe **lo que el código hace**, no lo que podría
hacer: cada constante y cada fórmula de aquí está tomada de la base de código y verificada por la
suite de regresión. Si este documento y el código discrepan, el código manda y este documento está
mal.

> **Deslinde de normas.** Los porcentajes, escalas y fórmulas de este documento son **metodología
> cuantitativa propia de AppFair**. ISO 31000, ISO 28000 y ASIS aportan el marco de proceso
> (contexto, identificación, análisis, evaluación, tratamiento, controles), pero **no prescriben
> estas cifras ni estas fórmulas**, y la app no debe afirmar lo contrario.

**Estado: calibración 7** (se quita el tope de 100 de la Fuerza de Resistencia y se recalibra
entera, §4 y §9.1). Archivos de referencia:

| Pieza                                                   | Archivo                                    |
| ------------------------------------------------------- | ------------------------------------------ |
| Calibración, eje de contienda, acceso, re-centrado      | `backend/src/lib/autocalc.js`              |
| Perfiles y bandas de confianza                          | `backend/src/data/profiles.js`             |
| Monte Carlo, modelo de frecuencia, curva de excedencia  | `backend/src/lib/simulation.js`            |
| Agregación de portafolio y cascada                      | `backend/src/lib/portfolioSimulation.js`   |
| Residual del Tratamiento                                | `backend/src/lib/autocalc.js`              |
| Frecuencia sugerida                                     | `frontend/src/modules/utils.js`            |
| Equilibrio de Nash (panel aparte)                       | `backend/src/lib/nashEquilibrium.js`       |
| Umbral de disuasión, Stackelberg (panel aparte)         | `backend/src/lib/stackelbergDeterrence.js` |
| Procedencia por factor                                  | `backend/src/lib/provenance.js`            |
| Bitácora de Incidentes                                  | `backend/src/lib/incidentLog.js`           |
| Tabla de referencia del sector (datos, fuera de la app) | `tools/referencia-sector/`                 |
| Invariantes ejecutables                                 | `backend/test/lib.test.js`                 |

### Cómo leer este documento

Las secciones **1 a 9** describen la ruta crítica: cómo un juicio experto se convierte en una
distribución de pérdidas y esa distribución en una clasificación. Las secciones **12 a 16** son el
detalle matemático de las piezas que esa ruta usa —las distribuciones, la clasificación, el
tratamiento, la cascada, Nash, la disuasión— y se pueden leer sueltas.

Tres secciones no describen cálculo sino **de qué está hecho el cálculo**, y son las que hay que
leer antes de citar cualquier cifra fuera de la app: §2.4 (de dónde salió cada número), §6.4 (por
qué las anclas de calibración no pueden falsear el modelo) y §16.2 (qué haría falta para que
alguna vez estuviera validado).

**La numeración de secciones es estable a propósito:** varios comentarios del código apuntan a ella
por número (`ver §7.1`, `ver §8.3`). Al ampliar este documento se agregan secciones nuevas al final
o subsecciones nuevas dentro de las existentes; **nunca se renumera** lo que ya está.

### Notación

Se usa de forma consistente en todo el documento. `x ~ D` significa "x se muestrea de la
distribución D"; `E[·]` es la esperanza; `1{·}` es la función indicadora.

| Símbolo      | Significa                                                    | Dominio      | Dónde se define |
| ------------ | ------------------------------------------------------------ | ------------ | --------------- |
| `FA`         | Factor de Amenaza — promedio de los 5 atributos del atacante | `[0, 100]`   | §2.1            |
| `ENC`        | Nivel de Defensa — promedio de los 6 atributos de la defensa | `[0, 100]`   | §2.2            |
| `C`          | Capacidad de Amenaza en el eje de contienda                  | `(0, ∞)`     | §3              |
| `R`, `R_eff` | Fuerza de Resistencia; `R_eff = ENC · α`                     | `(0, ∞)`     | §4              |
| `α`          | Factor del Nivel de Acceso                                   | `(0, 1]`     | §4              |
| `m`          | Decisividad de la contienda de Tullock                       | `> 0`        | §5.1            |
| `V`          | Vulnerabilidad — P(un intento se vuelve pérdida)             | `[0,005, 1]` | §5              |
| `TEF`        | Frecuencia de Eventos de Amenaza (intentos/año)              | `[0, ∞)`     | §7.2            |
| `LEF`        | Frecuencia de Eventos de Pérdida; `LEF = TEF · V`            | `[0, ∞)`     | §7.1            |
| `N`          | Número de eventos de pérdida en un año; `N ~ Poisson(LEF)`   | `ℕ₀`         | §7.1            |
| `M`          | Magnitud de UN evento — suma de las categorías activas       | `[0, ∞)`     | §12.3           |
| `L`          | Pérdida anual de un riesgo; `L = Σ M_j`                      | `[0, ∞)`     | §7.1            |
| `ALE`        | Pérdida Anual Esperada; `ALE = E[L]`                         | USD          | §7.3            |
| `CVaR₉₅`     | Promedio del peor 5 % de los años                            | USD          | §7.3            |
| `λ`          | Concentración de la Beta-PERT (fijo en 4)                    | `> 0`        | §12.1           |
| `a, m̂, b`    | Mínimo, moda y máximo de un estimado de tres puntos          | —            | §12             |
| `n`          | Iteraciones Monte Carlo (10.000 salvo que se diga otra cosa) | —            | §7.1            |

> Cuidado con dos colisiones de letra, ambas heredadas de la literatura y conservadas para que las
> fórmulas se puedan cotejar con ella: `m` es la decisividad de Tullock, y `m̂` la moda de un
> estimado de tres puntos. `M` (mayúscula) es una magnitud de pérdida.

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
| `empleado-desleal` | 80         | 40       | 58        | 45           | 48            | **54,2** |
| `organizado`       | 65         | 60       | 60        | 65           | 50            | **60,0** |
| `estado-nacion`    | 90         | 90       | 90        | 90           | 90            | **90,0** |

La ventaja real de un insider es el **acceso**, no la capacidad, y el acceso se modela aparte (§4).
El perfil original (FA 68) afirmaba que un empleado descontento tiene más capacidad y sofisticación
que una organización criminal profesional, lo cual no se sostiene.

**Corregido en la calibración 6.** Hasta la calibración 5, `empleado-desleal` daba FA **60,0** — el
mismo que `organizado`— así que compartía nodo del eje de contienda (§3) y el modelo **no los
distinguía en ninguna celda** de la grilla: 98,5 / 59,3 / 30,4 / 14,7 contra 98,5 / 59,6 / 30,8 /
15,0, y esa diferencia era ruido de muestreo. La app ofrecía una elección que el cálculo ignoraba.

El análisis de sensibilidad (§ tools/anchor-sensitivity) lo destapó y midió además algo que la
explicación intuitiva —"el FA es un promedio simple y eso es lossy"— no anticipaba: **ponderar los
atributos no lo habría arreglado**. Con el ancla 5 leída como estaba, bajar el FA del insider de 60
a 45 movía la grilla menos de 1 punto, porque el nodo se re-ajustaba hacia arriba para compensar.
La causa real estaba en el **ancla**, no en el promedio (§6.1).

Se corrigen los dos atributos que estaban indefendiblemente pegados al crimen organizado:

| Atributo     | Antes | Ahora | Por qué                                                                                   |
| ------------ | ----- | ----- | ----------------------------------------------------------------------------------------- |
| Recursos     | 52    | 40    | Actúa solo: sin financiamiento, sin cómplices reclutados, sin a quién colocar lo suyo     |
| Persistencia | 62    | 45    | Ventana corta y situacional; el crimen organizado casa el objetivo, reintenta y se adapta |

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

### 2.4 Procedencia por factor: de dónde salió cada número

`ALE = TEF · V · E[M]` es **multilineal**: la elasticidad de los tres factores es exactamente 1
(§9), así que un error del 50 % en cualquiera de ellos es un error del 50 % en la respuesta. Pero el
esfuerzo de calibración está repartido de forma muy desigual:

| Factor             | Cómo se obtiene hoy                                   | Calibración                                     |
| ------------------ | ----------------------------------------------------- | ----------------------------------------------- |
| **Vulnerabilidad** | Motor de contienda (§3-§6)                            | 8 anclas, análisis de sensibilidad, 7 versiones |
| **TEF**            | Sugerencia editable de 3 anclas (§7.2)                | Sin validación ni sensibilidad                  |
| **Magnitud**       | La teclea el usuario; min/max por factor de confianza | Ninguna                                         |

Dos tercios del modelo, que pesan igual que el primero, no tienen ni un ancla ni una prueba. Por eso
cada riesgo declara la procedencia **de cada factor por separado**, no una sola por riesgo:

```
origen ∈ { historico-propio, benchmark-sector, catalogo, juicio-experto }
       + observaciones (cuántas)  + exposicion (en cuánto)  + fuente (texto)
```

El orden de la lista es de más a menos sostenido por evidencia, y define el **eslabón más débil** de
un riesgo (`weakestOrigin`). El default es `juicio-experto`: no declarar nada es en sí una
declaración, y es la más honesta de las cuatro.

**Declarar observaciones sin exposición se rechaza al capturar.** "4 incidentes" no dice nada sin
"en cuántos años", y descubrirlo cuando ya no se le puede preguntar a nadie es descubrirlo tarde.

Del resumen del portafolio sale una cifra que cambia una conversación con un comité por sí sola: el
**porcentaje del modelo sostenido por algo observado**, promediando los tres factores sin ponderar
(elasticidad 1 cada uno). Un 33 % significa "uno de los tres factores tiene datos detrás", **no**
"un tercio de la respuesta es correcta".

Sin este campo no existe la ponderación por credibilidad (§16.2): `Z = n/(n+k)` necesita `n`, y `n`
es exactamente lo que el `dataSource` viejo —uno por riesgo, en texto libre— nunca guardó.

---

## 3. Eje de contienda del atacante

Traduce el puntaje semántico a la escala en la que de verdad compite contra la defensa.
Interpolación lineal monótona entre nodos; por encima del último, extiende la pendiente final.

```
C = attackerContestStrength(FA)
```

| FA   | C          |
| ---- | ---------- |
| 0    | 0          |
| 18   | **14,295** |
| 43   | **22,561** |
| 54,2 | **40,340** |
| 60   | **57,373** |
| 90   | **79,129** |

El nodo 54,2 (`empleado-desleal`) es nuevo desde la calibración 6. Antes ese perfil caía en el nodo
60 y era indistinguible de `organizado` (§2.1).

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
| `medio` | Medio / Operativo   | **0,698**          |
| `alto`  | Alto / Privilegiado | **0,559**          |

**Por qué modula R y no C.** Bajo Tullock solo cuenta la razón `C/R`, así que `R·α` y `C/α` son
**exactamente** equivalentes. Hasta la calibración 6 no lo eran: el triángulo de Resistencia tenía
un tope duro en 100 que mordía con defensa avanzada y élite, así que escalar R hacia abajo lo
liberaba mientras que subir C no (medido contra defensa élite, las dos rutas diferían hasta **4,7
puntos**, y modular R daba el resultado conservador). Quitado el tope en la calibración 7, la
elección ya no cambia ningún número: se conserva porque describe lo que de verdad pasa —cuánto de tu
defensa llega a interponerse— no porque importe al cálculo.

**Los α están despejados, no elegidos.** Se anclan sobre **una sola pareja fija** —`organizado`
(C = 57,373) vs `estándar` (ENC = 55,0)— variando únicamente el Nivel de Acceso. Al mantener C y R
constantes, ambos se cancelan y la variación de Vulnerabilidad es función pura de α: cada ancla
despeja su factor de forma unívoca, y la monotonía sale por construcción.

| Acceso | Ancla de Vulnerabilidad    | α despejado |
| ------ | -------------------------- | ----------- |
| nulo   | 60 % (es el ancla base #3) | 1,000       |
| bajo   | 72 %                       | 0,878       |
| medio  | 88 %                       | 0,698       |
| alto   | 96 %                       | 0,559       |

La pareja se eligió por estar en la **zona central de la sigmoide**, donde `m` tiene su mejor
resolución.

**Por qué NO se ancla cruzando celdas.** Un intento anterior usó tres combinaciones distintas de
atacante y defensa. Los α despejados salieron **0,614** (bajo), **0,777** (medio) y **0,686** (alto)
— **no monótonos**: "bajo/perimetral" habría desarmado más controles que "alto/privilegiado". La
causa fue anclar en celdas pegadas al piso de 0,5 %, donde mover la Vulnerabilidad unos décimos
exige recortes enormes de α. **Regla: el acceso se ancla sobre una pareja fija en la zona central,
nunca cruzando celdas.**

**`α = 1,00` es un no-op exacto**, y por eso siete de las ocho anclas se emiten ahí sin más. La
octava —la del empleado desleal— se emite con α de acceso medio, por lo explicado en §6.1.

---

## 5. Vulnerabilidad

### 5.1 Función de contienda de Tullock

```
V(C, R) = C^m / (C^m + R^m)          m = 6,4073  (cítese «≈ 6,4», ver §6.1)
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
también el centro, porque Tullock con `m ≈ 6,4` es muy convexo y las iteraciones donde el
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
seguridad patrimonial, todas con **confianza media**. Siete van con **acceso nulo**; la 5 va con
**acceso medio** — ver por qué justo abajo.

### 6.1 Las seis de calibración

| #   | Atacante         | Defensa  | Vulnerabilidad          |
| --- | ---------------- | -------- | ----------------------- |
| 1   | oportunista      | básica   | 5 %                     |
| 2   | vandalismo       | básica   | 35 %                    |
| 3   | organizado       | estándar | 60 %                    |
| 4   | organizado       | élite    | 15 %                    |
| 5   | empleado desleal | avanzada | 30 % (acceso **medio**) |
| 6   | estado-nación    | élite    | 45 %                    |

**Por qué el ancla 5 lleva acceso medio.** "Un insider sin ningún acceso" es una contradicción de
términos. Hasta la calibración 5 esa ancla se leía sobre el eje de acceso nulo, y para hacer que un
empleado _sin acceso_ diera 30 % contra defensa avanzada, la calibración tenía que empujar su nodo
de contienda hasta **56,911** —la fuerza bruta de una banda criminal, en los números de la
calibración 5— compensando un acceso que el
modelo ya cuenta aparte en §4. Es el mismo error de _"está adentro" se coló dentro de "es capaz"_
que ya se había corregido en los atributos del perfil, pero que el ancla volvía a meter por la
puerta de atrás; y es lo que hacía que el Empleado Desleal y el Crimen Organizado dieran el mismo
número (§2.1).

Releída donde corresponde, **el juicio del experto se conserva intacto**: con acceso medio el
modelo sigue dando 30,0 %. Lo que cambia es el mismo insider contra un activo al que **no** tiene
acceso, que pasa de 30 % a **6,9 %** — que es lo que siempre debió decir.

Costo honesto del cambio: mientras `empleado-desleal` y `organizado` compartían nodo, el ancla 5
era una **comprobación** (tres anclas fijaban un solo parámetro y el peor residuo del conjunto era
de 0,44 pp — nada obligaba a que cuadraran). Con nodo propio, el ancla 5 ajusta exactamente por
construcción y esa comprobación desaparece. Se cambió una validación interna por una distinción que
el analista sí ve y usa; las anclas 3, 4, 7 y 8 se siguen validando entre sí igual que antes.

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
m = 6,4073     ← el valor del código
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

| #   | Atacante   | Defensa  | Ancla | Predicción del modelo (calib. 7) | Residuo |
| --- | ---------- | -------- | ----- | -------------------------------- | ------- |
| 7   | organizado | básica   | 98 %  | **98,3 %**                       | +0,3 pp |
| 8   | organizado | avanzada | 30 %  | **31,7 %**                       | +1,7 pp |

Confirman que la escala de Defensa es internamente consistente y **no necesita curva de calibración
propia**. Esta es la validación más fuerte del modelo: no se ajustó nada para conseguirla.

**La calibración 7 la empeoró, y hay que decirlo.** Con el tope de 100 activo el ancla 8 daba
30,8 % (+0,8 pp); quitarlo la subió a 31,7 % (+1,7 pp), porque el tope mordía justo en la banda
`avanzada`. Sigue siendo una validación buena —5,8 % de error relativo sobre un juicio de "30 %"—
pero es menos apretada que antes, y la tolerancia de la suite para este par se subió de 1,5 a 2 pp
(§9). Se aceptó a ojo abierto: el tope sesgaba **toda** la grilla contra la defensa fuerte, y eso
pesa más que 0,9 pp en una celda de comprobación.

### 6.3 Grilla resultante

Vulnerabilidad media (%), confianza media, acceso nulo. `*` = celda anclada.

| Atacante         | básica     | estándar   | avanzada   | élite      |
| ---------------- | ---------- | ---------- | ---------- | ---------- |
| oportunista      | **5,0\***  | 0,5        | 0,5        | 0,5        |
| vandalismo       | **35,0\*** | 1,4        | 0,6        | 0,5        |
| empleado desleal | 88,5       | 23,7       | 7,0        | 2,3        |
| organizado       | **98,3\*** | **60,0\*** | **31,7\*** | **15,0\*** |
| estado-nación    | 99,8       | 86,1       | 65,0       | **45,0\*** |

`empleado-desleal` no tiene celda anclada en esta tabla: su ancla se emitió con **acceso medio**
(§6.1), y esta grilla es a acceso nulo. Ahí es donde vive:

| empleado desleal, por Nivel de Acceso | básica | estándar | avanzada   | élite |
| ------------------------------------- | ------ | -------- | ---------- | ----- |
| nulo                                  | 88,5   | 23,7     | 7,0        | 2,3   |
| bajo                                  | 93,9   | 35,6     | 12,8       | 4,6   |
| medio                                 | 98,3   | 59,2     | **30,0\*** | 13,7  |
| alto                                  | 99,6   | 79,4     | 52,4       | 30,7  |

Rango cubierto: **0,5 % – 99,8 %**. El modelo anterior (`m = 1`, sin eje de contienda) comprimía
toda la grilla entre 17,7 % y 76,3 %: pasar de defensa básica a élite apenas dividía la
Vulnerabilidad a la mitad, así que la app **subvaloraba sistemáticamente la inversión en
seguridad**, y eso alimentaba directo a la estrategia de Mitigar.

---

### 6.4 Cero grados de libertad: lo que las anclas de calibración NO pueden hacer

Conviene decirlo sin adornos porque es la limitación epistemológica de fondo del motor de
Vulnerabilidad, y no se arregla ajustando nada.

El ajuste tiene **9 juicios** de entrada (las 6 anclas de calibración de §6.1 más las 3 de nivel de
acceso de §4) y **9 parámetros** libres (`m`, los 5 nodos del eje de contienda de §3, y los 3
factores `α` del acceso). Nueve ecuaciones, nueve incógnitas: el sistema está **exactamente
identificado**.

La consecuencia es que **las anclas de calibración no pueden falsear el modelo**. Reproducirlas no
es evidencia de que el modelo sea correcto; es aritmética. Se midió durante la calibración 6: bajar
la FA del empleado desleal de 60 a 45 respetando el ancla movió la grilla **menos de un punto**,
porque el nodo se re-ajustaba hacia arriba para compensar. El ancla mandaba, no el atributo.

Lo único que sí puede contradecir al motor son:

1. **Las 2 anclas de validación fuera de muestra** (§6.2), que no participan del ajuste. Son las
   únicas de las ocho con poder de falsear, y son dos.
2. **Un histórico real de incidentes** (§16.2), que todavía no existe.

Por eso este documento habla de verificación **interna** (coherencia, monotonía, sensibilidad) y
nunca de validación externa: no son lo mismo y confundirlas sería el error más caro de todos.

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
                                          Tullock(m≈6,4) + piso 0,005
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

**El estado de este factor.** Hasta la incorporación de `/api/autocalc/frequency`, éste era el
único de los tres factores del ALE sin ningún motor de autocálculo: existían `/vulnerability`,
`/loss-magnitude`, `/reduccion-ale`, `/nash-equilibrium` y `/deterrence` — frecuencia no. Estas tres
anclas eran una sugerencia que el usuario pisaba a mano, y pesan lo mismo en el ALE que las 8 anclas
y las 7 calibraciones de la Vulnerabilidad (§2.4).

Sigue siendo el eslabón más flojo **mientras no haya un histórico propio**: la sugerencia por perfil
no cambió, y sin datos la calibración de §7.2.1 no tiene con qué correr. Lo que cambió es que ahora
existe el camino para cerrarlo con evidencia real.

### 7.2.1 Exposición y calibración con histórico propio

**El denominador que faltaba.** El TEF se define en intentos/AÑO. Una empresa de transporte no habla
así: dice "3 robos en 1.200 viajes". La bitácora (§16.2) ya sabía capturar eso y no podía compararlo
con nada — seis de sus siete unidades estaban muertas, o sea que la app pedía un dato que después no
podía consumir. La pieza que faltaba es un número por riesgo: **cuánta exposición hay al año**.

```
TEF_anual = tasa_por_unidad · exposicion_anual
```

Con 1.200 viajes/año, "0,01 intentos por viaje" y "12 intentos al año" son el mismo riesgo dicho de
dos maneras. Sin ese 1.200 no hay forma de pasar de una a la otra.

**El TEF sigue siendo anual y canónico.** La exposición es cómo se LLEGA a él y el diccionario que
permite comparar una observación en viajes contra un modelo anual — no una unidad alternativa en la
que el motor trabaje. Hacer canónica la tasa obligaría a que todo consumidor del TEF (Monte Carlo,
portafolio, Euler, Criterios de Riesgo, cascadas) conociera la exposición para interpretarlo, y un
riesgo con exposición rota produciría basura en silencio en vez de un error visible. Un riesgo que
no declara exposición es el caso neutro (años, factor 1): exactamente el comportamiento anterior.

**Comparable pasa a ser propiedad del par observación-riesgo**, no de la unidad. La unidad neutra
siempre compara porque el modelo es anual; cualquier otra compara si el riesgo declaró SU exposición
en esa misma unidad. Viajes contra bodegas-año sigue sin tener sentido.

**La calibración (`POST /api/autocalc/frequency`).** Mezcla el triángulo declarado (prior) con un
conteo propio (evidencia). Dos pasos que no se pueden saltar:

1. **Invertir de pérdidas a intentos: `TEF = LEF / V`.** Una bitácora cuenta robos consumados.
   Enchufarlos directo al TEF haría que el motor volviera a aplicar la Vulnerabilidad y descontara
   las defensas dos veces (§16.2). Por eso este cálculo NECESITA la Vulnerabilidad, y se niega a
   correr sin ella en vez de devolver un número mal por un factor de 1/V.
2. **Convertir de la unidad de exposición a años**, con el factor de arriba.

La mezcla es Poisson-Gamma exacto, que da la credibilidad en forma cerrada **sin constantes
inventadas**:

```
prior λ ~ Gamma(α, β),  media = α/β,  CV² = 1/α
posterior tras c eventos en exposición E:  Gamma(α + c, β + E)
credibilidad de lo observado:  Z = E / (β + E)
```

`α` sale del **ancho del triángulo que el usuario ya declaró**: `SD ≈ (max − min)/6`, `α = 1/CV²`.
Un rango ancho (mucha duda) se deja mover por poca evidencia; uno angosto se resiste. Y `β = α/λ`
es la **exposición equivalente del prior**: cuántos años de observación propia vale la corazonada —
la cifra que de verdad responde "¿cuánto pesa mi dato contra lo que el modelo ya creía?".

Medido con TEF 5/10/18 (prior de 10,5 intentos/año, equivalente a 2,24 años de observación) y 3
pérdidas en 1.200 viajes con V = 20 %:

| Triángulo declarado   | Vale como | Z     | TEF calibrado |
| --------------------- | --------- | ----- | ------------- |
| 5 / 10 / 18           | 2,24 años | 0,309 | 11,9          |
| 2 / 10 / 40 (ancho)   | 0,34 años | 0,746 | 14,7          |
| 9 / 10 / 11 (angosto) | 90 años   | 0,011 | 10,05         |

Con la misma tasa observada durante 10 años en vez de 1, Z sube a 0,817 y el TEF a 14,2. El
resultado siempre queda **entre** el prior y lo observado, y nunca lo adopta entero.

#### El sesgo de Jensen, y por qué se divide por la MODA de V

`V` no es un número, es una distribución. Y `1/V` es convexa, así que por la desigualdad de Jensen
`E[1/V] ≥ 1/E[V]`: dividir por **cualquier** estimador puntual subestima el TEF. Es real, y siempre
va hacia abajo — el lado en el que no se puede fallar.

Medido con 2.000.000 de muestras del mismo PERT que usa el motor:

| Rango de V   | E[1/V] | Error con `1/media` | Error con `1/MODA` |
| ------------ | ------ | ------------------- | ------------------ |
| 20 / 30 / 42 | 3,361  | −1,9 %              | **−0,8 %**         |
| 10 / 25 / 50 | 4,085  | −8,2 %              | **−2,1 %**         |
| 5 / 20 / 60  | 5,048  | −18,0 %             | **−1,0 %**         |
| 45 / 50 / 55 | 2,003  | −0,1 %              | **−0,1 %**         |
| 2 / 10 / 45  | 9,515  | −27,5 %             | **+5,1 %**         |

Con la media el error llega al **27 %** en un triángulo ancho —eso no es despreciable—, pero con la
**moda** queda por debajo del 2 % en los rangos realistas. La razón es geométrica: en un PERT
sesgado a la derecha la moda cae por debajo de la media, y `1/moda` sobreestima `1/media` en casi
exactamente la dirección que Jensen pide.

**Es una coincidencia afortunada, no un diseño, y por eso se documenta.** Quien lea `vuln.mode` y
piense "debería ser la media, la media es más correcta" empeoraría el modelo **13×** en el caso
5/20/60. Hay una prueba en la suite que fija esta elección precisamente para que ese cambio falle
en vez de pasar inadvertido.

No se corrige porque con menos del 2 % de sesgo residual el error queda muy por debajo del error de
la propia evidencia: un conteo de 3 eventos trae ~58 % de error de muestreo (1/√n), que lo domina
por completo. Si algún día se quiere el cálculo exacto, el arreglo es **muestrear V del mismo PERT
y promediar `1/V`** — sin aproximaciones de Taylor ni constantes nuevas.

Hay dos piezas construidas alrededor de ese hueco, ninguna enchufada todavía a la ruta crítica:

- **`tools/referencia-sector/`** — tablas de frecuencia y magnitud del sector con su cuarentena
  verificable en código. Marcadas `benchmark-sector` y con `Z = 0` declarado: es un **prior**, no
  una validación. Su verificador falla si alguien marca usable una entrada a la que le falta el
  denominador, el factor de escala o el monto.
- **El umbral de disuasión** (§16.1), que sí calcula una frecuencia a partir de los incentivos del
  atacante, pero vive en el panel exploratorio y no toca ninguna cifra del Registro (§10).

### 7.3 Métricas de salida

| Métrica          | Definición                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALE**          | Media aritmética de las 10.000 pérdidas anuales                                                                                                                                 |
| **p90**          | `sorted[floor(n × 0,9)]`                                                                                                                                                        |
| **CVaR95**       | **Media del peor 5 %** de las pérdidas. **No es un percentil** — por eso vale más que uno para dimensionar cobertura                                                            |
| **LEC**          | Curva de excedencia: pérdida asociada a cada una de **34 probabilidades** entre 100 % y 0,1 %, con la probabilidad **recalculada empíricamente** sobre las pérdidas (ver abajo) |
| **Años en cero** | `zeroLossYearsPercent`: qué % de los años simulados no registró ningún evento                                                                                                   |
| **Eventos**      | `events`: cuántos ataques prosperaron, no cuánto costaron (ver abajo). `null` con el modelo `expected`                                                                          |
| **Sensibilidad** | Correlación de **Spearman** (rangos) entre cada variable de entrada y la pérdida simulada                                                                                       |

| **Ruido de muestreo** | `standardErrorPercent` y `cvar95StandardErrorPercent`: cuánto le queda de error a cada cifra por haber corrido N escenarios y no infinitos |

> **No existe `p95` en la salida.** Las métricas de cola son p90, CVaR95 y la LEC completa.

#### Cuánto ruido traen las propias cifras, y por qué son dos números

La media tiene fórmula cerrada (`σ/√n`). El CVaR **no tiene una simple**, así que se estima por
**medias por lotes**: se parte la misma corrida en 20 trozos, se calcula el CVaR de cada uno, y el
desvío entre ellos ÷ √20 estima el error del total. No cuesta ni una iteración extra.

Dos detalles que no son opcionales. Los lotes tienen que ser tramos contiguos del arreglo **en
orden de iteración**; sobre el arreglo ordenado el estimador se rompe en las dos direcciones (con
paso fijo da submuestras estratificadas y **subestima**; con tramos contiguos mide la forma de la
distribución y **sobreestima**). Y por debajo de 40 escenarios por lote devuelve `null` en vez de un
número sin sentido.

Validado contra la verdad — el desvío real del CVaR entre 40 semillas distintas:

| Perfil                 | Error real | Estimado de 1 corrida |
| ---------------------- | ---------- | --------------------- |
| raro-severo (LEF 0,05) | 4,91 %     | 4,61 %                |
| medio (LEF 0,6)        | 1,54 %     | 1,72 %                |
| frecuente (LEF 8)      | 0,72 %     | 0,56 %                |

**Por qué importa que se reporten.** La muestra útil no es `n`: con el modelo compuesto un año sin
eventos vale 0 y no aporta información, así que es

```
n_efectivo = n · (1 − e^−LEF)
```

Con `LEF = 0,05` y 10.000 iteraciones son **488 años útiles**, y de ahí sale un error del ~5 % en las
dos cifras. Son justo los riesgos que dominan la cola del portafolio y el reparto de Euler (§8.5).
Medido, las iteraciones que harían falta para dejar el CVaR en ±2 % van de **1.294** (frecuente) a
**60.314** (raro-severo): un factor de 47 que un tope fijo de 10.000 no puede cubrir en los dos
extremos. Sirve de más a un riesgo frecuente y de menos a uno raro.

#### El `n` lo decide el motor, no un tope fijo

`POST /api/simulate` tiene dos modos, y manda si el cliente pidió un número:

| `iterations` | Modo         | Qué hace                                                                          |
| ------------ | ------------ | --------------------------------------------------------------------------------- |
| explícito    | `fijo`       | Corre ese número exacto. Comportamiento de siempre, para reproducir cifras viejas |
| omitido      | `adaptativo` | Corre por lotes hasta bajar del error objetivo del CVaR (2 % por defecto)         |

**El primer lote se despeja del LEF**, no es un número redondo: `n = años_útiles_objetivo /
(1 − e^−LEF)`, apuntando a ~2.000 años en que algo pasó. Después el bucle mide el error real y
proyecta `n_objetivo = n · (error/meta)²`, creciendo como mucho ×4 por paso para que una estimación
ruidosa no se coma el presupuesto de una.

Medido, con objetivo ±2 %:

| Perfil                 | 1.er lote | `n` final | Lotes | Error logrado | Tiempo |
| ---------------------- | --------- | --------- | ----- | ------------- | ------ |
| raro-severo (LEF 0,05) | 41.009    | 74.862    | 2     | 1,82 %        | 299 ms |
| medio (LEF 0,6)        | 5.000     | 5.000     | 1     | 1,98 %        | 14 ms  |
| frecuente (LEF 8)      | 5.000     | 5.000     | 1     | 0,81 %        | 25 ms  |

El raro pasó de 4,91 % a 1,82 % de ruido; los otros dos usan **la mitad** que el viejo tope y
terminan antes.

**Tres cortes, y el resultado dice cuál fue** (`stoppedBy`): `objetivo`, `tiempo` (presupuesto de
1,2 s) o `techo` (200.000). Los dos últimos entregan una cifra con más ruido del pedido — eso es
aceptable, no avisarlo no lo es.

El presupuesto de tiempo es la restricción real, no el techo: 200.000 iteraciones van de 0,8 s
(riesgo raro) a 3,8 s (frecuente con las 9 categorías), y Node corre esto en un solo hilo. Funciona
por una coincidencia afortunada: **los riesgos que necesitan más iteraciones son los baratos por
iteración** — un riesgo raro casi no sortea magnitudes porque casi ningún año trae eventos.

**Reproducibilidad.** Cada lote usa una semilla derivada de la original (mezcla con la proporción
áurea), así que la misma semilla da el mismo resultado **y el mismo `n`**. El primer lote usa la
semilla tal cual, de modo que el caso normal —un solo lote— es idéntico bit a bit a una corrida fija
de ese tamaño. Verificado: lotes concatenados y una corrida larga equivalente coinciden dentro del
error de muestreo. Como `n` deja de conocerse de antemano, la respuesta **siempre** trae
`usedIterations`: sin eso una cifra guardada no se puede volver a producir.

**Y nunca se muestran solos.** Este error es el numérico, no el de las entradas. Con un TEF que es
juicio experto con ±50 % de incertidumbre, el ALE hereda ±50 %, y ninguna cantidad de iteraciones lo
toca — presentar un ±1,8 % sin decir eso sería exactamente la falsa precisión que §2.4 existe para
medir.

**El conteo de eventos: la única salida que no está en dinero.** Todas las demás métricas de la
tabla son pesos. Pero el motor, en cada iteración, sortea `N ~ Poisson(TEF · V)` — cuántos ataques
superaron la defensa ese año — y hasta ahora ese conteo se descartaba después de usarlo para sumar
magnitudes. `summarizeEventCounts` lo devuelve: total de eventos, media por año, máximo en un solo
año, y la distribución completa (cuántos años trajeron 0, 1, 2… eventos).

Importa por tres razones. Es **la lectura intuitiva**: "el ataque prosperó 4.012 veces en 10.000
años" se entiende sin saber qué es un percentil. Es **la salida comparable contra la realidad**: una
bitácora de incidentes cuenta eventos, no promedios, así que este es el único número del motor que
un histórico real puede contradecir de frente (§17). Y es **coherente por construcción** con el
dinero: con el modelo compuesto, cero eventos implica pérdida cero, así que
`distribution[0].years / years` tiene que dar exactamente `zeroLossYearsPercent`. Hay un test que lo
fija — si las dos cifras se separan, una de las dos está mal.

No se devuelve un "porcentaje de años tranquilos" propio, justamente porque sería
`zeroLossYearsPercent` con otro nombre. Dos cifras que siempre coinciden y que alguien puede
desincronizar tocando una sola son una trampa, no una comodidad.

**Por qué la LEC recalcula su probabilidad.** La curva se arma buscando, para cada probabilidad de
la escalera, el cuantil correspondiente. Con una distribución continua la etiqueta y la realidad
coinciden; en cuanto hay **empates**, el cuantil deja de ser inyectivo y la etiqueta miente. Con el
modelo compuesto, un riesgo raro tiene el 95 % de sus años en `$0` exacto, así que los puntos de
100 %, 99 %, 98 %… caían todos en `$0` y afirmaban _"100 % de probabilidad de perder más de \$0"_
cuando la respuesta real es 5 %. Esa curva alimenta el eje Y de la Matriz de Riesgos y el punto
residual, así que el error no se quedaba en el dibujo.

**Por qué Spearman y no Pearson.** El modelo no es lineal y Pearson solo mide relación lineal:
Tullock con `m ≈ 6,4` es fuertemente convexo y la Magnitud es lognormal de cola pesada, así que
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

### 8.5 De quién es el año malo (asignación de Euler)

El CVaR conjunto es subaditivo: vale menos que la suma de los individuales. Eso deja abierta la
pregunta que un comité hace primero — de ese año malo, **¿cuánto pone cada riesgo?**

La respuesta **no** es el CVaR de cada uno. Un riesgo enorme que nunca coincide con los demás
aporta poco al año malo del conjunto; dos medianos que caen juntos —porque uno dispara al otro en
el Árbol de Cascada— aportan mucho más de lo que sugieren por separado. El CVaR individual no sabe
con quién coincide.

La asignación correcta condiciona a la cola **conjunta**:

```
contribución_i = E[ pérdida_i | pérdida_total está en el 5 % de años peores ]
```

Su propiedad clave: **suma exactamente el CVaR95 del portafolio**, sin residuo que repartir a ojo.
No es una convención cómoda — es el teorema de Euler sobre funciones homogéneas de grado 1, y es el
mismo criterio con el que una aseguradora asigna capital entre líneas de negocio. La suite lo
verifica como igualdad (tolerancia de punto flotante), no como aproximación.

**Detalle de implementación que no es opcional:** la cola tiene que ser exactamente el mismo
conjunto de iteraciones que usa `summarizeLosses` para su `cvar95` — las `n − ⌊0,95n⌋` peores. Por
eso se ordenan **índices**, no valores. Con empates da igual cuál de los empatados entre (su valor
es el mismo por definición), así que la suma no depende del criterio de desempate.

**Qué añade sobre el Pareto.** El Pareto ordena por el año **promedio**; esto ordena por el año
**malo**, y no dan lo mismo. Medido sobre un portafolio de cuatro riesgos: un asalto raro y severo
pesa bastante menos en el promedio que en la cola, donde llega al **94 %**. Por eso cada riesgo se
reporta con sus **dos** cuotas, y la interfaz marca al que pesa más en la cola que en el promedio:
ése es un problema de año malo —le sirve más contener el daño por evento que bajar la frecuencia—
y se trata distinto que un costo recurrente.

### 8.6 Limitación conocida: el arrastre es de a lo sumo uno por año

`correlationPenalty` se documentaba como "siempre ≥ 0". **Es falso**, y se descubrió al construir la
asignación de arriba: con aristas de probabilidad alta se vuelve **negativa**.

La causa es real y está en el motor de cascada: `marca` es un indicador 0/1, así que un padre
arrastra a su hijo **como mucho una vez por año**, aunque haya ocurrido tres veces. Cuando casi toda
la ocurrencia del hijo pasa a ser inducida (espontánea ≈ 0), esa regla le borra sus años de **varios
eventos**, que son justo los que le engordaban la cola. Concentrar al hijo con el padre sube la
cola; taparle los años múltiples la baja; a probabilidad alta gana lo segundo.

Se deja el comportamiento tal cual y se **nombra** la limitación, en vez de taparla con un
`Math.max(0, …)` que escondería el síntoma. La interfaz cambia la etiqueta cuando el valor sale
negativo, para no llamar "penalización" a algo que restó. Arreglarlo de verdad es hacer el arrastre
**multi-evento** (proporcional al conteo del padre) — un cambio de modelo con su propia calibración,
no un parche. La suite fija el comportamiento actual en un test para que el día que se cambie, avise.

---

## 9. Invariantes verificados por la suite

`backend/test/lib.test.js` convierte el criterio experto en regresión ejecutable: nadie puede tocar
`m`, el eje de contienda, los factores de acceso ni los atributos de un perfil sin que la suite
avise que el modelo dejó de coincidir con ese criterio.

| Invariante                  | Verificación                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **6 anclas de calibración** | \|media simulada − ancla\| **≤ 0,5 pp** (60.000 iteraciones, semilla `0x5eed`), cada una con su Nivel de Acceso (§6.1). Peor residuo medido: 0,15 pp con cuatro semillas |
| **2 anclas de validación**  | \|media simulada − ancla\| **≤ 2 pp** — no se ajustaron a nada, así que su residuo mide consistencia y no ajuste (§6.2)                                                  |
| **Tope de Resistencia**     | `buildContestTriangles` NO topa el triángulo de Resistencia en 100: su máximo es exactamente moda × 1,40 (§4)                                                            |
| **Reparto del año malo**    | Las contribuciones suman **exactamente** el `cvar95` del portafolio (< 1e−6), con y sin cascada declarada (§8.5)                                                         |
| **La cascada reubica**      | Declarar una dependencia no mueve el aporte **esperado** del hijo (< 5 %) — solo en qué años cae (§8.3, §8.5)                                                            |
| **Perfiles distinguibles**  | Empleado Desleal y Crimen Organizado tienen que dar números distintos: sin acceso, el insider queda ≥ 10 pp por debajo; con acceso operativo, queda a la par (± 5 pp)    |
| **Monotonía en defensa**    | Para cada atacante: más defensa nunca sube la Vulnerabilidad (tolerancia 0,05)                                                                                           |
| **Monotonía en atacante**   | Para cada defensa: oportunista ≤ vandalismo ≤ empleado desleal ≤ organizado ≤ estado-nación (tolerancia 0,05)                                                            |
| **Piso**                    | Ninguna combinación da 0 %; y el piso no infla el resultado (`< 2 %` en oportunista vs élite)                                                                            |
| **Eje de contienda**        | Reproduce exactamente sus nodos calibrados, y es monótono creciente en `[0, 100]` con paso 0,5                                                                           |

Las dos pruebas de monotonía cubren las **15 celdas que ningún ancla de calibración toca**: sin ellas, una
calibración podría acertar las 8 anclas y aun así producir absurdos en el resto de la grilla — que
es exactamente lo que pasaba con los ajustes de forma libre antes de restringir la monotonía del
eje.

### 9.1 Versionado de calibración

`CALIBRATION_VERSION = 7`. Se sube cada vez que cambie algo que mueva los números de una simulación:
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
| 6       | El **Empleado Desleal deja de ser indistinguible** del Crimen Organizado (§2.1, §6.1)        |
| 7       | Se quita el **tope de 100** del triángulo de Resistencia; recalibración completa (§4, §6.2)  |

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
- ~~**El tope de 100 se conserva a propósito.**~~ **Quitado en la calibración 7.** El diagnóstico de
  por qué era caro resultó exacto: rompía `organizado vs élite` (15,0 % → 13,7 %) y obligaba a
  **re-derivar `m`**, porque el tope estaba activo en una de las dos anclas que lo determinan y no
  en la otra. Fue una recalibración completa —`m` 6,8254 → 6,4073, los cinco nodos del eje y los
  tres factores α— y las seis anclas de calibración se volvieron a reproducir con residuo ≤ 0,15 pp.
  El análisis de sensibilidad había pronosticado que el cambio sería de bajo riesgo, y acertó.

---

## 10. Deslinde: Nash y la disuasión están FUERA de la ruta crítica

**El Equilibrio de Nash es un panel exploratorio "qué pasaría si". No participa —ni directa ni
indirectamente— en el cálculo de la Vulnerabilidad, el LEF, el ALE ni ninguna métrica del Registro.**

Hechos verificables en el código:

- `solveNashEquilibrium` se invoca desde **un único punto**: `POST /api/autocalc/nash-equilibrium`
  (`backend/src/routes/autocalc.js`), disparado por un botón explícito del usuario.
- `POST /api/simulate` **no lo importa ni lo llama**.
- El `m` del panel de Nash es un campo del formulario, **deliberadamente independiente** del
  `TULLOCK_M` calibrado. Nunca puede cambiar en silencio el resultado de la simulación real.
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

**El umbral de disuasión (§16.1) hereda este mismo deslinde, y por el mismo motivo.**
`stackelbergDeterrence.js` se invoca solo desde `POST /api/autocalc/deterrence`, disparado por un
botón; `POST /api/simulate` no lo importa. Depende de los pagos del atacante —cuánto le vale el
botín, cuánto le cuesta el operativo, cuánto consigue en otro lado— que **no se observan en ninguna
bitácora**: nunca vas a registrar al ladrón que miró la reja y se fue. Por eso esos tres valores son
entradas visibles y editables en pantalla, y el resultado declara cuál usó y si el usuario lo movió.
Escondidos, el panel sería una máquina de justificar cualquier inversión.

---

## 11. Registro de decisiones de modelado

Decisiones tomadas con su razón, para que quien retome esto no las revierta por desconocimiento.

| Decisión                                                 | Razón                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tullock sobre un eje calibrado, no `FA × (1 − ENC)`      | La segunda tiene techo estructural (`V ≤ FA`): estado-nación contra defensa básica quedaba topado en 66 % cuando debe rondar 98 %                           |
| `m` derivado, no ajustado                                | Dos anclas que comparten atacante cancelan el eje y lo determinan sin suposiciones                                                                          |
| Eje de contienda solo en el atacante                     | Validado fuera de muestra: la escala de defensa resultó consistente sin curva propia                                                                        |
| Acceso modula R, no C                                    | Describe lo que pasa: cuánto de tu defensa llega a interponerse. Sin el tope de 100 las dos rutas ya son exactamente equivalentes                           |
| La Resistencia no se topa en 100                         | Tullock compara una RAZÓN, no dos porcentajes; topar el lado alto subvaloraba la defensa fuerte en toda la grilla                                           |
| Acceso es del riesgo, no del perfil                      | El mismo insider tiene acceso distinto a cada activo                                                                                                        |
| Confianza no mueve la media                              | Es incertidumbre epistémica: habla del analista, no del atacante                                                                                            |
| La frecuencia baja con la capacidad                      | La mandan cuántos actores hay y qué tan indiscriminados son, no el empeño de cada uno                                                                       |
| Nash fuera de la ruta crítica                            | Sus insumos no son observables                                                                                                                              |
| Los riesgos viejos no se recalculan solos                | Sobrescribir una evaluación guardada destruye la trazabilidad                                                                                               |
| La pérdida del año es una SUMA de eventos                | `LEF × Magnitud` reparte fracciones de evento en todos los años; borra la variabilidad del conteo donde ésa _es_ todo el riesgo                             |
| El año malo se reparte por Euler, no por CVaR individual | El CVaR de cada riesgo ignora con quién coincide, y coincidir es exactamente lo que arma un mal año                                                         |
| La cascada explica ocurrencias, no las añade             | El TEF se estima de datos que ya incluyen las veces que un padre lo causó; sumarla encima las cuenta dos veces                                              |
| Adelgazar la cascada quita eventos, no escala            | Escalar la cifra del año inventa años que cuestan una fracción de incendio — la misma falacia que el modelo compuesto corrige                               |
| La LEC recalcula su probabilidad empíricamente           | Con empates, la etiqueta de la escalera miente; y esa curva alimenta el eje Y de la Matriz                                                                  |
| El residual guarda su receta, no solo su resultado       | Un número fija la media, nunca la forma: prevenir y contener dan la misma media y colas al triple                                                           |
| Cada ancla lleva su propio Nivel de Acceso               | Emitir la del insider sobre "acceso nulo" metía su acceso dentro de su fuerza, y lo volvía idéntico al crimen organizado                                    |
| Dos perfiles no pueden dar el mismo número               | La app ofrecía una elección que el cálculo ignoraba; y ponderar los atributos —la corrección obvia— no lo habría arreglado                                  |
| Un campo que no gobierna nada no se guarda               | El Horizonte Temporal se capturaba y se imprimía junto a cifras anuales sin entrar en ningún cálculo: un control que no hace nada enseña una creencia falsa |
| Una Oportunidad no tiene Perfil de Atacante              | Derivar su Probabilidad de Captura de la contienda de Tullock afirma que mientras mejor defendido estés, menos capturas tu propia oportunidad               |
| Las 9 magnitudes de una Oportunidad son positivas        | El motor las SUMA; una sola redactada como costo en que se incurre convertiría el Beneficio Anual Esperado en una mezcla de gastos y ganancias              |
| Se divide por la MODA de V, no por su media              | La moda cancela el sesgo de Jensen de dividir por una distribución; cambiarla por la media multiplica el error por hasta 13× (medido)                       |

---

## 12. La capa de distribuciones de probabilidad

Todo lo anterior descansa en cuatro distribuciones y un generador. Ninguna se eligió por costumbre:
cada una responde a una propiedad concreta del dato que representa, y las tres primeras conviven
porque **un estimado de tres puntos no significa lo mismo según qué esté estimando**.

Archivo: `backend/src/lib/random.js`.

### 12.1 Beta-PERT — para lo acotado (TEF y Vulnerabilidad)

La Vulnerabilidad llega aquí por **dos rutas** que producen lo mismo: si el riesgo tiene Perfil de
Atacante y Defensa, la PERT se abre sobre los triángulos de contienda (§5.2) y el resultado entra al
motor como sampler inyectado; si la Vulnerabilidad se capturó a mano, la PERT se abre directamente
sobre ese triángulo. El TEF siempre usa la segunda.

Un experto da tres números: mínimo `a`, más probable `m̂`, máximo `b`. La lectura ingenua es una
triangular, y sobre-estima los extremos: trata la moda como un punto más de una recta. PERT la
convierte en una **Beta reescalada** que concentra masa alrededor de la moda:

```
α = 1 + λ·(m̂ − a)/(b − a)          β = 1 + λ·(b − m̂)/(b − a)          λ = 4
X ~ Beta(α, β)
muestra = a + X·(b − a)
```

Con `λ = 4` (el valor estándar de PERT) la media queda:

```
E[X] = (a + 4·m̂ + b) / 6
```

o sea la moda pesa cuatro veces más que cada extremo. Subir `λ` concentra más; bajarlo se acerca a
la uniforme. La app lo deja fijo en 4 en todas partes.

**Cómo se muestrea la Beta**, sin funciones especiales: si `X ~ Gamma(α,1)` e `Y ~ Gamma(β,1)` son
independientes, entonces `X/(X+Y) ~ Beta(α,β)`. Las Gamma salen del método de **Marsaglia–Tsang
(2000)**, que necesita una normal y un uniforme por intento y acepta con probabilidad muy alta; para
`shape < 1` usa el truco estándar `Gamma(shape+1)·U^(1/shape)`. Las normales salen de **Box–Muller**
(se descarta la segunda de cada par, a propósito: mantiene el consumo del generador simple y
determinista, y desperdiciar una muestra por llamada no importa a esta escala).

**Consecuencia que el motor usa a propósito:** escalar `a`, `m̂` y `b` por una constante `k` deja
`α` y `β` **idénticos**, así que con el mismo generador la muestra resultante es exactamente `k`
veces la original. Eso es lo que hace que la simulación pareada del residual (§9.1.1) sea exacta y
no aproximada.

### 12.2 Triangular — solo como respaldo

Se conserva por dos motivos: es el respaldo cuando la lognormal no está definida (§12.3), y es la
referencia de la que se toma la **varianza objetivo** para ajustarla:

```
Var_△(a, m̂, b) = (a² + m̂² + b² − a·m̂ − a·b − m̂·b) / 18
```

Se muestrea por transformación inversa con `F = (m̂ − a)/(b − a)`.

### 12.3 Lognormal por igualación de momentos — para la Magnitud de Pérdida

Una pérdida no tiene techo. Triangular y PERT sí: prometen que `b` es imposible de superar, y eso
es falso justo donde más importa. Por eso la Magnitud se muestrea **lognormal**.

El problema es cómo pasar de tres puntos a `(μ, σ)` sin inventar información. La ruta habitual
—reinterpretar `a` y `b` como percentiles 5/95— infla la cola sin control, porque el usuario (o
`calculateLossMagnitudeRange`) los eligió pensando en un rango acotado, no en una promesa
estadística. AppFair ajusta **por momentos**, con dos condiciones:

1. la moda de la lognormal es exactamente `m̂`, lo que fija `μ = ln(m̂) + σ²`;
2. su varianza es la **misma** que la de la triangular con esos mismos tres puntos.

Sustituyendo (1) en la varianza de la lognormal `(e^{σ²} − 1)·e^{2μ+σ²}` queda una ecuación
trascendente en `s = σ²`:

```
m̂²·(e^s − 1)·e^{3s} = Var_△(a, m̂, b)
```

No tiene solución cerrada. Se resuelve por **bisección**: la función es monótona creciente en `s`
para `s > 0`, así que se dobla el límite superior hasta encontrar un cambio de signo y se bisecta
100 veces. Convergencia garantizada, sin Newton ni cotas mágicas.

Lo que esto preserva es importante: **el ancho de incertidumbre que el usuario quiso decir queda
intacto**; lo único que cambia es la forma — sesgo a la derecha y cola sin techo duro.

**Respaldos, ambos casos reales:**

| Condición | Qué se hace | Por qué                                                         |
| --------- | ----------- | --------------------------------------------------------------- |
| `a = b`   | constante   | No hay incertidumbre que muestrear                              |
| `m̂ ≤ 0`   | triangular  | La lognormal no está definida en 0 — categoría sin costo típico |

**Los parámetros se resuelven una sola vez por corrida**, no por muestra: la bisección es cara y
`(a, m̂, b)` no cambian dentro de una simulación. Medido: 18× más rápido, bit a bit idéntico. Dejó
de ser una optimización y pasó a ser un requisito con el modelo compuesto (§7.1), donde se sortea
una magnitud por **cada evento** del año en vez de una por año.

### 12.4 Poisson — el conteo de eventos del año

El modelo compuesto (§7.1) necesita "¿cuántas veces pasó este año?". Dos algoritmos, con un corte
en `λ = 30`:

| Régimen  | Método              | Cómo                                             |
| -------- | ------------------- | ------------------------------------------------ |
| `λ ≤ 30` | Knuth (exacto)      | Multiplica uniformes hasta bajar de `e^{−λ}`     |
| `λ > 30` | Aproximación normal | `max(0, round(λ + √λ · Z))`, `Z` normal estándar |

El corte no es arbitrario: Knuth cuesta `λ+1` llamadas al generador por muestra, y a `λ = 30` la
Poisson ya es prácticamente simétrica — el error relativo de la aproximación es de milésimas.

### 12.5 El generador: mulberry32 y la reproducibilidad

Todo el motor usa **mulberry32** sembrado, nunca `Math.random()`. La razón es auditoría: una
evaluación de riesgo que no se puede reproducir no se puede defender en un comité ni revisar seis
meses después.

De ahí salen tres decisiones que aparecen por todo el código:

- **Semillas derivadas por posición.** En el portafolio, el riesgo `i` usa `seed + i·7919` (primo).
  Con la misma semilla para todos, los riesgos quedarían perfectamente correlacionados por accidente
  y el beneficio de diversificación (§8.1) desaparecería sin que nadie lo notara.
- **Números aleatorios comunes.** Cuando se comparan dos escenarios (actual contra residual, con y
  sin tope de daño, una calibración contra otra), las dos corridas comparten semilla. Sin eso la
  resta mezcla el efecto real con ruido de muestreo — a 10.000 iteraciones el error estándar ronda
  el 0,6 %, suficiente para ensuciar un ahorro pequeño.
- **Consumo constante del generador.** Varias funciones sortean un número aunque no lo vayan a usar
  (ej. los candidatos a auto-inicio en §15), para que la secuencia no dependa de qué riesgos tengan
  datos completos. Sin eso, agregar un riesgo incompleto cambiaría los resultados de todos los demás.

El error estándar de la media se **reporta** (`standardErrorPercent`) pero nunca se usa como
criterio de parada: un corte dinámico haría que dos corridas con los mismos datos terminaran en
distinto `n` y dieran cifras distintas, que es exactamente lo que la semilla fija existe para evitar.

---

## 13. De número a decisión: cómo la app trata el riesgo

Las secciones anteriores producen una **distribución**. Ésta describe cómo esa distribución se
convierte en una decisión, que es donde el modelo se vuelve una herramienta de gestión y no un
ejercicio estadístico.

El principio que ordena todo: **la app nunca reduce un riesgo a un solo número.** El promedio sirve
para presupuestar; la cola sirve para sobrevivir. Son preguntas distintas y se responden por
separado, y en varios puntos la app clasifica por la cola aunque el promedio esté tranquilo.

### 13.1 Los Criterios de Riesgo

Toda clasificación se hace contra dos números que declara la organización (`backend/src/lib/riskCriteria.js`):

```
aleCritico            máxima pérdida anual que la organización acepta, en dinero
aleAceptablePercent   apetito de riesgo: qué % de esa cifra se está dispuesto a asumir sin actuar
```

De ahí se derivan los dos umbrales que de verdad se usan:

```
aleAceptable = aleCritico · aleAceptablePercent/100
aleMedio     = aleAceptable + (aleCritico − aleAceptable)/2
```

**Solo hay un ancla en dinero.** `aleAceptable` se deriva en vez de configurarse aparte para que no
pueda quedar por encima del crítico por un descuido. Un riesgo puede traer su propio override, y se
valida que sea **más restrictivo**, nunca más permisivo: "mi máximo global es $1M pero para este
riesgo es $2M" se contradice a sí mismo, porque el global ya es el techo absoluto.

### 13.2 Clasificación de una Amenaza

En este orden exacto (`evaluateFairThreat`):

| #   | Condición             | Nivel                               | Severidad |
| --- | --------------------- | ----------------------------------- | --------- |
| 1   | `ALE > aleCritico`    | Crítico — Requiere Acción Inmediata | crítico   |
| 2   | `CVaR₉₅ > aleCritico` | **Crítico (riesgo de cola)**        | crítico   |
| 3   | `ALE > aleMedio`      | Alto — Requiere Tratamiento         | alto      |
| 4   | `ALE > aleAceptable`  | Medio — Vigilar                     | medio     |
| 5   | resto                 | Aceptable                           | bajo      |

**La fila 2 es la que justifica todo el modelo.** Un riesgo cuyo promedio está tranquilo pero cuyo
peor 5 % de años supera el criterio crítico se clasifica como crítico igual. Ése es exactamente el
perfil raro-y-severo de la seguridad patrimonial —un asalto cada ocho años que se lleva el
inventario entero— y es el que un cálculo por valor esperado esconde. Sin esa fila, la app diría
"aceptable" de un riesgo que puede cerrar la empresa.

### 13.3 Oportunidades: los mismos umbrales, el significado invertido

Un riesgo tipo `oportunidad` usa las mismas cifras pero al revés: un valor esperado **alto** es
deseable. Se clasifica solo por la media (no hay "cola" que temer en un beneficio) en Significativa
/ Moderada / Menor. Y se **excluye** del Pareto, del mapa de calor y de Tratamiento: sumar un
beneficio a la "exposición total" o preguntarse cómo mitigarlo no tiene sentido.

**Sin adversario, por definición.** Una Oportunidad nunca deriva su Vulnerabilidad del Perfil de
Atacante: la casilla de "amenaza deliberada" se desmarca y se oculta, y la sección de perfiles no
aparece. La razón no es de presentación. La Vulnerabilidad de una amenaza sale de la Función de
Éxito de Contienda de Tullock (§5) entre la capacidad del atacante y tu fuerza de resistencia;
aplicarla a una Oportunidad afirmaría que **mientras mejor defendido estés, menos probable es que
captures tu propia oportunidad**. Aquí la Vulnerabilidad es la _Probabilidad de Captura_ y se
captura a mano, sin fórmula que la derive.

**Las 9 categorías cambian de signo, no solo de nombre.** El motor SUMA las 9 magnitudes para
formar la del evento, así que en una Oportunidad las 9 tienen que ser cantidades positivas o el
Beneficio Anual Esperado estaría sumando un gasto con ganancias. Las que no tienen lectura positiva
directa (respuesta, reemplazo, multas, investigación) se plantean como **costos evitados**, que sí
son un beneficio y sí se suman sin contradicción:

| #   | Amenaza                        | Oportunidad                      |
| --- | ------------------------------ | -------------------------------- |
| 1   | Pérdida de Productividad       | Productividad Ganada             |
| 2   | Costos de Respuesta            | Costos de Respuesta Evitados     |
| 3   | Costos de Reemplazo            | Costos de Reposición Evitados    |
| 4   | Multas y Sanciones             | Multas y Sanciones Evitadas      |
| 5   | Daño Reputacional              | Ganancia Reputacional            |
| 6   | Costos de Investigación        | Costos de Investigación Evitados |
| 7   | Negocio No Capturado           | Negocio Nuevo Capturado          |
| 8   | Impacto Comunitario/Societario | Beneficio Comunitario/Societario |
| 9   | Impacto Ambiental              | Beneficio Ambiental              |

Una categoría que no aplique se deja en 0 — el mismo mecanismo que la app ya usa para lo que no
viene al caso en una amenaza.

**Lo que sigue sin resolver.** `evaluateFairOpportunity` compara el beneficio contra `aleCritico`,
que es un umbral de **pérdida**. "Cuánto daño me dolería" y "cuánta ganancia justifica perseguir
algo" son cantidades distintas sin razón para coincidir, así que los tres niveles están anclados a
un número que significa otra cosa. Hace falta un umbral de beneficio propio en los Criterios de
Riesgo. Además, `severity` colapsa: "Oportunidad Significativa" y "Oportunidad Menor" devuelven las
dos `bajo`, y por eso las Oportunidades se excluyen de toda vista que agrupe por severidad.

### 13.4 La Matriz de Riesgos: dos ejes que no son el mismo número

```
eje X (impacto)       = min(100, ALE / aleCritico · 100)
eje Y (probabilidad)  = P(L > aleUmbralExcedencia), leída de la Curva de Excedencia
```

El eje Y **no sale del ALE**: depende de la distribución, no de su media. Dos riesgos con el mismo
ALE pueden estar en extremos opuestos del eje vertical, y ésa es justamente la información que una
matriz cualitativa de 5×5 pierde.

Las zonas (Bajo/Medio/Alto/Crítico) se derivan de las bandas configuradas, no de números fijos.

**El punto residual** (el verde al que apunta la flecha de migración) se calcula con `k = residualALE/ALE`:

| Caso              | Eje Y                                                      |
| ----------------- | ---------------------------------------------------------- |
| `k = 1` (Aceptar) | El valor ya guardado — para que caiga exacto sobre el rojo |
| `k = 0` (Evitar)  | 0 — no queda pérdida que pueda superar ningún umbral       |
| Mitigar con curva | La curva **real** del residual, re-simulada y persistida   |
| Mitigar sin curva | Respaldo: `P(actual > umbral/k)`                           |
| **Transferir**    | **No se dibuja punto**                                     |

Transferir se excluye a propósito: una póliza **trunca** la cola en vez de escalarla, así que se
conoce X pero no Y. Mover solo X afirmaría que la probabilidad de excedencia no cambió — justo lo
contrario de lo que hace un seguro. Mejor no dibujar nada que dibujar una mentira.

### 13.5 Riesgo Inherente: la línea de base sin controles

`calculateInherentRiskFromSimulation` corre el motor completo con `V ≡ 1` (100 %, sin ningún
control), 10.000 iteraciones, semilla fija propia. **No es una des-mitigación algebraica** del
resultado ya simulado: la versión anterior dividía el ALE entre la Vulnerabilidad media, lo cual
solo era válido cuando la Vulnerabilidad era lineal en el Nivel de Defensa. Con el modelo de
contienda dejó de serlo.

Eso da el waterfall **Inherente → Actual → Residual**: cuánto separan tus controles el "sin nada"
del "con lo que hay hoy", y cuánto más separa el tratamiento propuesto.

### 13.6 Pareto y priorización

Ordena por ALE descendente y acumula, para responder "cuántos riesgos concentran el 80 % de la
exposición". Es una lectura del **año promedio**. La lectura del **año malo** es otra y vive aparte
(§8.5) — los dos órdenes no coinciden, y confundirlos lleva a invertir en el riesgo equivocado.

---

## 14. Tratamiento: la matemática de las cuatro estrategias

Archivo: `backend/src/lib/treatment.js`. Las cuatro estrategias de ISO 31000 se evalúan en paralelo
como hipótesis comparables; la que se adopta se registra aparte (§9.1.1).

### 14.1 La fiabilidad es una probabilidad, no una advertencia

Cada estrategia declara una fiabilidad, que se traduce a probabilidad de éxito:

```
alta → 0,90        media → 0,70        baja → 0,40        nula → 0
```

Los tres primeros son una calibración inicial razonable, no un dato medido. **`nula` es distinto**:
no es el punto más bajo de esa escala sino un estado cualitativamente separado, y es el único valor
de la tabla que no necesita calibrarse. Baja/media/alta responden "¿qué tan probable es que
funcione?"; nula responde "esto no aplica a este peligro". El caso que lo motivó es una póliza de
Interrupción de Negocio Contingente frente a una pérdida sin daño físico directo: no es que sea
improbable que pague, es que está diseñada para no responder. Sin ese valor, la única forma de
expresarlo era `baja = 0,40`, que afirma un 40 % de éxito que nadie sostiene.

Con `p = 0` el beneficio neto queda en exactamente `−costo`, así que la estrategia aparece
estrictamente dominada por Aceptar. Ese es el resultado correcto: la herramienta tiene que poder
decir "no compres esto", no solo "esto es flojo".

El beneficio neto es entonces un **valor esperado** sobre un nodo de azar, no un número de un solo
punto:

```
E[beneficio] = p·(evitado − costo) + (1 − p)·(−costo) = p·evitado − costo
```

Si la estrategia falla, el costo se pagó igual y no se evitó nada — relativo a Aceptar, que es el
punto de comparación. Antes `reliability` solo disparaba un texto de advertencia; ahora entra al
cálculo.

`ROSI = (evitado − costo)/costo · 100` es ese mismo beneficio expresado como retorno.

### 14.2 Transferir: el seguro se aplica escenario por escenario

Lo que un deducible y un límite le hacen a una distribución **no** se puede representar con un
factor. Se aplica sobre **cada una** de las 10.000 pérdidas simuladas:

```
retenida(L) = L                    si L ≤ D
              L − pago(L)          si L > D

pago(L)     = min( (L − D)·c , C )   con tope C
              (L − D)·c              con cobertura ilimitada
```

donde `D` es el deducible, `C` el límite y `c ∈ [0,1]` la fracción de la que responde la
aseguradora (**coaseguro**, 1 por defecto). El ALE retenido es el promedio de eso. `C = 0` significa
literalmente **cero cobertura** por encima del deducible, no "sin límite" — para una póliza sin tope
hay que declararlo explícitamente.

El orden importa y es el de una póliza real: el coaseguro define **de cuánto responde** la
aseguradora, y el límite topa **lo que efectivamente desembolsa**.

**Por qué `c` es un parámetro y no se puede sustituir por ninguno de los otros dos.**

Contra la fiabilidad: son dos nodos distintos. La fiabilidad es un Bernoulli —la póliza responde y
paga lo que le toca, o no responde y te quedas con la pérdida completa—; `c` es estructura de
cobertura, donde la póliza **sí** responde y paga una fracción de cada pérdida. Codificar "paga el
25 % siempre" como fiabilidad 0,25 da la **misma media y una cola distinta**: medido sobre 200.000
escenarios lognormales, el ALE coincide dentro del 1 % y el CVaR₉₅ sale ~11 % más alto, porque
inventa años en que la póliza no pagó nada sobre una pérdida enorme en vez de años en que pagó poco
sobre todas. El CVaR es justo lo que alimenta los Criterios de Riesgo (§13) y la atribución de cola
(§8.5), así que el error sería invisible en el promedio y visible exactamente donde la app decide.

Contra el límite: un sub-límite de 3 M sobre una pérdida de 12 M paga el 25 %, pero sobre una de
4 M paga el 75 %. El coaseguro paga la misma fracción en toda la distribución. Coinciden en un
punto y difieren en el resto, así que hacen falta los dos.

De aquí sale una limitación que se propaga a toda la app: como esto es una **truncación** y no un
escalado, no existe ningún `k` que la represente. Por eso Transferir no tiene punto residual en la
Matriz (§13.4) ni se escala en el portafolio (§8.2).

**Y de aquí salía también un hueco operativo, ya cerrado.** El Registro persiste un histograma de
20 barras, no las pérdidas una por una. Fuera del wizard —o sea en toda la página de Tratamiento—
no había con qué aplicar el deducible escenario por escenario, así que Transferir se declaraba
**no calculable** y para cotizar una póliza había que volver al Análisis FAIR y re-simular el
riesgo entero.

Ahora la propia página de Tratamiento puede pedir esa corrida: `simulateForTransfer` en
`POST /api/treatment/evaluate` vuelve a correr Monte Carlo con el `tef`/`vuln`/`lossMagnitudes` y
la **semilla original** del riesgo, que es lo que parea las dos corridas y hace que la Pérdida
Evitada sea el efecto de la póliza y no el ruido de muestreo. Va detrás de un botón explícito y no
automático porque esa ruta se llama con debounce en cada tecla del formulario.

Con los escenarios en la mano aparece además el **CVaR residual de Transferir**, que antes no
existía. No es un descuido que faltara: a diferencia de Mitigar —donde el residual es la
distribución entera escalada por una constante, así que todas sus estadísticas escalan igual— una
póliza deja intactos los años baratos y corta los caros, de modo que el CVaR retenido **no se
puede derivar del ALE retenido**. Hay que sacarlo del arreglo. Verificado en la suite: con una
cola de 500.000 y deducible de 10.000 con cobertura ilimitada, el CVaR retenido es exactamente
10.000, y escalarlo proporcionalmente al ALE habría dado un número completamente distinto.

### 14.3 Mitigar + Transferir: inducción hacia atrás

La combinación no es "aplicar las dos y sumar los ahorros". Es un árbol de decisión de dos niveles
(`backend/src/lib/decisionTree.js`), resuelto por **inducción hacia atrás** (de las hojas a la raíz):

```
[azar] ¿Mitigar funciona?  p = p_mitigar
 ├─ sí  → residual = ALE_mitigado, pérdidas escaladas por k = ALE_mitigado/ALE
 └─ no  → residual = ALE actual, pérdidas sin escalar
          │
          └─ [decisión] ¿qué hago con lo que queda?
               ├─ aceptar    → valor = ALE − residual − costo_hundido
               └─ transferir → [azar] ¿la póliza responde?  p = p_transferir
                                ├─ sí → valor = ALE − retenida − costo − prima
                                └─ no → valor = aceptar − prima
```

Tres cosas que este árbol modela y una fórmula plana no:

1. **El costo de Mitigar ya está hundido** cuando se decide sobre el residual. Se resta en las dos
   ramas, funcione o no.
2. **El seguro se calcula sobre las pérdidas que de verdad quedarían en juego** en cada rama —
   escaladas si Mitigar funcionó, sin escalar si no. Un deducible fijo muerde distinto según eso.
3. **El nodo de decisión elige el máximo**, no promedia: si transferir el residual no conviene, el
   árbol se queda con aceptar, que es lo que haría una persona.

El motor de árboles valida que las probabilidades de cada nodo de azar sumen ≈ 1 y revienta con un
mensaje claro si no — un error de captura ahí daría un valor esperado incorrecto sin ningún aviso.

---

## 15. Simular Familia: la cascada de un riesgo y sus descendientes

Archivo: `backend/src/lib/cascadeSimulation.js`. Es distinta de la correlación del portafolio
(§8.3): aquí se elige **una raíz** y se simula la pérdida conjunta de ella y todos sus
descendientes, para responder "si esto pasa, ¿cuánto arrastra?".

Un riesgo que no es la raíz se activa en una iteración por **dos vías independientes**:

```
P_propia   = 1 − e^(−LEF_i)          ← "al menos un evento este año" (proceso de Poisson)
P_cascada  = probabilidad de la arista, por cada padre activo esa vuelta
combinada  = 1 − (1 − P_propia)·Π(1 − P_cascada_i)
```

**Las dos vías se evalúan en momentos distintos, y ahí está toda la corrección del modelo:**

- `P_propia` se tira **una sola vez por riesgo por iteración, ANTES** de recorrer la cascada. Los
  que salen sorteados entran al recorrido como puntos de partida adicionales, junto a la raíz.
- `P_cascada` se evalúa arista por arista **durante** el recorrido. Con varios padres, el hijo
  recibe un intento por cada padre activo; como cada intento es Bernoulli independiente, "se activó
  en cualquiera" ya da `1 − Π(1−p_i)` sin tocar el motor de recorrido.

> **Bug real que esto corrigió.** Antes `P_propia` se evaluaba _dentro_ del recorrido, en la misma
> compuerta que `P_cascada` — o sea, solo si el padre ya se había activado. La raíz siempre está
> activa, así que sus hijos directos quedaban bien, pero **de la segunda generación en adelante la
> frecuencia propia se perdía por completo** cuando el padre no ocurría. Medido: un nieto con ALE
> propio de $1.000.000/año aportaba ~$0 a la familia (activación del 0,005 % en vez del ~63 % que le
> corresponde por `1 − e^{−1}`). El error iba siempre hacia **subestimar** el riesgo, y era peor
> mientras más profundo el árbol.

> **Segundo bug real.** La raíz entraba al recorrido _siempre_, así que propagaba a sus hijos los
> 10.000 años, no solo aquellos en que de verdad ocurría. Con una raíz que ocurre el 56 % de los
> años y una compuerta del 70 %, el hijo recibía 0,70 activaciones/año en vez de 0,70 × 0,565 =
> 0,395 — un 77 % de más. Era además incoherente consigo mismo: la _pérdida_ de la raíz sí estaba
> escalada por su frecuencia.

**La magnitud del evento arrastrado.** Cuando un padre arrastra a un hijo, el hijo aporta la
magnitud de **un** evento, no su pérdida anual — la compuerta de cascada ya decidió "ocurrió este
año", y volver a multiplicar por su frecuencia la descontaría dos veces (§8.3, punto 4). Por eso el
motor sortea siempre la magnitud de un evento en cada iteración, **incluso en los años en que el
conteo de Poisson sale 0**: ese sorteo no entra en la pérdida anual propia del riesgo (ese año no
pasó nada por su cuenta), pero queda disponible como la magnitud representativa que la cascada
necesita si un padre lo arrastra.

El recorrido (`backend/src/lib/markov.js`) es un BFS por niveles con dos protecciones: cada estado
se activa **como máximo una vez por iteración** (un ciclo `A→B→A` en los datos no cuelga nada) y
`maxDepth = 20` como segunda barrera para cadenas genuinamente largas. Las probabilidades de salida
de un nodo **no** tienen que sumar 1: no son mutuamente excluyentes — que ocurra un hijo no impide
que ocurra otro.

---

## 16. Equilibrio de Nash: la matemática del panel exploratorio

El deslinde está en §10 — esto **no** participa de ninguna cifra del Registro. Aquí queda solo el
método, para completitud.

Dado un Valor en Juego `V` y un costo unitario de esfuerzo para cada lado, se busca el par `(a*, d*)`
donde ninguno mejora su resultado cambiando solo su propia jugada. Con `m` arbitrario **no hay
fórmula cerrada**, así que se resuelve por **iteración de mejor respuesta**: el atacante optimiza su
esfuerzo asumiendo fijo el de la defensa, luego la defensa hace lo propio, y así hasta que ninguno se
mueve. Cada optimización interna es una **búsqueda ternaria** (reduce el intervalo a un tercio por
paso).

**Limitación declarada, no escondida:** la búsqueda ternaria asume que cada ganancia es cóncava en el
propio esfuerzo. Es cierto para `m` moderado, pero la literatura documenta que valores altos de `m`
pueden romper esa concavidad — el equilibrio en estrategias puras puede no existir o ser inestable.
No se rechaza un `m` alto; si la iteración no converge se reporta `converged: false` en vez de
devolver un número con falsa certeza.

### 16.1 Disuasión: Stackelberg, no Nash

Nash asume que los dos juegan **a la vez y a ciegas**. En seguridad física eso no es cierto: el
defensor juega **primero y a la vista** — el atacante ve la barda, la custodia y la certificación
antes de decidir. Es un juego de líder-seguidor, y su concepto de solución es el **equilibrio de
Stackelberg**. La diferencia no es de notación: el líder hace estrictamente mejor que bajo Nash,
porque comprometerse visiblemente vale, y **esa ventaja de compromiso es la disuasión**.

Lo que agrega, y que el motor de simulación no puede dar por construcción: en §7 la frecuencia es un
dato fijo, así que subir las defensas baja `V` (cuántos lo logran) y deja `TEF` intacto (cuántos lo
intentan). Más defensa siempre es mejor, en línea recta, para siempre — el modelo **nunca puede
decir "con esto alcanza"**. La disuasión da un **umbral**, no una pendiente.

**El parámetro del que depende todo: la alternativa del atacante.** Ataca solo si lo mejor que puede
sacar acá supera lo que consigue en OTRO objetivo con el mismo esfuerzo. La disuasión no es una
propiedad de tus defensas, sino de tus defensas **relativa** a lo que el atacante puede hacer con su
tiempo. Se expresa como fracción del Valor en Juego y tiene un sugerido por perfil (alto para el
oportunista, que tiene mil objetivos; cero para el empleado desleal, que ya está adentro), **editable
y visible en pantalla**: es juicio declarado, no medición, y escondido convertiría el panel en una
máquina de justificar cualquier inversión.

**Dos motivos distintos para no atacar.** Al construir esto apareció un caso que rompe la afirmación
fácil ("al insider no lo disuade nada"): con un activo chico y un costo de intento alto, hasta un
atacante sin alternativas deja de atacar. Pero eso no es disuasión:

| Motivo        | Qué pasó                                                      | Durabilidad                                         |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| `alternativa` | Se fue a otro objetivo. Disuasión real.                       | Dura mientras el vecino siga siendo más barato      |
| `no-rentable` | No se fue a ningún lado; el botín dejó de cubrir el esfuerzo. | Se revierte si sube el valor o se afloja un control |

Por eso el resultado dice **cuál de los dos** es, y por eso la afirmación defendible sobre el
empleado desleal es la precisa: **a alternativa cero nunca aparece disuadido — a lo sumo desiste.**
Eso sí es invariante del modelo y está en las pruebas, junto con la monotonía del umbral respecto de
la alternativa (mejores alternativas ⇒ umbral más bajo) y la monotonía de la ganancia del atacante
respecto de la defensa.

**El umbral se resuelve, no se sortea.** La ganancia del atacante decrece de forma monótona con la
defensa, así que "el primer `d` que alcanza" está bien definido y se encuentra por **bisección**.
Buscarlo muestreando no funciona: es un punto en un continuo y tiene probabilidad cero de salir
sorteado — medido, un millón de pares al azar dio **cero** equilibrios.

**Monte Carlo va alrededor del solver, no en su lugar.** Lo incierto no es el umbral sino los
**pagos** (cuánto vale el botín, cuánto cuesta el operativo, cuánto consigue en otro lado). Cada
iteración sortea un mundo posible, **resuelve** el umbral exacto de ese mundo, y se repite. Lo que
sale no es un umbral sino una **distribución** de umbrales, que responde la pregunta que de verdad
se lleva a un comité: _"con $X, en el 78 % de los escenarios deja de convenirle"_ en vez de un número
único que se desarma al mover un supuesto.

**Deslinde, igual que Nash (§10):** exploratorio. No alimenta ninguna cifra del Registro. Y no está
validado — los pagos del atacante no se observan en ninguna bitácora, porque nunca vas a registrar al
ladrón que miró la reja y se fue.

---

### 16.2 Bitácora de Incidentes: lo único que puede contradecir al modelo

Todo lo que la app calcula sale de juicio experto y referencias del sector. Un prior **alimenta**
el cálculo; no puede demostrar que esté mal. La bitácora es el otro lado: datos propios, que sí
pueden falsear.

Hoy solo **captura y diagnostica**. No hay ponderación por credibilidad, ninguna cifra del Registro
cambia y nada se marca para recalibrar. Es el enchufe puesto antes de que llegue la corriente — se
construye antes de tener el primer cliente porque meterle captura de datos a una app ya desplegada
es mucho más caro que dejar el hueco listo.

#### Lo que la bitácora observa es LEF, no TEF

La distinción más fácil de arruinar, y la más cara. `TEF` son **intentos**/año; `LEF = TEF · V` son
**pérdidas**/año (§7.1-7.2). Una bitácora anota robos que **ocurrieron**: nadie registra al ladrón
que probó la puerta y se fue. Un conteo de bitácora es, por lo tanto, una observación de **LEF**.

Enchufarlo al TEF haría que el motor le volviera a aplicar la Vulnerabilidad y descontara las
defensas **dos veces** — a un robo consumado ya le fallaron las cámaras; restárselas otra vez es
contarlo dos veces:

| V modelada | LEF real | LEF que reportaría la app | Error           |
| ---------- | -------- | ------------------------- | --------------- |
| 60 %       | 0,40     | 0,240                     | subestima 1,7×  |
| 30 %       | 0,40     | 0,120                     | subestima 3,3×  |
| 6,9 %      | 0,40     | 0,028                     | subestima 14,5× |

Siempre hacia abajo, que es el lado en el que no se puede fallar, y **peor cuanto mejor modeladas
estén las defensas**. Por eso el día que se mezcle, la mezcla va a nivel LEF: el prior es `TEF · V`
(lo que la app ya calcula) y la evidencia entra tal cual. Tiene un efecto secundario que conviene
saber: para un riesgo con bitácora, el motor de Vulnerabilidad queda **puenteado**, porque un LEF
observado ya integra amenaza y defensa. No es un defecto — si sabés cuántos robos hubo, no hace
falta estimarlos. El motor sigue trabajando para los riesgos sin datos, que van a ser la mayoría.

#### Tres estados, no dos

| Estado      | Significa                                   | Se usa |
| ----------- | ------------------------------------------- | ------ |
| `sin_datos` | Nadie lo midió. Ausencia de evidencia.      | No     |
| `cero`      | Se revisó y no pasó. Evidencia de ausencia. | **Sí** |
| `conteo`    | Pasó N veces.                               | Sí     |

Tratar "no lo llené" como cero tiraría el riesgo al piso para todo lo que nadie midió, así que
`sin_datos` es el default y `cero` hay que declararlo a propósito. Un cero **por conteo** se rechaza
al validar: significaría lo mismo por otro camino, y después nadie sabría si se midió o se tecleó
por inercia.

#### Un cero no siempre dice lo mismo

La **regla de los tres** acota la tasa real a `3/n` con 95 % de confianza. Pero cuánto _informa_ ese
cero depende de lo que el modelo esperaba — `P(0 eventos) = e^{−LEF·n}`:

| LEF del modelo | P(0 en 5 años) | Qué significa el cero                   |
| -------------- | -------------- | --------------------------------------- |
| 1,20 /año      | 0,2 %          | Evidencia demoledora: el modelo exagera |
| 0,40 /año      | 13,5 %         | Débil                                   |
| 0,10 /año      | 61 %           | No dice nada                            |

O sea que **el cero es fuerte justo donde los eventos son frecuentes, y no dice nada de los raros y
catastróficos** — que son los que dominan la cola (§8.5). La interfaz muestra las dos cosas para que
un cero no invite a bajar el riesgo catastrófico por ausencia de evidencia.

#### La exposición vive con cada entrada

"4 incidentes" no significa nada sin "en cuánto", y el denominador no es el mismo para todos: robo
en carretera por viaje, incendio por bodega-año, remolque robado por noche-estacionado. Un solo
`viajes_anio` global terminaría escalando un incendio por viajes. Solo la unidad **años** es
directamente comparable contra un LEF anual; con cualquier otra el diagnóstico reporta la tasa en su
propia unidad y **se abstiene de comparar**, en vez de inventar el factor de conversión.

---

## 17. El modelo en una página

De un juicio experto a una decisión, con la sección donde vive cada paso:

```
Perfil de Atacante (5 atributos)          Perfil de Defensa (6 atributos)
        │ promedio                                │ promedio
        ▼                                         ▼
       FA ──[eje de contienda calibrado §3]──► C  ENC ──[× α del acceso §4]──► R_eff
                                               │        │
                                               └──┬─────┘
                            [triángulos PERT §5.2, escalada por persistencia §5.3]
                                                  ▼
                                    Tullock(C, R, m) + piso  ──►  V   §5
                                                  │
                    TEF ~ Beta-PERT §12.1 ────────┴──► LEF = TEF · V
                                                  │
                                        N ~ Poisson(LEF)          §12.4
                                                  │
                          M_j ~ lognormal §12.3   ▼
                                    L = Σ_{j=1..N} M_j            §7.1
                                                  │
                          ×10.000 iteraciones     ▼
                     distribución de pérdidas anuales
                          │            │            │
                        ALE        CVaR₉₅         curva de excedencia   §7.3
                          │            │            │
                          └────────────┴────────────┘
                                       ▼
                    clasificación contra Criterios de Riesgo   §13.2
                                       ▼
                    Tratamiento: 4 estrategias comparadas      §14
                                       ▼
                    Decisión adoptada + residual con receta    §9.1.1
                                       ▼
                    Portafolio: simulación conjunta            §8.2
                       + correlación por cascada               §8.3
                       + reparto del año malo (Euler)          §8.5
```

Y en paralelo, **sin tocar ninguna cifra de esa ruta** (§10):

```
   Panel exploratorio            Configuración
   ──────────────────            ─────────────
   Nash          §16     Procedencia por factor      §2.4  ─┐
   Disuasión     §16.1   Bitácora de Incidentes      §16.2 ─┤
   (Stackelberg)         Tabla de referencia (tools/) §7.2  ─┘
        │                                                   │
   responde "¿con cuánto              responden "¿sobre qué se
   alcanza?", que la ruta             apoya este número, y qué
   crítica no puede responder         lo podría contradecir?"
```

**Las siete afirmaciones que sostienen todo esto**, y dónde se prueba cada una:

| Afirmación                                                           | Prueba                      |
| -------------------------------------------------------------------- | --------------------------- |
| La Vulnerabilidad reproduce ocho juicios expertos independientes     | §6, §9                      |
| El error de un juicio no se amplifica ni contamina celdas ajenas     | `tools/anchor-sensitivity/` |
| La pérdida del año es una suma de eventos, no una fracción de evento | §7.1                        |
| Sumar colas de riesgos sobrestima; hay que simularlos juntos         | §8.1, §8.2                  |
| El reparto del año malo suma exactamente el año malo                 | §8.5, §9                    |
| El motor pega tantas veces como su propio LEF promete                | §7.3, §9                    |
| A quien no tiene adónde ir no lo disuade ninguna inversión           | §16.1, §9                   |

**Y las tres cosas que el modelo NO afirma**, dichas aquí para que nadie las asuma:

1. **No es predicción.** Es una descripción de incertidumbre bajo supuestos declarados. Si los
   supuestos cambian, el número cambia — por eso cada resultado va sellado con su versión de
   calibración (§9.1) y nada se recalcula solo.
2. **No está validado contra datos reales, y el contador lo dice.** Las ocho anclas son juicio
   experto, seis de ellas con **cero grados de libertad** (§6.4): reproducirlas es aritmética, no
   evidencia. El modelo está probado de forma **interna** (coherencia, monotonía, sensibilidad), no
   **externa**. Lo único que puede contradecirlo es un histórico real, y para eso ya existe el
   enchufe —la Bitácora de Incidentes (§16.2), con su diagnóstico contra el LEF— pero **mientras su
   contador `comparables` valga 0, ninguna cifra de esta app ha sido contrastada contra la
   realidad ni una sola vez**. Las tablas de `tools/referencia-sector/` no cambian eso: son un
   prior del sector con `Z = 0` declarado, y un prior alimenta el cálculo pero no puede falsearlo.
3. **No lo prescribe ninguna norma.** ISO 31000, ISO 28000 y ASIS aportan el marco de proceso. Estas
   fórmulas son metodología propia de AppFair, y así debe citarse.

### 17.1 Qué haría falta para que el punto 2 dejara de ser cierto

En orden de cuánto mueven la aguja, y ninguno depende de escribir más código:

| Falta                                            | Desbloquea                                             | Por qué importa                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Bitácora propia** con fecha, tipo y exposición | Validación (§16.2) y la mezcla por credibilidad        | Es lo único que puede contradecir al modelo. Incluye los ceros: "cero robos de carga en 6 años" es un dato, y de los que más bajan un TEF |
| **Viajes al año** de la operación                | Convertir las tasas por viaje del sector a eventos/año | Sin el denominador, una tasa por viaje abarca un rango de 8×                                                                              |
| **Factores de escala** al activo propio          | Las colas catastróficas de referencia                  | Las citadas van de \$90 M a \$4,15 mil M; no son trasladables sin ese factor                                                              |

Cuando llegue lo primero, la mezcla va a nivel **LEF y no TEF** (§16.2): el prior es `TEF · V` —lo
que la app ya calcula— y la evidencia entra tal cual. Queda escrito acá para que no se decida
distinto por olvido; el error en la otra dirección subestima hasta 14×, siempre hacia abajo.
