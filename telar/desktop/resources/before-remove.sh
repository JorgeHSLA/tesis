#!/bin/sh
# before-remove.sh — hook de desinstalación del .deb (electron-spec.md §6.2).
#
# electron-builder no tiene un campo con nombre propio para esto (su interfaz
# LinuxTargetSpecificOptions solo declara afterInstall/afterRemove); se pasa
# vía la lista cruda `deb.fpm: ["--before-remove=..."]`, que fpm traduce al
# script prerm de dpkg. prerm corre ANTES de borrar los archivos del paquete
# —al revés que postrm/afterRemove—, así que /opt/Telar/resources/compose/
# compose.yaml TODAVÍA existe cuando este script se ejecuta.
#
# dpkg llama a este script con "remove" en una desinstalación real, y con
# "upgrade <version-nueva>" cuando se instala una versión nueva ENCIMA de esta
# (`apt install ./telar-desktop_X.Y.Z_amd64.deb` con el paquete ya presente).
# Sin distinguir los dos casos, cada actualización pararía y borraría los
# contenedores e imágenes que la versión nueva necesita segundos después.
set -e

if [ "$1" = "remove" ]; then
  if command -v docker >/dev/null 2>&1; then
    # --profile build: el servicio 'runner' vive tras ese perfil (nunca corre
    # como servicio; ver ipc-docker.ts) y sin la bandera `down` ni lo
    # considera, dejando su imagen huérfana. --rmi all borra las imágenes de
    # los DOS servicios. Deliberadamente SIN -v: los volúmenes (telar_data
    # con el progreso de quizzes, telar_submissions) no se tocan.
    docker compose --profile build \
      -f /opt/Telar/resources/compose/compose.yaml \
      down --rmi all 2>/dev/null || true
  fi
fi

# Un prerm que termina distinto de 0 deja el paquete en un estado roto
# (half-configured) y puede bloquear futuras operaciones de apt/dpkg: nunca
# se debe fallar la desinstalación por un problema al hablar con Docker.
exit 0
