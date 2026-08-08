#!/usr/bin/env bash
# launch-wsl.sh — abre Telar (shell Electron) dentro de WSL desde el acceso
# directo del escritorio de Windows. El render por CPU ya va en main.ts
# (app.disableHardwareAcceleration), así que la ventana se pinta bien vía WSLg,
# tenga GPU o no. No aborta ante errores no fatales: prioriza abrir la ventana.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"        # .../e-hpc/desktop
TELAR_DIR="$(dirname "$DESKTOP_DIR")"          # .../e-hpc  (aquí vive compose.yaml)

# Display de WSLg (por si el atajo arranca sin heredarlas): sin esto Electron
# no encontraría el servidor gráfico y no abriría ventana.
export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

# Node 22 vía nvm (v18 rompe electron/vite).
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# ¿Modo autoría? `--admin`/`admin` como 1er argumento enciende el admin. Requiere
# LAS DOS cosas: backend con TELAR_ADMIN_MODE=1 (habilita /api/v1/admin/*) y vite
# dev con VITE_ADMIN=1 (incluye la UI de autoría). Por defecto, estudiante.
ADMIN=0
case "${1:-}" in
  --admin|admin) ADMIN=1 ;;
esac
export TELAR_ADMIN_MODE="$ADMIN"
if [ "$ADMIN" = 1 ]; then MODE_LABEL="AUTORÍA (admin)"; else MODE_LABEL="estudiante"; fi
echo "[Telar] Modo: $MODE_LABEL"

# 1) Asegurar el backend en :8000 (Electron le habla directo). `up -d` es
#    declarativo: recrea el contenedor si cambió TELAR_ADMIN_MODE (alternar
#    estudiante⇄admin). En modo admin, además, RECONSTRUIMOS la imagen
#    (`--build`): así el backend toma el código más reciente y nunca se sirve
#    una imagen vieja tras editar el backend (el bug de la sesión anterior).
echo "[Telar] Asegurando backend con Docker (la 1ª vez puede tardar unos minutos)…"
if [ "$ADMIN" = 1 ]; then
  # TELAR_ADMIN_BUILD=1 (Nivel 3): el rebuild admin CONSTRUYE la imagen que SÍ
  # incluye el código admin (router /admin + motor de escritura). Sin este arg,
  # `--build` daría la imagen estudiante (sin código admin) y /api/v1/admin/*
  # respondería 404 aunque TELAR_ADMIN_MODE=1.
  ( cd "$TELAR_DIR" && TELAR_ADMIN_BUILD=1 TELAR_ADMIN_MODE=1 docker compose up -d --build backend )
else
  # Estudiante: TELAR_ADMIN_BUILD=0 + --build ⇒ CONSTRUYE la imagen estudiante
  # (sin código admin). Sin --build, `up -d` reutilizaría una imagen cacheada
  # que podría ser la ADMIN (de un `telar --admin` previo) → no sería el
  # artefacto estudiante. Con --build siempre se materializa el build correcto.
  ( cd "$TELAR_DIR" && TELAR_ADMIN_BUILD=0 TELAR_ADMIN_MODE=0 docker compose up -d --build backend )
fi
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "[Telar] Backend listo."
    break
  fi
  sleep 1
done

# 2) Abrir la ventana de Electron (modo dev: vite + esbuild + electron).
#    VITE_ADMIN=1 hace que el vite dev incluya la UI de autoría (build admin).
echo "[Telar] Abriendo la aplicación… (cierra esta ventana o la de la app para salir)"
cd "$DESKTOP_DIR"
if [ "$ADMIN" = 1 ]; then
  exec env VITE_ADMIN=1 npm run dev
else
  exec npm run dev
fi
