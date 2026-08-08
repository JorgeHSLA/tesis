#!/usr/bin/env bash
#
# D6 — regenera el juego de iconos de marca desde el SVG.
#
# El logotipo es el monograma de UNA LETRA sobre el naranja de marca. Al pasar
# de E-HPC a Telar cambia de `E` a `T`. Eso NO es un cambio de marca para el
# neutralizador de T1 (ninguna de las dos letras es una grafía de marca), por
# eso los 10 ficheros de icono están declarados como cambio de forma AUTORIZADO
# en `brand-invariance.py`. Cámbialos aquí y en ningún otro sitio.
#
# Fuente de verdad: frontend/public/favicon.svg. Todo lo demás se deriva.
#
# Uso:
#   bash regen-brand-icons.sh <raíz-del-repo>          # e-hpc/ o telar/
#   bash regen-brand-icons.sh <raíz> --check           # solo comprueba tooling
#
# NO commitea nada: deja los ficheros listos para que los revises.
set -euo pipefail

ROOT="${1:?uso: regen-brand-icons.sh <raíz-del-repo> [--check]}"
CHECK_ONLY="${2:-}"

SVG="$ROOT/frontend/public/favicon.svg"
ICONS_DIR="$ROOT/desktop/resources/icons"
ICO="$ROOT/desktop/resources/icon.ico"
SIZES=(16 24 32 48 64 128 256 512)

# ── Rasterizador ─────────────────────────────────────────────────────────────
# Ninguno viene de serie en este WSL2: hay que instalar uno. Se prueban por
# orden de fiabilidad para SVG con texto (librsvg respeta mejor las fuentes).
RASTER=""
if command -v rsvg-convert >/dev/null 2>&1; then RASTER=rsvg
elif command -v magick        >/dev/null 2>&1; then RASTER=magick
elif command -v convert       >/dev/null 2>&1; then RASTER=convert
elif command -v inkscape      >/dev/null 2>&1; then RASTER=inkscape
fi

if [[ -z "$RASTER" ]]; then
  cat >&2 <<'EOF'
No hay ningún rasterizador de SVG en el PATH. Instala UNO de estos:

  sudo apt-get install librsvg2-bin      # rsvg-convert — el que mejor respeta el texto
  sudo apt-get install imagemagick       # magick / convert
  sudo apt-get install inkscape          # el más pesado

Para el .ico hace falta además imagemagick (o icotool de icoutils).

Alternativa sin instalar nada a nivel de sistema, con el Node 22 del proyecto:
  export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
  npx -y sharp-cli -i favicon.svg -o 512x512.png resize 512 512
(ojo: sharp rasteriza el texto del SVG con las fuentes del sistema; comprueba
el resultado a ojo antes de darlo por bueno.)
EOF
  exit 1
fi

echo "rasterizador: $RASTER"
[[ "$CHECK_ONLY" == "--check" ]] && { echo "tooling OK"; exit 0; }

[[ -f "$SVG" ]] || { echo "no encuentro $SVG" >&2; exit 1; }

# El monograma debe estar YA cambiado en el SVG: este script no edita la letra,
# solo propaga. Así la decisión de diseño vive en un sitio y no en un sed.
if grep -q '>E</text>' "$SVG"; then
  echo "AVISO: $SVG todavía lleva el monograma 'E'." >&2
  echo "       Cámbialo primero (es la fuente de verdad) y vuelve a ejecutar." >&2
  exit 1
fi

mkdir -p "$ICONS_DIR"

png_from_svg() {  # png_from_svg <size> <destino>
  local size="$1" out="$2"
  case "$RASTER" in
    rsvg)     rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out" ;;
    magick)   magick -background none -density 384 "$SVG" -resize "${size}x${size}" "$out" ;;
    convert)  convert -background none -density 384 "$SVG" -resize "${size}x${size}" "$out" ;;
    inkscape) inkscape "$SVG" --export-type=png --export-filename="$out" \
                       --export-width="$size" --export-height="$size" >/dev/null ;;
  esac
}

for s in "${SIZES[@]}"; do
  png_from_svg "$s" "$ICONS_DIR/${s}x${s}.png"
  echo "  · ${s}x${s}.png"
done

# icon.png es el que electron-builder usa como fuente genérica: el más grande.
cp "$ICONS_DIR/512x512.png" "$ICONS_DIR/icon.png"
echo "  · icon.png (copia del 512)"

# .ico multi-resolución para Windows (electron-builder.yml:26).
if command -v magick >/dev/null 2>&1; then
  magick "$ICONS_DIR/16x16.png" "$ICONS_DIR/32x32.png" "$ICONS_DIR/48x48.png" \
         "$ICONS_DIR/64x64.png" "$ICONS_DIR/128x128.png" "$ICONS_DIR/256x256.png" "$ICO"
  echo "  · icon.ico (multi-resolución)"
elif command -v convert >/dev/null 2>&1; then
  convert "$ICONS_DIR/16x16.png" "$ICONS_DIR/32x32.png" "$ICONS_DIR/48x48.png" \
          "$ICONS_DIR/64x64.png" "$ICONS_DIR/128x128.png" "$ICONS_DIR/256x256.png" "$ICO"
  echo "  · icon.ico (multi-resolución)"
else
  echo "AVISO: sin imagemagick no se regenera $ICO — el instalador de Windows" >&2
  echo "       seguiría llevando el icono viejo. Instálalo o genera el .ico a mano." >&2
fi

cat <<EOF

Hecho. Ahora:
  1. Míralos: los tamaños pequeños (16, 24) son donde una letra se empasta.
  2. T1 los reportará como "cambio de forma AUTORIZADO" (D6), no como fallo.
  3. Van en el commit de C1, junto al monograma de Sidebar.tsx y favicon.svg.
EOF
