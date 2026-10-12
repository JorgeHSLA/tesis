#!/bin/sh
# before-install.sh — preinst del .deb: una instalación nueva arranca de cero.
#
# Se pasa igual que before-remove.sh, como flag crudo de fpm
# (`--before-install=...`), que lo traduce al script preinst de dpkg.
#
# dpkg lo llama con "install" cuando el paquete no está instalado y con
# "upgrade <version-vieja>" cuando se instala encima de otra versión. Solo en
# el primer caso se borra ~/.config/Telar de cada usuario: los paquetes
# ≤1.0.8 no la borraban al desinstalar, y sin ella fresh-install.ts ve una
# instalación nueva y limpia los datos Docker (progreso, cursos, ejecuciones)
# en la primera apertura. Actualizar nunca borra nada.

if [ "$1" = "install" ]; then
  for home in /home/* /root; do
    rm -rf "$home/.config/Telar" 2>/dev/null || true
  done
fi

# Un preinst que falla aborta la instalación: nunca por esto.
exit 0
