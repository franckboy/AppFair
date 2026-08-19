#!/bin/bash
# SessionStart — prepara el checkout y las dependencias de una sesión remota.
#
# POR QUÉ EXISTE. En Claude Code on the web el contenedor es efímero: se recupera tras un rato de
# inactividad y su sistema de archivos vuelve desde una INSTANTÁNEA, no desde un clon nuevo.
# Evidencia medida en este repo: el contenedor arrancó a las 13:44 de hoy, pero .git/HEAD, el
# índice y el reflog traían fecha del 2026-08-13 04:11, y node_modules del 2026-08-12. O sea el
# checkout retrocede SIEMPRE al mismo commit (el de la instantánea) mientras el remoto sigue
# adelantado. No se pierde nada que esté empujado — pero cada sesión arranca en el pasado, y
# descubrirlo cuesta una vuelta entera.
#
# Este hook lo detecta y lo corrige antes de que la sesión empiece.
#
# REGLA DE ORO: nunca destruir trabajo. Solo avanza si el árbol está LIMPIO y si el commit local
# es ANTECESOR del remoto (o sea, un avance rápido puro). Cualquier otra situación —cambios sin
# commitear, commits locales que el remoto no tiene, ramas divergentes— se REPORTA y se deja
# intacta, para que una persona decida.
set -euo pipefail

# Solo en el entorno remoto: en una máquina local el checkout es del usuario y no se toca.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

echo "── SessionStart ──"

# ---------------------------------------------------------------------------------------------
# 1. Sincronizar el checkout con el remoto (si y solo si es seguro)
# ---------------------------------------------------------------------------------------------
rama="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"

if [ -z "$rama" ] || [ "$rama" = "HEAD" ]; then
    echo "  git: sin rama activa (HEAD suelto) — no se toca."
elif ! git fetch origin --prune --quiet 2>/dev/null; then
    echo "  git: no se pudo contactar al remoto — se sigue con lo que hay en disco."
elif ! git rev-parse --verify --quiet "origin/$rama" >/dev/null; then
    echo "  git: '$rama' no existe en el remoto todavía — no se toca."
else
    local_sha="$(git rev-parse HEAD)"
    remoto_sha="$(git rev-parse "origin/$rama")"

    if [ "$local_sha" = "$remoto_sha" ]; then
        echo "  git: '$rama' ya está al día con el remoto."
    elif [ -n "$(git status --porcelain)" ]; then
        # Hay trabajo sin commitear. Aunque el remoto vaya adelante, tocar el checkout aquí
        # podría borrarlo — se avisa y se deja como está.
        echo "  ⚠ git: '$rama' difiere del remoto, pero hay cambios SIN COMMITEAR."
        echo "     No se sincroniza nada. Revisa 'git status' antes de seguir."
    elif git merge-base --is-ancestor "$local_sha" "$remoto_sha"; then
        # Avance rápido puro: el local es un antecesor del remoto. Es exactamente la firma de la
        # instantánea vieja, y es seguro porque no hay nada local que el remoto no tenga.
        atras="$(git rev-list --count "$local_sha..$remoto_sha")"
        git reset --hard "origin/$rama" --quiet
        echo "  ✓ git: '$rama' venía $atras commit(s) atrás (instantánea del contenedor)."
        echo "     Sincronizado con el remoto: $(git log --oneline -1)"
    else
        echo "  ⚠ git: '$rama' tiene commits que el remoto no tiene (o divergió)."
        echo "     No se sincroniza nada. Local: ${local_sha:0:7}  Remoto: ${remoto_sha:0:7}"
    fi
fi

# ---------------------------------------------------------------------------------------------
# 2. Dependencias
# ---------------------------------------------------------------------------------------------
# `npm install` y no `npm ci`: el estado del contenedor se cachea después del hook, así que la
# instalación incremental aprovecha lo que ya está y no borra node_modules para volver a bajarlo.
for proyecto in backend frontend; do
    if [ -f "$proyecto/package.json" ]; then
        echo "  npm install ($proyecto)…"
        (cd "$proyecto" && npm install --no-audit --no-fund --loglevel=error)
    fi
done

# El navegador de Playwright viene preinstalado en la imagen remota (PLAYWRIGHT_BROWSERS_PATH);
# no se descarga nada aquí a propósito.
echo "── listo ──"
