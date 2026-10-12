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
    DetailPrint "Eliminando los servicios y los datos Docker de Telar..."
    ; Desinstalar deja el equipo como si Telar nunca hubiera estado: una
    ; reinstalación arranca de cero (sin progreso, cursos ni ejecuciones).
    ; --profile build: el servicio 'runner' vive tras ese perfil (nunca corre
    ; como servicio, solo se usa para traer la imagen — ver ipc-docker.ts) y
    ; sin la bandera, `down` ni lo considera y su imagen queda huérfana.
    ; --rmi all borra las imágenes de los DOS servicios (backend + runner).
    ; -v borra los volúmenes: telar_data (progreso, cursos instalados,
    ; historial de ejecuciones) y telar_submissions (código enviado).
    nsExec::ExecToLog '"docker" compose --profile build -f "$INSTDIR\resources\compose\compose.yaml" down -v --rmi all --remove-orphans'
    Pop $0
    ; Contenedores de ejecuciones que hubieran quedado sueltos.
    nsExec::ExecToLog '"docker" container prune -f --filter label=telar.runner'
    Pop $0
    ; Si Docker no estaba corriendo, lo anterior no pudo hacer nada. La red de
    ; seguridad está en la app: al no encontrar %APPDATA%\Telar (que se borra
    ; siempre, deleteAppDataOnUninstall), la primera apertura de una
    ; reinstalación limpia los datos Docker antes de arrancar (fresh-install.ts).
    ; Sin bloquear la desinstalación si Docker no está instalado, no está
    ; corriendo, o el usuario ya lo había limpiado a mano: el mismo criterio
    ; que main.ts aplica al cerrar la app (nunca impedir la acción principal
    ; por un fallo al hablar con Docker).
  ${endIf}
!macroend

; Instalación nueva = arranque de cero, sin importar cómo se desinstaló antes.
; Los desinstaladores ≤1.0.8 borraban las imágenes pero NO los volúmenes ni
; %APPDATA%\Telar; y con Docker apagado al desinstalar, tampoco los de ahora
; pueden borrar los volúmenes. Por eso es el INSTALADOR quien decide: si al
; empezar no hay una instalación registrada de Telar, es nueva (no una
; actualización) y deja el marcador de fresh-install.ts con resetPending:true,
; que hace que la primera apertura borre los datos Docker antes de arrancar.
!ifndef BUILD_UNINSTALLER
  Var telarInstalacionNueva

  !macro customInit
    StrCpy $telarInstalacionNueva "1"
    ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $0 != ""
      StrCpy $telarInstalacionNueva "0"
    ${endIf}
    ReadRegStr $0 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $0 != ""
      StrCpy $telarInstalacionNueva "0"
    ${endIf}
  !macroend

  !macro customInstall
    ${if} $telarInstalacionNueva == "1"
      ; Electron guarda userData siempre por usuario.
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endIf}
      RMDir /r "$APPDATA\Telar"
      CreateDirectory "$APPDATA\Telar"
      FileOpen $0 "$APPDATA\Telar\telar-instalacion.json" w
      FileWrite $0 '{"resetPending":true}'
      FileClose $0
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endIf}
    ${endIf}
  !macroend
!endif
