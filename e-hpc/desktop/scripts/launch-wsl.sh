#!/usr/bin/env bash
# launch-wsl.sh — abre E-HPC (shell Electron) dentro de WSL desde el acceso
# directo del escritorio de Windows. El render por CPU ya va en main.ts
# (app.disableHardwareAcceleration), así que la ventana se pinta bien vía WSLg,
# tenga GPU o no. No aborta ante errores no fatales: prioriza abrir la ventana.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"        # .../e-hpc/desktop
EHPC_DIR="$(dirname "$DESKTOP_DIR")"          # .../e-hpc  (aquí vive compose.yaml)

# Display de WSLg (por si el atajo arranca sin heredarlas): sin esto Electron
# no encontraría el servidor gráfico y no abriría ventana.
export DISPLAY="${DISPLAY:-:0}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

# Node 22 vía nvm (v18 rompe electron/vite).
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# 1) Asegurar el backend en :8000 (Electron le habla directo).
if curl -sf -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "[E-HPC] Backend ya está arriba en :8000."
else
  echo "[E-HPC] Levantando backend con Docker (la 1ª vez puede tardar unos minutos)…"
  ( cd "$EHPC_DIR" && docker compose up -d backend )
  for _ in $(seq 1 60); do
    if curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1; then
      echo "[E-HPC] Backend listo."
      break
    fi
    sleep 1
  done
fi

# 2) Abrir la ventana de Electron (modo dev: vite + esbuild + electron).
echo "[E-HPC] Abriendo la aplicación… (cierra esta ventana o la de la app para salir)"
cd "$DESKTOP_DIR"
exec npm run dev
