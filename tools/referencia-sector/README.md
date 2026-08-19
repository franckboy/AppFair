# Tabla de referencia del sector (transporte de carga MX-US)

Datos de referencia externos para una operación de 120 unidades, 3 bodegas, 1 cross-dock y 450
empleados en el corredor MX-US, con certificación CTPAT y OEA.

**Esto es un prior, no una validación.** Ninguna de las 20 entradas viene de la bitácora de la
empresa: las 20 citan terceros (CargoNet, CBP, FBI, NFPA, Europol, cámaras empresariales, prensa).
Por eso `Z_credibilidad: 0` está declarado en el archivo mismo. Un prior alimenta al modelo; solo
un dato propio puede **contradecirlo**. Mientras no haya bitácora, nada de acá valida nada.

No toca la app. No hay endpoint, ni botón, ni import desde `backend/` o `frontend/`. Es un archivo
de datos con su verificador.

## Uso

```bash
node tools/referencia-sector/reportar.js
```

Imprime qué se puede usar, qué está en cuarentena y por qué, y **sale con código 1** si el archivo
se contradice. No requiere dependencias ni que el backend esté corriendo.

## Qué hay adentro

| Bucket | Entradas | Estado |
|---|---|---|
| `anclas_magnitud` | 6 | **Usables.** Triángulo min/moda/max completo, sin censura, sin escalar. |
| `tasas_por_viaje` | 1 | Cuarentena: falta `viajes_anio`. |
| `colas_referencia_sector` | 4 | Cuarentena: falta el factor de escala al activo propio. |
| `cotas_censuradas` | 5 | Cuarentena: el motor no sabe leer cotas. |
| `ratios_recuperacion_seguro` | 4 | Ver abajo — no son magnitudes, son evidencia sobre Transferir. |

### Por qué la cuarentena es código y no una nota

Una nota que diga "ojo, no uses estas" se pierde en cuanto alguien copia y pega. `reportar.js`
falla si una entrada en cuarentena queda marcada `usable`, si un ratio no cierra contra sus
montos, si una cota censurada se cuela a `anclas_magnitud`, o si una entrada apunta a un riesgo
que el manifiesto no declara. Esa última guarda es la que habría cazado la colisión de R182 (ver
abajo) el día que se introdujo.

### Linajes compartidos

`reportar.js` agrupa las anclas por `linaje`, no por `fuente`. REF10 (Forbes/TruckingInfo) y REF15
(FBI/CargoNet) citan **el mismo linaje**: CargoNet. Dos medios republicando el mismo reporte anual
no son dos confirmaciones. La convergencia real de la magnitud de R001 es entre CargoNet (~275-316
k) y las cámaras empresariales mexicanas (280 k) — dos linajes a 2 % de distancia, no tres.

## Correcciones aplicadas al bloque original

Están declaradas en `correcciones_aplicadas` dentro del JSON, con su porqué. La de fondo:

**REF11 apuntaba a R182.** La matriz v4.0 define R182 como *"Sismo o evento geológico mayor"*
(perfil `null`, ISO 22301, TEF 0,03) — un peligro natural, sin atacante. REF11 es contaminación
narco en puerto, que sí lo tiene. En la versión anterior del bloque, REF11 traía
`risk_ids: ["R057","R182"]`; al podar a un solo id se conservó el segundo, mientras que los otros
cuatro pares (REF02, REF05, REF09, REF15) conservaron el primero. REF11 ahora apunta a **R057**, y
R182 salió del manifiesto porque ninguna entrada le apunta ya.

R038 también salió del manifiesto: existe completo en la matriz, pero este bloque no tiene ninguna
entrada de dato sobre él (la magnitud de REF10 es robo de carga, no secuestro de operador).

## Las dos cosas que los ratios de seguro NO son lo mismo

Los cuatro `ratios_recuperacion_seguro` parecen una sola escala de 0 a 1. No lo son, y mezclarlos
calibra mal:

| | ¿Respondió la póliza? | ¿Cuánto pagó? |
|---|---|---|
| LR03 | sí | 100 % |
| LR04 | **sí** | **25 %** (exclusiones de RC) |
| LR05 | sí | 100 % |
| LR09 | **no** (CBI sin daño físico) | 0 % |

La primera columna es **fiabilidad**: el nodo Bernoulli de Transferir en
`backend/src/lib/treatment.js`, que solo tiene dos ramas — la póliza responde y paga lo que le
toca, o no responde y te quedas con la pérdida completa menos la prima. La segunda columna es
**estructura de cobertura**: deducible, límite y coaseguro, que `calculateInsuranceRetainedALE`
aplica escenario por escenario.

Meter el 0,25 de LR04 en la fiabilidad deja **el ALE correcto y la cola inflada ~11 %**, porque
inventa años en que la póliza no pagó nada sobre una pérdida enorme, en vez de años en que pagó
poco sobre todas. La media coincide; el CVaR95 no. Y el CVaR es lo que alimenta los Criterios de
Riesgo y la atribución de cola.

Bajo la pregunta correcta —¿respondió?— son 1 negativa en 4 eventos (3 si LR03 y LR04 son el mismo
incendio de $12 M visto por dos pólizas, cosa que sus montos brutos idénticos sugieren). Eso da
p ≈ 0,67-0,75, que cae sobre la banda `media: 0,70` que la app ya usa: **los datos no piden bajar
el piso**. Piden que el 0 sea alcanzable, porque LR09 no es un punto bajo de una escala sino un
peligro que la póliza excluye por diseño.

## Qué falta para levantar la cuarentena

Declarado en `faltantes_bloqueantes`. En orden de cuánto mueven la aguja:

1. **`bitacora_propia`** — incidentes propios con fecha, tipo y exposición. Es lo único que puede
   contradecir al modelo. Incluye los ceros: "cero robos de carga completa en 6 años" es un dato, y
   de los que más bajan un TEF.
2. **`viajes_anio`** — viajes al año de la flota. Sin él, la tasa de REF13a (12-18 por cada 1.000
   viajes) abarca de 45 a 360 eventos/año: 8× de punta a punta.
3. **`factores_de_escala`** — relación entre el activo de la referencia y el propio. Las colas
   citadas van de $90 M a $4,15 mil M; sin factor no son trasladables a esta operación.

`REF07` ya trae su factor resuelto en 0: es un near-miss (evento evitado, pérdida propia ~0). Su
valor está en el **denominador de la frecuencia** — exposición sin pérdida — no en el numerador de
la magnitud, y por eso nunca debe entrar a un ajuste de magnitud.

## Por qué `p_denuncia` es metadato y no entra al cálculo

REF13a trae una tasa de 0,015 eventos por viaje y un `p_denuncia` de 0,03. Componerlos daría
**0,50 eventos por viaje** — la mitad de los viajes sufriendo el evento, que no es una empresa sino
una liquidación. Los 12-18 por mil ya son la tasa; el 0,03 mide denuncia formal ante fiscalía, que
es otra cosa. `reportar.js` recalcula esa composición y la imprime como recordatorio de por qué el
campo está fuera de la verosimilitud.
