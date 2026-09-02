; installer.nsh — hook de desinstalación (electron-spec.md §6.2).
;
; `customUnInstall` es un macro que electron-builder inserta al PRINCIPIO de
; la sección de desinstalación, ANTES de borrar ningún archivo (confirmado
; leyendo su plantilla: packages/app-builder-lib/templates/nsis/uninstaller.nsh,
; la sección "un.${UNINSTALL_SECTION_NAME}" inserta customUnInstall en la
; línea 156, y el borrado de archivos empieza en la 161). Por eso
; "$INSTDIR\resources\compose\compose.yaml" TODAVÍA existe cuando esto corre.
;
; ${isUpdated} es la variable que electron-builder ya usa en su propia lógica
; de KEEP_APP_DATA (mismo archivo, línea 164): cuando una versión nueva se
; instala ENCIMA de esta, electron-builder invoca este mismo desinstalador en
; silencio con la bandera --updated antes de copiar los archivos nuevos. Si no
; se comprobara esto, cada actualización pararía y borraría los contenedores e
; imágenes que la versión nueva necesita segundos después, y el usuario vería
; "preparando entorno..." otra vez y una descarga de ~1 GB en cada actualización.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Deteniendo y eliminando los servicios Docker de Telar..."
    ; --profile build: el servicio 'runner' vive tras ese perfil (nunca corre
    ; como servicio, solo se usa para traer la imagen — ver ipc-docker.ts) y
    ; sin la bandera, `down` ni lo considera y su imagen queda huérfana.
    ; --rmi all borra las imágenes de los DOS servicios (backend + runner).
    ; Deliberadamente SIN -v: los volúmenes (telar_data con el progreso de
    ; quizzes, telar_submissions) NO se tocan aquí. Es un array separado de
    ; la decisión de borrar datos de usuario, que ya gobierna
    ; deleteAppDataOnUninstall (solo aplica a %APPDATA%, no a Docker).
    nsExec::ExecToLog '"docker" compose --profile build -f "$INSTDIR\resources\compose\compose.yaml" down --rmi all'
    Pop $0
    ; Sin bloquear la desinstalación si Docker no está instalado, no está
    ; corriendo, o el usuario ya lo había limpiado a mano: el mismo criterio
    ; que main.ts aplica al cerrar la app (nunca impedir la acción principal
    ; por un fallo al hablar con Docker).
  ${endIf}
!macroend
