# Auditoría de casos de uso — estado y faltantes (2026-09-18)

> **Fuente de verdad** para el cierre de faltantes. Cada CU tiene un estado
> (🟢 Implementado / 🟡 Parcial / 🔴 No implementado), un "Por qué" que describe
> lo que **ya funciona y debe conservarse**, y una lista numerada de faltantes con
> "Cómo está ahora" / "Cómo debería estar".
>
> **Nota de numeración:** esta auditoría usa 41 CU y **no coincide** con la
> numeración de `telar/docs/casos-de-uso.md` (34 CU, numeración anterior; por
> ejemplo allí CU-23 es "quiz" y CU-27 es "sandbox"). Ante cualquier duda manda
> este documento. `casos-de-uso.md` debe alinearse a esta numeración.

## Resumen

| Estado | CU |
|---|---|
| 🟢 Implementado | CU-11, CU-33, CU-35 |
| 🔴 No implementado | CU-28, CU-30, CU-31, CU-39, CU-40, CU-41 |
| 🟡 Parcial | todos los demás |

---

### CU-01 — Explorar el catálogo de módulos y lecciones

**Estado:** 🟡 **Parcial**

**Por qué:**

El flujo principal sí funciona: el estudiante puede entrar al catálogo, consultar módulos y lecciones, ver información de progreso, abrir lecciones y reintentar si falla la carga. Además, el contenido incorporado se consulta localmente. Sin embargo, todavía hay algunos comportamientos de búsqueda, filtrado y continuidad que deben ajustarse.

**Qué falta:**

**1. Búsqueda y filtros**

**Cómo está ahora:**

La búsqueda y los filtros funcionan sobre las lecciones, pero siguen apareciendo módulos que no contienen ninguna coincidencia. Además, algunos resultados pueden quedar dentro de módulos por lo que pueden no ser evidentes para el estudiante.

**Cómo debería estar:**

Al buscar o aplicar un filtro, deberían mostrarse únicamente los módulos y/o lecciones que tengan coincidencias. Los resultados deberían quedar visibles o ser fáciles de identificar.

**2. Estado cuando no existen resultados**

**Cómo está ahora:**

Existe un mensaje de "sin resultados", pero solo aparece dentro de un módulo abierto.

**Cómo debería estar:**

Cuando no exista ninguna coincidencia en todo el catálogo, debería mostrarse un mensaje general como **"No se encontraron resultados"**, independientemente de qué módulos estén abiertos.

**3. Opción "Continuar/Empezar"**

**Cómo está ahora:**

La aplicación puede intentar continuar con la última lección visitada o utilizar una lección predeterminada sin comprobar completamente que esa lección siga existiendo dentro del curso incorporado actual.

**Cómo debería estar:**

"Continuar/Empezar" debería dirigir siempre a una lección que exista dentro de la versión actual del curso incorporado. Si la última lección visitada ya no existe después de una actualización, Telar debería seleccionar una lección válida de acuerdo con la progresión recomendada del curso.

---

### CU-02 — Realizar una lección

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante puede abrir una lección y consultar correctamente su contenido escrito. También existe soporte para recursos opcionales como videos, quizzes y ejemplos que pueden abrirse en el simulador. Además, la plataforma diferencia entre una lección que simplemente fue vista y una que fue completada. Sin embargo, todavía falta manejar correctamente todos los requisitos necesarios para completar una lección y los talleres aún no están integrados al flujo.

**Qué falta:**

**1. Talleres asociados a una lección**

**Cómo está ahora:**

Las lecciones pueden contener contenido escrito, video, quiz y ejemplos, pero todavía no existe un flujo funcional para acceder a un taller asociado.

**Cómo debería estar:**

Cuando una lección tenga un taller configurado, el estudiante debería poder verlo y acceder a él directamente desde la lección.

**2. Componentes obligatorios y opcionales**

**Cómo está ahora:**

El sistema maneja diferentes componentes de una lección, pero todavía no existe una lógica completa que determine cuáles deben cumplirse obligatoriamente y cuáles son únicamente recursos opcionales.

**Cómo debería estar:**

Cada lección debería tener definidos sus **componentes requeridos**. Por ejemplo, una lección podría exigir ver el video y aprobar el quiz, mientras que leer el contenido escrito podría ser opcional (como en coursera).

**3. Completitud de la lección**

**Cómo está ahora:**

Algunas actividades pueden modificar directamente el estado de completitud. Por ejemplo, aprobar el quiz puede marcar toda la lección como completada aunque todavía exista otro requisito pendiente.

**Cómo debería estar:**

Cada actividad debería marcar únicamente **su propio requisito como cumplido**. Después, Telar debería revisar todos los requisitos definidos para la lección y marcarla como completada solo cuando ninguno quede pendiente.

**4. Lecciones que se completan por visualización**

**Cómo está ahora:**

Abrir una lección la registra como vista, pero todavía no existe un flujo completo que utilice ese estado para cumplir el requisito de las lecciones cuya condición de finalización sea consultar su contenido.

**Cómo debería estar:**

Cuando una lección tenga como único requisito de completitud la consulta de su contenido, Telar debería registrar ese requisito como cumplido según la regla definida para la lección y actualizar su progreso. Si existen otros componentes requeridos, la lección debe permanecer incompleta hasta cumplirlos también.

**5. Lecciones que requieren ejecutar un ejemplo**

**Cómo está ahora:**

La ejecución del ejemplo queda registrada, pero completar una ejecución no marca el requisito de ejecución de la lección como cumplido.

**Cómo debería estar:**

Cuando una lección tenga como requisito ejecutar un ejemplo, una ejecución válida debería marcar **ese requisito** como cumplido. Después, Telar debería revisar si quedan otros requisitos pendientes antes de completar la lección.

---

### CU-03 — Responder el quiz de una lección

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante puede iniciar el quiz, responder todas las preguntas, enviar el intento y recibir el resultado con puntaje y retroalimentación. La evaluación se realiza en el backend, los intentos quedan guardados y el porcentaje mínimo para aprobar es configurable. Además, el estudiante ya puede volver a intentarlo las veces que necesite si no aprueba. El problema pendiente está en cómo la aprobación del quiz afecta la completitud de la lección.

**Qué falta:**

**1. Relación entre aprobar el quiz y completar la lección**

**Cómo está ahora:**

Cuando el estudiante aprueba el quiz, Telar marca directamente toda la lección como completada.

**Cómo debería estar:**

Aprobar el quiz debería marcar únicamente **el requisito del quiz como cumplido**. Después, Telar debería revisar si la lección tiene otros componentes obligatorios pendientes, como un taller o una ejecución. Solo cuando todos los requisitos de esa lección estén cumplidos debería marcarse la lección como completada.

---

### CU-04 — Ejecutar un ejemplo de una lección en el simulador

**Estado:** 🟡 **Parcial**

**Por qué:**

El flujo principal está prácticamente completo: el estudiante puede abrir un ejemplo desde una lección, revisar y modificar su código, cambiar las opciones de ejecución, ejecutarlo en el entorno aislado de Telar, observar la ejecución, consultar los resultados y volver a experimentar. El problema aparece cuando el estudiante modifica un ejemplo y luego decide volver a ejecutarlo desde los resultados: Telar conserva el código modificado, pero pierde la información de que ese código originalmente pertenecía a un ejemplo y a una lección.

**Qué falta:**

**1. Conservar la relación con el ejemplo y la lección al volver a ejecutar**

**Cómo está ahora:**

La primera vez que el estudiante ejecuta un ejemplo desde una lección, Telar sí sabe de qué ejemplo y de qué lección proviene, incluso si el estudiante modifica el código antes de ejecutarlo.

El problema ocurre después. Si el estudiante llega a los resultados y selecciona **"Re-ejecutar"**, Telar conserva el código que había modificado, pero lo trata como si fuera código propio escrito desde cero. En esa nueva ejecución ya no conserva la relación con el ejemplo ni con la lección de donde salió originalmente.

**Cómo debería estar:**

Cuando el estudiante vuelva a ejecutar un ejemplo que modificó, Telar debería conservar **las dos cosas al mismo tiempo**:

- el código con los cambios realizados por el estudiante;
- la información de cuál era el ejemplo y la lección de origen.

De esta forma, aunque el estudiante haga varias modificaciones y ejecuciones sucesivas, Telar seguirá reconociendo que está experimentando con un ejemplo perteneciente a una lección y no lo convertirá accidentalmente en código propio independiente.

---

### CU-05 — Ejecutar código propio desde el editor

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede entrar al simulador y trabajar con código propio sin necesidad de partir de una lección. Puede escribir código desde cero, modificarlo, configurar opciones como el número de hilos y el tiempo máximo de ejecución, ejecutarlo en el entorno aislado de Telar, observar la ejecución, consultar los resultados y volver al editor conservando el código para seguir experimentando.

Sin embargo, todavía existen dos situaciones que pueden impedir que el editor de código propio funcione de manera realmente independiente y segura para el trabajo del estudiante.

**Qué falta:**

**1. Permitir usar código propio aunque falle la carga del catálogo**

**Cómo está ahora:**

Aunque el estudiante esté trabajando con código propio y no necesite ninguna lección ni ejemplo, la pantalla del simulador sigue dependiendo de que se pueda cargar correctamente el catálogo de módulos.

Si esa carga falla, Telar muestra un error que bloquea toda la pantalla, incluyendo el editor de código propio.

**Cómo debería estar:**

El estudiante debería poder utilizar el editor de código propio siempre que el simulador y el entorno de ejecución estén funcionando.

Un problema al cargar módulos, lecciones o ejemplos no debería impedir escribir y ejecutar código propio, porque este flujo no depende del contenido educativo.

**2. Evitar que un ejemplo que estaba cargándose reemplace el código propio**

**Cómo está ahora:**

Puede ocurrir que Telar esté cargando un ejemplo y, antes de que termine, el estudiante seleccione **"Código propio"** y empiece a escribir.

Si la carga del ejemplo termina después, Telar puede reemplazar el código que estaba escribiendo el estudiante por el contenido del ejemplo que llegó tarde.

Es decir: el usuario ya decidió trabajar con código propio, pero una operación anterior todavía puede cambiarle el editor.

**Cómo debería estar:**

En el momento en que el estudiante seleccione **"Código propio"**, Telar debería ignorar o cancelar cualquier carga pendiente de un ejemplo anterior.

A partir de ese momento, el contenido escrito por el estudiante no debería reemplazarse automáticamente. Solo debería cambiar si el propio estudiante modifica el código, carga un archivo o selecciona explícitamente otro ejemplo.

---

### CU-06 — Subir un archivo `.py` para ejecutar

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede seleccionar o arrastrar un archivo `.py` desde su computador, cargar su contenido en el editor, modificarlo, configurar la ejecución y ejecutar exactamente la versión que aparece en pantalla. También puede observar la ejecución, consultar los resultados, volver al editor y seguir trabajando con ese código.

Sin embargo, todavía hay tres situaciones que pueden interrumpir o confundir ese flujo: una carga anterior puede reemplazar el archivo con el que el estudiante decidió trabajar, el simulador sigue dependiendo innecesariamente del catálogo educativo y algunos nombres de archivo son aceptados al cargarlos pero rechazados al momento de ejecutar.

**Qué falta:**

**1. Evitar que una carga anterior reemplace el archivo actual**

**Cómo está ahora:**

Telar puede estar cargando un ejemplo o leyendo un archivo y, mientras esa operación termina, el estudiante puede seleccionar otro archivo o empezar a modificar el código.

Si la operación anterior termina después, puede reemplazar el contenido más reciente del editor. Por ejemplo, el estudiante carga `programa2.py`, pero una lectura anterior de `programa1.py` termina más tarde y vuelve a poner su contenido en pantalla.

**Cómo debería estar:**

Telar debería conservar siempre **la última selección realizada por el estudiante**.

Cuando el usuario cargue un nuevo archivo o empiece a trabajar con otro contenido, cualquier carga anterior que todavía esté pendiente debería cancelarse o ignorarse para que no pueda reemplazar el trabajo actual.

**2. Permitir trabajar con archivos aunque falle el catálogo educativo**

**Cómo está ahora:**

El archivo `.py` no necesita pertenecer a una lección ni a un curso, pero la pantalla del simulador todavía depende de que se cargue correctamente el catálogo de módulos.

Si esa consulta falla, también se bloquea la posibilidad de cargar, editar y ejecutar un archivo propio.

**Cómo debería estar:**

La carga y ejecución de archivos propios debería funcionar siempre que el simulador y el entorno de ejecución estén disponibles.

Un problema al consultar módulos, lecciones o ejemplos no debería impedir que el estudiante trabaje con un archivo `.py` de su computador.

**3. Validar el nombre del archivo antes de aceptarlo**

**Cómo está ahora:**

Telar acepta algunos archivos durante la carga, pero después el backend rechaza su nombre cuando se intenta ejecutar.

Por ejemplo, puede aceptar inicialmente nombres con espacios, caracteres especiales o una extensión escrita como `.PY`, pero la ejecución posterior no acepta exactamente las mismas reglas.

**Cómo debería estar:**

La validación debería ser coherente desde el principio.

Si un nombre de archivo no puede utilizarse para ejecutar, Telar debería avisarlo **al momento de cargarlo**, antes de reemplazar el contenido actual del editor. Otra opción sería adaptar internamente el nombre utilizado para la ejecución sin modificar ni perder el código del estudiante.

---

### CU-07 — Observar una ejecución en vivo

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede seguir una ejecución mientras está activa: Telar muestra su estado, salida, métricas de CPU y memoria y actualiza la información en tiempo real. También permite salir de la vista, regresar posteriormente a una ejecución que siga activa y acceder a sus resultados cuando termina.

Sin embargo, todavía existen algunos casos en los que la información mostrada puede ser imprecisa o incompleta, especialmente cuando una ejecución no imprime salida inmediatamente o cuando el estudiante pierde la conexión y vuelve a entrar.

**Qué falta:**

**1. Mostrar correctamente si la ejecución está compilando o ejecutándose**

**Cómo está ahora:**

Telar cambia el estado de **"Compilando"** a **"Ejecutando"** cuando recibe la primera salida del programa.

Esto significa que un programa puede estar ejecutándose correctamente pero, si todavía no ha hecho ningún `print`, Telar puede seguir mostrándolo como si estuviera compilando.

**Cómo debería estar:**

El estado mostrado debería depender de la fase real de la ejecución y no de si el programa ya produjo texto.

Si el código ya terminó de compilar y comenzó a ejecutarse, Telar debería mostrar **"Ejecutando"**, aunque todavía no exista salida en la terminal.

**2. Mostrar la salida tan pronto como el programa la produzca**

**Cómo está ahora:**

La salida se muestra en vivo, pero algunos textos pueden quedar temporalmente retenidos hasta que el programa genere un salto de línea o termine.

Por ejemplo, si un programa imprime parte de un mensaje sin `\n`, el estudiante puede no verlo inmediatamente aunque el programa ya lo haya producido.

**Cómo debería estar:**

La terminal debería mostrar la salida disponible durante la ejecución tan pronto como sea posible, incluso cuando todavía no forme una línea completa.

**3. Recuperar correctamente la salida después de una desconexión**

**Cómo está ahora:**

Si se pierde la conexión con la ejecución, Telar intenta reconectarse y recupera el estado actual y una parte de la salida reciente.

Sin embargo, no siempre recupera todo lo que ocurrió mientras el estudiante estuvo desconectado. Parte de la salida anterior puede desaparecer sin que se le indique al usuario que falta información.

**Cómo debería estar:**

Cuando el estudiante se reconecte o vuelva a una ejecución activa, Telar debería:

- recuperar toda la salida que todavía esté disponible; o
- indicar claramente que una parte de la salida no pudo recuperarse.

La interfaz no debería mostrar una terminal aparentemente completa cuando en realidad faltan fragmentos.

**4. Mantener correctamente el tiempo transcurrido al volver a una ejecución**

**Cómo está ahora:**

Cuando el estudiante sale de una ejecución y vuelve después, el tiempo mostrado puede empezar a contarse nuevamente desde el momento de la reconexión.

Por ejemplo, una ejecución que lleva 40 segundos podría volver a mostrar un tiempo cercano a 0 segundos cuando el estudiante regresa.

**Cómo debería estar:**

El tiempo debería calcularse usando el **inicio real de la ejecución**, de manera que al regresar se continúe mostrando cuánto tiempo lleva realmente ejecutándose.

**5. Aclarar qué información por hilo es real y cuál es ilustrativa**

**Cómo está ahora:**

Telar tiene visualizaciones que sí están identificadas como ilustrativas. Sin embargo, en el detalle por hilo puede mostrar todos los hilos como **"activos"** utilizando únicamente el estado general de la ejecución, aunque realmente no esté midiendo cada hilo individualmente.

**Cómo debería estar:**

Si Telar no conoce el estado real de cada hilo, no debería presentarlo como una medición individual.

Puede mantener la visualización, pero debería dejar claro que es **una representación ilustrativa de la ejecución** y no información medida de cada hilo.

---

### CU-08 — Cancelar una ejecución

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede cancelar una ejecución: Telar muestra la opción de detenerla, pide confirmación, puede cancelar trabajos que todavía están esperando en cola y detener ejecuciones que ya están corriendo. Además, guarda el estado de cancelación, la salida y las métricas generadas hasta ese momento para consultarlas después.

Sin embargo, todavía existen situaciones excepcionales donde Telar puede interpretar incorrectamente que una ejecución fue cancelada o no informar al estudiante cuando la solicitud de cancelación realmente no pudo realizarse.

**Qué falta:**

**1. No marcar como cancelada una ejecución que ya había terminado**

**Cómo está ahora:**

Puede ocurrir que el programa termine normalmente y, casi al mismo tiempo, el estudiante presione **"Detener"**.

En ese pequeño intervalo, Telar todavía puede recibir la solicitud de cancelación y terminar guardando la ejecución como **"Cancelada"**, aunque el programa realmente ya había terminado por sí mismo.

**Cómo debería estar:**

Antes de registrar una ejecución como cancelada, Telar debería comprobar si la cancelación realmente ocurrió antes de que el programa terminara.

Si la ejecución terminó primero, debería conservarse su resultado real —por ejemplo, **completada** o **fallida**— y no cambiarlo posteriormente a "Cancelada".

**2. Informar cuando la solicitud de cancelación no pudo enviarse**

**Cómo está ahora:**

La cancelación se envía mediante la conexión en tiempo real.

Si esa conexión se encuentra caída o todavía no está disponible, el estudiante puede confirmar **"Sí, detener"**, pero la solicitud podría no enviarse. La ventana de confirmación se cierra y no necesariamente se le informa que la ejecución sigue corriendo.

**Cómo debería estar:**

Si Telar no puede enviar la solicitud de cancelación, debería indicarlo claramente al estudiante.

Por ejemplo:

> "No fue posible solicitar la cancelación. La ejecución puede continuar activa."

Además, debería permitir volver a intentarlo cuando la conexión esté disponible.

**3. Comprobar que la ejecución realmente se detuvo**

**Cómo está ahora:**

Cuando la ejecución está corriendo, Telar intenta detener su contenedor. Sin embargo, si Docker devuelve un error durante esa operación, ese error puede ignorarse.

Esto significa que Telar puede haber recibido la intención de cancelar aunque el proceso realmente no se haya detenido.

**Cómo debería estar:**

Telar debería distinguir entre:

- la ejecución **se detuvo correctamente**;
- la ejecución **ya había terminado**;
- la ejecución **no pudo detenerse**.

Solo debería marcarla como cancelada cuando exista evidencia de que la cancelación fue efectiva.

Si no pudo detenerse, debería informar el problema y permitir volver a intentar la operación cuando corresponda.

**4. Mantener coherencia entre lo que muestra la interfaz y lo que quedó guardado**

**Cómo está ahora:**

En algunos fallos poco comunes, Telar puede determinar en memoria que una ejecución terminó y comunicar ese estado a la interfaz aunque haya ocurrido un problema al guardar correctamente ese resultado en la base de datos.

Esto puede hacer que el estudiante vea un estado que no coincide con el que realmente quedó persistido.

**Cómo debería estar:**

Telar debería mostrar como definitivo únicamente un estado que haya podido conservar correctamente.

Si ocurre un problema al guardar el resultado de la cancelación, debería informar que hubo un error y evitar presentar una cancelación como exitosa cuando el registro persistido no lo confirma.

**5. Manejar correctamente el botón de cancelar cuando se pierde la conexión**

**Cómo está ahora:**

El botón de detener puede seguir apareciendo cuando Telar perdió la conexión con la ejecución. En ese momento, el sistema no sabe con certeza si todavía puede enviar la solicitud.

**Cómo debería estar:**

Si la conexión está perdida, Telar debería dejar claro que temporalmente **no puede confirmar una cancelación**. Puede deshabilitar la acción hasta reconectarse o permitir intentarla mostrando claramente si la solicitud fue enviada o no.

---

### CU-09 — Consultar resultados y métricas de una ejecución

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede abrir una ejecución finalizada y consultar su estado, salida, métricas y visualizaciones disponibles. Telar distingue correctamente entre ejecuciones exitosas, fallidas, canceladas y terminadas por timeout, y los resultados pueden volver a consultarse posteriormente incluso después de reiniciar la aplicación.

Sin embargo, todavía falta mostrar parte de la configuración con la que se realizó la ejecución, presentar de forma completa la información de errores disponible y corregir algunas métricas que actualmente pueden resultar confusas o engañosas.

**Qué falta:**

**1. Mostrar la configuración completa utilizada en la ejecución**

**Cómo está ahora:**

La pantalla de resultados muestra información como el nombre del archivo y el número de hilos utilizados.

Sin embargo, hay datos que Telar sí conserva pero no muestra, como el **timeout configurado** —excepto cuando precisamente ocurrió un timeout— y el **origen del código**, por ejemplo si provenía de un ejemplo o del editor.

**Cómo debería estar:**

La pantalla de resultados debería mostrar la configuración relevante que realmente se utilizó en esa ejecución, independientemente de cómo terminó.

Por ejemplo, debería poder consultarse:

- número de hilos;
- timeout configurado;
- nombre del archivo;
- origen del código, cuando corresponda.

**2. Permitir consultar completamente los errores de la ejecución**

**Cómo está ahora:**

Telar muestra correctamente `stdout`, pero la información de error es más limitada.

Cuando una ejecución falla, solo se muestran algunas líneas de `stderr`. Además, una ejecución cancelada o terminada por timeout puede haber generado información en `stderr` que no se muestra en la pantalla de resultados.

También pueden existir detalles del error guardados por el backend que no se presentan al estudiante.

**Cómo debería estar:**

Si una ejecución tiene información de error disponible, el estudiante debería poder consultarla desde la pantalla de resultados.

Telar debería mostrar el `stderr` disponible y, cuando exista una causa registrada del fallo, presentarla de forma comprensible independientemente de si terminó por error, cancelación o timeout.

**3. No mostrar como `0` una métrica que realmente no fue medida**

**Cómo está ahora:**

Cuando alguna métrica no existe, Telar normalmente muestra algo como `—` o simplemente no presenta la gráfica.

Sin embargo, algunos valores ausentes pueden convertirse internamente en **0**, lo que hace parecer que realmente se obtuvo una medición de cero.

**Cómo debería estar:**

Telar debería diferenciar claramente entre:

- un valor que realmente fue medido y dio `0`;
- un valor que **no fue medido o no está disponible**.

Si la métrica no existe, debería mostrarse como **"No disponible"**, `—` u omitirse, pero no convertirse en una medición de cero.

**4. Corregir la interpretación del dato mostrado como "Hilos (PIDs)"**

**Cómo está ahora:**

En el resumen aparece una métrica denominada **"Hilos (PIDs)"**.

Sin embargo, ese valor realmente corresponde al conteo de tareas o procesos que observa Docker dentro del contenedor y no necesariamente al número de hilos OpenMP que está utilizando el programa.

Esto puede hacer que el estudiante interprete incorrectamente ese dato como el número real de hilos utilizados por su código.

**Cómo debería estar:**

Ese dato debería identificarse con un nombre que represente lo que realmente mide.

Si se desea mostrar el número de hilos OpenMP del programa, debería utilizarse una fuente que realmente mida esa información. Si no se dispone de ella, no debería presentarse el conteo de PIDs como equivalente.

---

### CU-10 — Descargar la salida de una ejecución

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede descargar la salida textual de una ejecución finalizada. El archivo contiene el `stdout` y `stderr` que Telar haya conservado, funciona para ejecuciones exitosas, fallidas, canceladas o terminadas por timeout, identifica cuando la salida fue truncada y puede volver a descargarse posteriormente porque la información queda almacenada.

El faltante está en el manejo de errores durante la descarga: si Telar no logra realizarla, actualmente no existe un flujo dentro de la aplicación que informe claramente al estudiante que la operación falló.

**Qué falta:**

**1. Informar cuando la descarga no pudo realizarse**

**Cómo está ahora:**

Los botones de descarga están conectados directamente al archivo que entrega el backend.

Cuando todo funciona, el archivo se descarga correctamente. Sin embargo, si ocurre un problema —por ejemplo, el backend rechaza la solicitud o no puede entregar el archivo— Telar no captura ese fallo para mostrarle al estudiante qué ocurrió.

La aplicación tampoco muestra falsamente que la descarga fue exitosa; simplemente no tiene un manejo claro del error.

**Cómo debería estar:**

Si la descarga no puede realizarse, Telar debería mostrar una indicación comprensible, por ejemplo:

> **"No fue posible descargar la salida. Inténtalo nuevamente."**

Los resultados de la ejecución deberían permanecer disponibles y el estudiante debería poder volver a intentar la descarga.

**Importante:** no se considera faltante el caso de una ejecución sin salida. La especificación vigente permite que, si no existe información textual generada, el archivo descargado esté vacío.

---

### CU-11 — Consultar ejecuciones recientes

**Estado:** 🟢 **Implementado**

**Por qué:**

El estudiante puede consultar sus ejecuciones recientes desde una lista conectada a información real almacenada en SQLite.

Telar muestra las 50 ejecuciones más recientes, permite identificar y abrir la ejecución seleccionada utilizando su `job_id`, retomar el seguimiento cuando todavía está activa y volver a consultar los resultados cuando ya terminó.

Las ejecuciones completadas, fallidas, canceladas o terminadas por timeout permanecen disponibles, y desde una ejecución recuperada siguen estando accesibles las acciones correspondientes, como descargar la salida o volver a ejecutar el código.

Además, las ejecuciones permanecen almacenadas después de cerrar y volver a abrir Telar, por lo que el historial no depende únicamente de información mantenida en memoria.

**Qué falta:**

Nada. No se identificaron faltantes funcionales propios de CU-11.

---

### CU-12 — Consultar el progreso de un curso

**Estado:** 🟡 **Parcial**

**Por qué:**

El estudiante ya puede consultar el avance general del curso, el progreso de cada módulo y el estado de las lecciones. Esta información está conectada a datos reales, se guarda en SQLite y permanece disponible después de cerrar y volver a abrir Telar.

Sin embargo, la lógica de progreso todavía no representa correctamente todas las formas de completar una lección que Telar admite. Actualmente funcionan correctamente las lecciones cuya completitud depende de aprobar un quiz, pero las lecciones configuradas para completarse mediante lectura o ejecución de código no llegan a registrarse como completadas.

Además, aprobar un quiz puede marcar una lección como completada aunque esa lección tenga configurada otra regla de completitud, y la interfaz no permite identificar claramente qué requisito específico falta por cumplir.

También existe una inconsistencia entre el progreso general y el progreso mostrado dentro de los módulos cuando existen lecciones deshabilitadas.

**Qué falta:**

**1. Completar correctamente las lecciones cuya regla es lectura o ejecución**

**Cómo está ahora:**

Telar admite lecciones cuya regla de completitud puede ser `viewed`, `quiz` o `run`.

Las lecciones basadas en quiz funcionan: al aprobar el quiz pueden quedar completadas.

Sin embargo:

- visitar una lección `viewed` solamente registra que fue visualizada;
- ejecutar correctamente el código de una lección `run` solamente registra el último job ejecutado.

En ninguno de esos dos casos la lección queda marcada como completada.

**Cómo debería estar:**

Cuando una lección tenga como regla `viewed`, completar la acción correspondiente de lectura debería registrar su finalización.

Cuando tenga como regla `run`, una ejecución válida asociada a esa lección debería registrar su finalización.

El progreso del curso y del módulo debe actualizarse en consecuencia.

**2. Respetar la regla de completitud de la lección al aprobar un quiz**

**Cómo está ahora:**

Cuando el estudiante aprueba un quiz, Telar marca directamente la lección como completada.

Esto ocurre incluso si esa lección está configurada para completarse mediante otra regla, como `run` o `viewed`.

Por ejemplo, una lección cuya condición real sea ejecutar correctamente su código podría quedar completada únicamente por aprobar un quiz adicional.

**Cómo debería estar:**

Aprobar un quiz debe registrar el cumplimiento del quiz, pero solo debe completar la lección cuando el quiz sea realmente su condición de completitud.

La finalización de la lección debe respetar su `completion_rule`.

**3. Mostrar qué requisito falta para completar una lección**

**Cómo está ahora:**

El estudiante puede distinguir si una lección aparece completada o pendiente, pero Telar no utiliza la regla de completitud para explicar qué debe hacer para terminarla.

Esto afecta especialmente a las lecciones cuya condición sea lectura o ejecución.

**Cómo debería estar:**

El estudiante debería poder reconocer qué acción requiere la lección para considerarse completada y si dicha acción ya fue cumplida.

Por ejemplo, debería poder comprender que una lección está pendiente porque todavía necesita ser leída o porque todavía falta realizar correctamente la ejecución requerida.

**4. Mantener coherencia entre el progreso general y el progreso de los módulos**

**Cómo está ahora:**

El progreso general y el progreso por módulo no utilizan exactamente el mismo criterio con las lecciones deshabilitadas.

Una lección deshabilitada que conserva su estado de completada puede seguir contando como completada dentro de su módulo, mientras que el resumen general no la cuenta como completada pero sí la mantiene dentro del total.

Esto puede provocar que los módulos indiquen que todo está completado mientras el progreso general todavía muestre contenido pendiente.

**Cómo debería estar:**

El progreso general y el progreso por módulo deben utilizar un criterio coherente respecto a las lecciones deshabilitadas, de modo que no presenten estados contradictorios sobre el avance del estudiante.

---

### CU-13 — Crear un módulo de curso

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede crear un módulo desde Autoría, ingresar su información, guardarlo y conservarlo en SQLite. El módulo aparece posteriormente en la estructura editable, permanece después de reiniciar Telar y puede volver a abrirse para editarlo o agregarle lecciones.

Sin embargo, todavía faltan tres comportamientos definidos por el caso de uso: Telar no advierte antes de descartar cambios sin guardar, un módulo recién creado queda inmediatamente expuesto en el contenido educativo local antes de una publicación posterior y algunos errores de validación se presentan de forma demasiado genérica para que el Administrador identifique qué debe corregir.

**Qué falta:**

**1. Advertir antes de descartar cambios sin guardar**

**Cómo está ahora:**

Después de modificar información en el formulario de creación, el Administrador puede cerrarlo mediante Cancelar, Escape o clic fuera del modal.

Telar cierra directamente el formulario y pierde los cambios introducidos sin advertir que existen modificaciones pendientes.

**Cómo debería estar:**

Si existen cambios sin guardar, Telar debe advertirlo antes de abandonar el formulario y permitir al Administrador elegir si desea permanecer o descartar los cambios.

**2. Separar la creación del módulo de su publicación para estudiantes**

**Cómo está ahora:**

Al guardar un módulo, este se incorpora correctamente al contenido editable, pero también pasa inmediatamente a la misma estructura utilizada por `/api/v1/modules` y por la vista de aprendizaje.

Por tanto, puede quedar disponible para los estudiantes sin haber realizado posteriormente la acción de publicación.

Existe una publicación hacia el catálogo remoto, pero esa publicación no controla la visibilidad educativa dentro de la instalación local.

**Cómo debería estar:**

Guardar el módulo debe incorporarlo al curso en edición, pero no hacerlo disponible para los estudiantes.

Solo una publicación posterior del curso debe hacer que el nuevo contenido forme parte de la versión educativa publicada.

**3. Informar de forma comprensible qué dato es inválido**

**Cómo está ahora:**

Telar sí impide guardar información que incumple las validaciones.

Sin embargo, para algunos casos —como un nivel vacío o valores que exceden los límites permitidos— el backend entrega información específica pero la interfaz únicamente muestra un error genérico indicando que la petición no es válida.

El Administrador puede volver a intentarlo, pero no necesariamente sabe qué debe corregir.

**Cómo debería estar:**

Cuando la información sea inválida, Telar debe indicar de manera comprensible qué dato presenta el problema o qué restricción no se cumple, conservar la información introducida y permitir corregirla y volver a guardar.

---

### CU-14 — Editar un módulo de curso

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede seleccionar un módulo existente, consultar su información actual, modificarla y guardar los cambios. La edición afecta al módulo correcto, queda persistida en SQLite, sobrevive al reinicio de Telar y puede volver a editarse posteriormente.

Además, si ocurre un fallo durante el guardado, Telar conserva la versión previamente válida mediante rollback y mantiene los valores introducidos en el formulario para permitir revisar y reintentar la operación.

Sin embargo, todavía faltan tres comportamientos del caso de uso: Telar no advierte antes de descartar cambios sin guardar, los cambios guardados quedan inmediatamente visibles en la superficie educativa local antes de una publicación posterior y algunos errores de validación no indican de manera comprensible qué dato debe corregirse.

**Qué falta:**

**1. Advertir antes de descartar cambios sin guardar**

**Cómo está ahora:**

Después de modificar información del módulo, el Administrador puede cerrar el formulario mediante Cancelar, Escape o clic fuera del modal.

Telar descarta directamente las modificaciones realizadas sin comprobar si existen cambios pendientes ni advertir al Administrador.

**Cómo debería estar:**

Cuando existan cambios sin guardar, Telar debe advertirlo antes de abandonar la edición y permitir decidir entre permanecer en el formulario o descartar las modificaciones.

**2. Separar la edición del módulo de su publicación para estudiantes**

**Cómo está ahora:**

Guardar una edición actualiza correctamente el contenido de Autoría, pero también sustituye inmediatamente el contenido utilizado por la API educativa local y por `/aprender`.

Existe una publicación posterior hacia el catálogo remoto, pero esta no controla la visibilidad del cambio dentro de la instalación local.

**Cómo debería estar:**

Los cambios guardados deben permanecer en la versión del curso que se está editando.

Los estudiantes deben continuar viendo la versión publicada anteriormente hasta que el Administrador realice posteriormente la publicación correspondiente.

**3. Informar de forma comprensible qué dato de la edición es inválido**

**Cómo está ahora:**

Telar rechaza correctamente datos inválidos y conserva la versión anterior del módulo.

Sin embargo, en algunos errores de validación el backend conoce específicamente qué campo incumple una restricción, mientras que la interfaz únicamente presenta un mensaje genérico indicando que la petición no es válida.

**Cómo debería estar:**

Telar debe indicar de forma comprensible qué campo o restricción presenta el problema, conservar los valores introducidos y permitir corregirlos y volver a intentar guardar.

---

### CU-15 — Reordenar módulos de un curso

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede consultar el orden actual de los módulos y reorganizarlos mediante arrastre o los controles de subir y bajar. Al mover un módulo, Telar reorganiza los demás, genera una secuencia consistente y guarda el nuevo orden de forma transaccional en SQLite.

El orden persiste después de reiniciar Telar y, si una operación aislada falla, el backend realiza rollback y conserva la organización anterior.

Sin embargo, todavía existen dos faltantes funcionales: pueden realizarse varios movimientos mientras operaciones anteriores siguen guardándose, lo que puede provocar que una respuesta antigua sobrescriba un movimiento posterior; además, el nuevo orden queda inmediatamente disponible en la interfaz educativa local sin esperar a una publicación posterior.

**Qué falta:**

**1. Coordinar movimientos realizados mientras existen guardados pendientes**

**Cómo está ahora:**

Cada movimiento inicia inmediatamente una solicitud de guardado, pero Telar permite realizar otros movimientos mientras las solicitudes anteriores todavía están pendientes.

Las operaciones no están serializadas ni identificadas por versión.

Esto puede provocar que:

- una operación anterior termine después de una más reciente y vuelva a dejar guardado un orden viejo;
- una respuesta fallida restaure una copia anterior de la lista;
- durante un arrastre, una actualización de la lista haga que el índice guardado termine correspondiendo a otro módulo.

**Cómo debería estar:**

Telar debe garantizar que los movimientos se apliquen en el mismo orden en que los realiza el Administrador y que una operación anterior nunca pueda sobrescribir una organización posterior.

La solución técnica puede consistir en bloquear temporalmente nuevos movimientos, serializar las operaciones o utilizar algún mecanismo equivalente.

**2. Separar el orden en edición del orden publicado para estudiantes**

**Cómo está ahora:**

Cuando se guarda el nuevo orden, este también pasa inmediatamente al contenido utilizado por la API educativa local y por `/aprender`.

Existe una publicación posterior hacia el catálogo remoto, pero esa publicación no controla qué orden ve el estudiante dentro de la misma instalación.

**Cómo debería estar:**

El nuevo orden debe quedar almacenado dentro del curso en edición.

Los estudiantes deben continuar viendo el orden publicado anteriormente hasta que el Administrador realice posteriormente la publicación correspondiente.

---

### CU-16 — Eliminar un módulo de curso

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede eliminar correctamente un módulo vacío. Telar muestra una advertencia previa, exige confirmación, permite cancelar sin realizar cambios y ejecuta la eliminación de forma transaccional, conservando el módulo ante un fallo.

Sin embargo, actualmente no es posible eliminar directamente un módulo que contenga lecciones. Telar bloquea la operación y exige vaciarlo manualmente, aunque CU-16 establece que el módulo y su contenido asociado deben poder eliminarse conjuntamente.

Además, la advertencia actual no informa sobre la eliminación del contenido asociado porque directamente exige que el módulo esté vacío, y una eliminación confirmada se refleja inmediatamente en la interfaz educativa local sin esperar a una publicación posterior.

**Qué falta:**

**1. Permitir eliminar un módulo junto con sus lecciones y contenido asociado**

**Cómo está ahora:**

Si el módulo contiene al menos una lección, Telar rechaza la eliminación mediante `MODULE_NOT_EMPTY` y solicita al Administrador vaciar primero el módulo.

La aplicación sí dispone de mecanismos para eliminar individualmente lecciones y limpiar varias de sus dependencias, pero CU-16 no utiliza ese flujo automáticamente.

**Cómo debería estar:**

El Administrador debe poder confirmar directamente la eliminación de un módulo que contenga lecciones.

La operación debe retirar conjuntamente el módulo, sus lecciones y los recursos educativos dependientes correspondientes, incluyendo la limpieza necesaria de progreso, intentos y referencias para evitar información huérfana.

Los jobs históricos independientes pueden conservarse.

**2. Advertir que también se eliminará el contenido asociado**

**Cómo está ahora:**

La confirmación indica que el módulo debe estar vacío antes de poder eliminarlo.

No existe el flujo en el que Telar advierta que las lecciones y contenido del módulo también serán eliminados.

**Cómo debería estar:**

Cuando el módulo contenga contenido, antes de confirmar Telar debe informar claramente que eliminar el módulo también retirará sus lecciones y recursos asociados.

No es necesario enumerar internamente cada tabla o registro afectado.

**3. Separar la eliminación en Autoría de su publicación para estudiantes**

**Cómo está ahora:**

Cuando se elimina un módulo, este desaparece inmediatamente del contenido utilizado por `/api/v1/modules` y `/aprender`.

Por tanto, la modificación realizada en Autoría puede quedar visible para estudiantes sin una publicación posterior.

**Cómo debería estar:**

La eliminación debe modificar primero el curso en edición.

Los estudiantes deben continuar viendo la versión publicada anteriormente hasta que el Administrador publique posteriormente los cambios del curso.

---

### CU-17 — Crear una lección

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede crear una lección dentro del módulo seleccionado, definir su información y contenido escrito en Markdown, guardarla de forma transaccional y volver a editarla posteriormente. La información queda persistida en SQLite y sobrevive al reinicio de Telar.

Sin embargo, el flujo obliga actualmente a crear un ejemplo ejecutable para todas las lecciones, aunque este debería ser opcional. Tampoco permite configurar desde Autoría algunos elementos que el propio modelo soporta, como la regla de completitud y el contenido audiovisual. Además, la protección frente a pérdida de cambios no cubre todos los caminos de salida, algunos errores de validación son demasiado genéricos y guardar la lección la expone inmediatamente en la superficie educativa local antes de una publicación posterior.

**Qué falta:**

**1. Permitir crear una lección sin ejemplo ejecutable**

**Cómo está ahora:**

Aunque el backend permite que una lección no tenga ejemplo, el editor siempre solicita y envía información del ejemplo y su código fuente.

Por tanto, una lección puramente conceptual o de lectura no puede crearse desde la interfaz sin incluir un ejemplo ejecutable.

**Cómo debería estar:**

El Administrador debe poder crear una lección únicamente con su información principal y contenido escrito.

El ejemplo ejecutable debe incorporarse solo cuando corresponda al propósito de esa lección.

**2. Permitir configurar los recursos y la regla de completitud que correspondan**

**Cómo está ahora:**

El modelo soporta reglas de completitud como `quiz`, `viewed` y `run`, pero el formulario no permite seleccionarlas y todas las nuevas lecciones utilizan `quiz` por defecto.

El backend también soporta contenido audiovisual mediante `video_url`, pero actualmente no existe un control en Autoría para configurarlo durante la creación ni posteriormente.

El quiz sí puede gestionarse después de crear la lección.

**Cómo debería estar:**

El Administrador debe poder configurar una regla de completitud coherente con la lección y gestionar los recursos soportados que correspondan a su contenido.

Por ejemplo, una lección conceptual debería poder utilizar una regla de lectura, mientras que una lección basada en ejecución debería poder utilizar la regla correspondiente.

Los recursos opcionales no deben convertirse en requisitos universales.

**3. Proteger todos los caminos relevantes frente a pérdida de cambios sin guardar**

**Cómo está ahora:**

Telar sí detecta modificaciones y advierte al cambiar hacia otra ruta con un `pathname` distinto.

Sin embargo, la protección no cubre todos los escenarios: cerrar o recargar la ventana puede descartar los cambios sin advertencia y determinados cambios de parámetros dentro de la misma ruta pueden reinicializar el formulario.

**Cómo debería estar:**

Cuando existan modificaciones pendientes, Telar debe advertir antes de cualquier acción del flujo que pueda hacer perder esos cambios.

**4. Mostrar de forma comprensible qué dato es inválido**

**Cómo está ahora:**

El backend rechaza correctamente la información inválida.

Sin embargo, algunos errores de validación llegan a la interfaz como mensajes genéricos y no indican qué campo debe corregirse.

**Cómo debería estar:**

Telar debe comunicar qué campo o restricción presenta el problema, conservar la información introducida y permitir corregirla y volver a guardar.

**5. Separar la creación de la publicación para estudiantes**

**Cómo está ahora:**

Después de guardar una lección, esta se incorpora inmediatamente al contenido utilizado por las APIs educativas locales y puede aparecer en `/aprender`.

La publicación remota sigue siendo una acción diferente, pero no existe una versión educativa local independiente de la versión que está editando el Administrador.

**Cómo debería estar:**

La nueva lección debe incorporarse primero al curso en edición.

Los estudiantes deben continuar viendo la versión anteriormente publicada hasta que el Administrador publique posteriormente los cambios del curso.

---

### CU-18 — Editar una lección

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede abrir una lección existente y modificar correctamente su título, contenido escrito, duración, recomendaciones, módulo y posición. Los cambios quedan guardados en SQLite y permanecen después de reiniciar Telar.

También puede editar normalmente una lección que no tenga ejemplo y, si ocurre un error durante el guardado, Telar conserva la versión anterior y permite volver a intentar.

Sin embargo, existen varios problemas en la edición de los recursos y configuración de la lección.

El más importante es que **editar una lección puede cambiar o borrar información que el Administrador nunca modificó**. Por ejemplo, si una lección tiene un video y su forma de completarse es mediante lectura (`viewed`), el Administrador puede entrar, cambiar solamente el título y guardar. Al hacerlo, Telar puede borrar el video y cambiar automáticamente la forma de completar la lección a `quiz`.

Además, todavía no puede agregarse un ejemplo desde la interfaz a una lección que no lo tenga ni eliminar un quiz existente. También faltan algunas protecciones frente a pérdida de cambios, algunos errores no explican claramente qué debe corregirse y los cambios guardados aparecen para los estudiantes antes de realizar una publicación.

**Qué falta:**

**1. Evitar que al editar una cosa se cambien otros datos de la lección**

**Cómo está ahora:**

El editor no carga ni permite editar algunos datos que una lección puede tener, especialmente:

- el video asociado;
- la forma en que se completa la lección (`quiz`, `viewed` o `run`).

El problema es que al guardar, Telar no simplemente deja esos datos como estaban.

Por ejemplo:

1. Una lección tiene un video.
2. La lección se completa mediante lectura (`viewed`).
3. El Administrador abre la lección.
4. Cambia únicamente el título.
5. Guarda.

Aunque nunca modificó el video ni la forma de completar la lección, Telar puede:

- eliminar el video;
- cambiar la forma de completarla a `quiz`.

**Cómo debería estar:**

Cuando el Administrador edite una lección, Telar debe conservar todos los datos que no fueron modificados.

Además, debe existir una forma de consultar y modificar el video y la regla de completitud cuando sea necesario.

**2. Permitir agregar un ejemplo a una lección que no lo tiene**

**Cómo está ahora:**

Una lección puede existir y editarse correctamente sin ejemplo ejecutable.

Sin embargo, si después el Administrador decide agregarle uno, no existe una opción funcional en la interfaz para hacerlo.

Incluso puede aparecer una acción que intenta abrir el editor usando un ejemplo que todavía no existe.

**Cómo debería estar:**

Si una lección no tiene ejemplo, Telar debería ofrecer una opción como:

**"Agregar ejemplo"**

Esta debe permitir crear el ejemplo y asociarlo a esa misma lección.

**3. Permitir eliminar el quiz de una lección**

**Cómo está ahora:**

El Administrador puede:

- crear un quiz;
- editar un quiz existente.

Sin embargo, no puede eliminarlo desde la interfaz.

La funcionalidad para borrarlo existe en el backend, pero no está conectada a ningún botón o acción disponible para el Administrador.

**Cómo debería estar:**

Debe existir una opción para eliminar el quiz asociado a la lección.

Después de eliminarlo, la lección debe poder seguir existiendo normalmente cuando su configuración no requiera un quiz.

**4. Proteger completamente los cambios sin guardar**

**Cómo está ahora:**

Telar sí advierte cuando el Administrador intenta navegar hacia otra pantalla teniendo cambios pendientes.

Sin embargo, existen otros caminos donde todavía pueden perderse los cambios sin advertencia, por ejemplo:

- recargar la página;
- cerrar la ventana o aplicación;
- algunos cambios de parámetros que hacen que el editor vuelva a cargar la información.

**Cómo debería estar:**

Si existen cambios sin guardar, Telar debe advertir antes de cualquier acción que pueda hacer que esos cambios se pierdan.

**5. Mostrar claramente qué dato es inválido**

**Cómo está ahora:**

Telar sí evita guardar información inválida y conserva el formulario para volver a intentarlo.

Sin embargo, en algunos casos muestra un mensaje demasiado genérico y el Administrador no sabe exactamente qué debe corregir.

Por ejemplo, puede existir un problema con el título o la duración, pero la interfaz simplemente informa que la información enviada no es válida.

**Cómo debería estar:**

El mensaje debe indicar de manera comprensible cuál es el problema, por ejemplo:

> "El título es obligatorio."

o:

> "La duración debe ser mayor a 0 minutos."

El Administrador debe poder corregir el dato y volver a guardar.

**6. Separar la edición de la publicación para estudiantes**

**Cómo está ahora:**

Cuando el Administrador guarda cambios en una lección, estos pasan inmediatamente al contenido utilizado por la vista de aprendizaje.

Por tanto, un estudiante puede recibir los cambios sin que el Administrador haya realizado todavía la publicación del curso.

**Cómo debería estar:**

Guardar debe modificar únicamente la versión del curso que está siendo editada.

Los estudiantes deben seguir viendo la última versión publicada hasta que el Administrador realice posteriormente la acción de publicar.

---

### CU-19 — Reordenar lecciones

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede cambiar el módulo y la posición de una lección desde su editor. Los cambios válidos quedan guardados en SQLite y permanecen después de reiniciar Telar.

Sin embargo, el reordenamiento todavía no funciona como una reorganización completa. Si el Administrador quiere mover una lección a una posición que ya está ocupada por otra, Telar no desplaza automáticamente las demás lecciones: simplemente rechaza la operación.

Además, cambiar únicamente el módulo o la posición puede modificar otros datos de la lección que el Administrador nunca quiso cambiar, y el nuevo orden queda disponible para los estudiantes antes de publicar el curso.

**Qué falta:**

**1. Reorganizar automáticamente las demás lecciones al mover una**

**Cómo está ahora:**

La interfaz permite escribir un nuevo número de orden.

Esto funciona solamente cuando la posición elegida está libre.

Por ejemplo, si existen:

1. Lección A
2. Lección B
3. Lección C

y el Administrador quiere mover la Lección C a la posición 2, Telar no mueve automáticamente a B hacia abajo.

En cambio, indica que la posición 2 ya está ocupada y rechaza el cambio.

Lo mismo ocurre al mover una lección entre módulos: si la posición deseada en el módulo destino ya está ocupada, no puede insertarse directamente allí.

El backend ya tiene una funcionalidad capaz de actualizar varias lecciones conjuntamente, pero actualmente no está conectada a la interfaz.

**Cómo debería estar:**

El Administrador debe poder seleccionar la posición deseada y Telar debe reorganizar automáticamente las demás lecciones afectadas.

Por ejemplo:

Antes:

1. A
2. B
3. C

Mover C a la posición 2 debería producir:

1. A
2. C
3. B

Esto debe funcionar tanto dentro del mismo módulo como al mover una lección hacia otro módulo.

**2. No modificar otros datos de la lección al cambiar su posición o módulo**

**Cómo está ahora:**

Mover una lección utiliza el mismo guardado del editor de CU-18.

Por ese motivo, cambiar únicamente su módulo o posición puede provocar cambios adicionales que el Administrador nunca solicitó.

Por ejemplo, una lección que tenga video y una regla de completitud determinada puede perder el video o cambiar su regla automáticamente al ser movida.

**Cómo debería estar:**

Cambiar el módulo o posición de una lección debe modificar únicamente su ubicación.

Su contenido, video, regla de completitud, ejemplo, quiz y demás información deben permanecer sin cambios.

**3. Validar correctamente la posición introducida**

**Cómo está ahora:**

Algunas posiciones inválidas pueden ser reinterpretadas por la interfaz.

Por ejemplo, introducir un valor decimal como `2.5` puede terminar convirtiéndose en `2` en lugar de ser rechazado.

Además, algunos errores de posición se muestran mediante mensajes demasiado genéricos.

**Cómo debería estar:**

Telar debe aceptar únicamente posiciones válidas y, cuando exista un problema, indicar claramente qué debe corregirse.

**4. Separar el reordenamiento de la publicación para estudiantes**

**Cómo está ahora:**

Después de guardar el nuevo módulo o posición de una lección, el cambio pasa inmediatamente al contenido utilizado por `/aprender`.

**Cómo debería estar:**

El nuevo orden debe quedar primero dentro del curso que está siendo editado.

Los estudiantes deben continuar viendo la organización anteriormente publicada hasta que el Administrador publique posteriormente los cambios.

---

### CU-20 — Eliminar una lección

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede eliminar una lección desde Autoría mediante una advertencia y confirmación previa.

Cuando confirma, Telar elimina correctamente la lección junto con los recursos educativos asociados que existan, como su contenido escrito, video asociado, ejemplo, código y quiz. También elimina referencias hacia esa lección desde otras recomendaciones.

La operación se realiza de forma transaccional: si algo falla, Telar hace rollback y conserva la lección y sus recursos.

Sin embargo, la advertencia actual afirma siempre que se eliminarán un ejemplo y un quiz, incluso cuando la lección no tiene esos recursos. Además, la eliminación se refleja inmediatamente para los estudiantes sin esperar a que el Administrador publique posteriormente los cambios del curso.

**Qué falta:**

**1. Mostrar una advertencia correcta según los recursos de la lección**

**Cómo está ahora:**

Antes de eliminar, Telar muestra una advertencia indicando que se eliminarán la lección, su ejemplo y su quiz.

El problema es que ese mismo mensaje aparece incluso cuando la lección:

- no tiene ejemplo;
- no tiene quiz;
- o no tiene ninguno de los dos.

Por tanto, la advertencia puede informar que se eliminarán recursos que en realidad no existen.

**Cómo debería estar:**

La advertencia debe describir correctamente las consecuencias de la eliminación.

Puede adaptarse a los recursos que realmente tenga la lección o utilizar un mensaje general como:

> "Se eliminará la lección y todos los recursos asociados. Esta acción no se puede deshacer."

**2. Separar la eliminación de la publicación para estudiantes**

**Cómo está ahora:**

Cuando el Administrador elimina una lección, esta también desaparece del contenido utilizado por `/aprender`.

Por tanto, los estudiantes pueden dejar de verla inmediatamente aunque el Administrador todavía no haya publicado los cambios del curso.

**Cómo debería estar:**

La eliminación debe aplicarse primero únicamente sobre el curso en edición.

Los estudiantes deben continuar viendo la versión anteriormente publicada hasta que el Administrador publique posteriormente los cambios.

---

### CU-21 — Editar un ejemplo

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede abrir un ejemplo existente y modificar su información, configuración y código. Telar carga correctamente los datos actuales, conserva los campos que no fueron modificados y guarda los cambios en SQLite.

También puede volver a abrir el ejemplo posteriormente y acceder desde allí al simulador para probarlo.

Sin embargo, existen problemas durante el guardado: cuando se modifican al mismo tiempo la información del ejemplo y su código, Telar los guarda mediante dos operaciones separadas. Por eso puede ocurrir que una parte se guarde correctamente y la otra falle.

Además, Telar no advierte al abandonar cambios sin guardar, algunos errores de validación son demasiado genéricos y los cambios guardados quedan disponibles en la superficie educativa local antes de publicar el curso.

**Qué falta:**

**1. Evitar que un mismo guardado deje el ejemplo actualizado solo a medias**

**Cómo está ahora:**

El botón **Guardar ejemplo** puede realizar dos operaciones diferentes:

- una para guardar la información y configuración;
- otra para guardar el código.

Estas operaciones se confirman por separado.

Por ejemplo:

1. El Administrador cambia el título.
2. También modifica el código.
3. Pulsa Guardar.
4. El nuevo título se guarda correctamente.
5. El código tiene un problema y no puede guardarse.

El resultado es que el título nuevo queda guardado, pero el código continúa siendo el anterior.

Aunque para el Administrador fue una sola acción de "Guardar", el ejemplo queda parcialmente actualizado.

**Cómo debería estar:**

Si el Administrador guarda información, configuración y código conjuntamente, Telar debe tratarlo como una sola edición.

O se guardan todos los cambios correctamente o, si alguna parte falla, debe conservarse completa la versión anterior.

**2. Advertir antes de abandonar cambios sin guardar**

**Cómo está ahora:**

Telar detecta internamente que existen modificaciones pendientes, pero esa información no se utiliza para impedir que se pierdan.

El Administrador puede modificar el ejemplo y luego:

- volver al panel;
- navegar a otra sección;
- abrir otro ejemplo;
- recargar;
- cerrar la aplicación;

sin recibir una advertencia.

**Cómo debería estar:**

Si existen cambios sin guardar, Telar debe advertir antes de abandonar la edición y permitir decidir entre permanecer o descartar las modificaciones.

**3. Mostrar claramente qué dato es inválido**

**Cómo está ahora:**

Telar sí rechaza información o configuraciones inválidas y mantiene el formulario para permitir un nuevo intento.

Sin embargo, algunos errores se muestran mediante mensajes demasiado genéricos y no indican qué dato debe corregirse.

**Cómo debería estar:**

Cuando una información, configuración o código sea rechazado, Telar debe indicar de forma comprensible qué debe corregirse y permitir volver a guardar.

**4. Separar la edición de la publicación para estudiantes**

**Cómo está ahora:**

Cuando el Administrador guarda cambios en un ejemplo, la nueva información, configuración y código pasan inmediatamente al contenido utilizado por las funcionalidades educativas locales.

Por tanto, los estudiantes pueden recibir esos cambios antes de que el Administrador publique el curso.

**Cómo debería estar:**

Los cambios deben quedar primero dentro del curso en edición.

Los estudiantes deben continuar utilizando la última versión publicada hasta que el Administrador publique posteriormente los cambios.

---

### CU-22 — Probar un ejemplo en el simulador

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador puede enviar un ejemplo al simulador, ejecutar una prueba real, observarla mientras está en curso, cancelarla, consultar sus resultados y realizar nuevas pruebas posteriormente.

También se evita que el Administrador pruebe accidentalmente cambios que todavía no ha guardado.

Sin embargo, actualmente no es posible mantener completamente separada la versión que el Administrador está preparando de la versión disponible para estudiantes. Además, una prueba administrativa modifica información del progreso educativo y existe un problema al cambiar rápidamente entre ejemplos desde el selector del simulador.

**Qué falta:**

**1. Permitir probar un ejemplo antes de ponerlo a disposición de los estudiantes**

**Cómo está ahora:**

Para probar un ejemplo desde Autoría, este debe estar habilitado.

Además, si el Administrador modifica el ejemplo, debe guardar los cambios antes de probarlos. Ese guardado hace que la nueva versión pase inmediatamente al contenido educativo local.

Por tanto, no puede realizarse correctamente el ciclo:

**editar → guardar → probar → corregir → volver a probar → publicar**

manteniendo mientras tanto la versión anterior para los estudiantes.

**Cómo debería estar:**

El Administrador debe poder guardar y probar una versión que todavía está en preparación sin hacerla disponible para los estudiantes.

Solo la publicación posterior debe actualizar la versión educativa.

**2. Evitar que una prueba administrativa modifique el progreso de aprendizaje**

**Cómo está ahora:**

Cuando una prueba realizada desde Autoría termina correctamente, Telar actualiza el registro de progreso de la lección guardando esa ejecución como `last_job_id` y actualizando su fecha.

No llega a marcar la lección como completada, pero igualmente modifica información perteneciente al progreso educativo.

**Cómo debería estar:**

Una prueba realizada por el Administrador debe generar normalmente su job, resultados y métricas, pero no debe modificar el progreso de aprendizaje de la lección.

**3. Mantener seleccionado el último ejemplo elegido en el simulador**

**Cómo está ahora:**

Desde el simulador pueden seleccionarse diferentes ejemplos.

Si el Administrador cambia rápidamente de un ejemplo a otro, las consultas se realizan de forma independiente.

Por ejemplo:

1. Selecciona el ejemplo A.
2. Inmediatamente selecciona B.
3. B termina de cargar primero.
4. Después termina la petición anterior de A.

En ese caso, la respuesta tardía de A puede volver a reemplazar a B aunque B haya sido la última selección del Administrador.

**Cómo debería estar:**

El simulador debe mantener siempre el último ejemplo seleccionado y evitar que una respuesta antigua sustituya una selección más reciente.

---

### CU-23 — Gestionar el contenido base

**Estado:** 🟡 **Parcial**

**Por qué:**

El Administrador dispone de herramientas por línea de comandos para cargar, actualizar, verificar y restablecer el contenido base de Telar.

La herramienta puede agregar contenido faltante, actualizar contenido existente, conservar contenido adicional cuando corresponde y eliminarlo únicamente cuando se solicita explícitamente un restablecimiento. Además, las modificaciones se realizan con rollback si ocurre un error.

Sin embargo, existen tres problemas: la operación de verificación puede modificar la base que se supone que solo está revisando, algunas actualizaciones pueden fallar cuando existen conflictos de posición y el restablecimiento no siempre devuelve completamente el contenido a su estado base original.

**Qué falta:**

**1. Hacer que la verificación sea realmente solo de consulta**

**Cómo está ahora:**

La opción utilizada para verificar el contenido abre la base con permisos de escritura y ejecuta procesos de actualización del esquema antes de realizar la comparación.

Esto significa que una operación cuyo objetivo es únicamente decir:

> "¿Mi contenido coincide con el contenido base?"

puede terminar modificando la base antes de responder.

Incluso podría crear una base nueva si se proporciona una ruta que todavía no existe.

**Cómo debería estar:**

La operación de verificación no debe realizar ningún cambio.

Debe únicamente consultar el estado actual y reportar:

- si coincide con el contenido base;
- qué contenido falta;
- qué contenido es diferente;
- qué contenido adicional existe;
- o qué problema impide realizar la comparación.

**2. Permitir actualizar o restablecer correctamente el orden del contenido**

**Cómo está ahora:**

Telar actualiza directamente la posición de cada módulo o lección hacia la posición definida en el contenido base.

Esto puede fallar cuando esa posición ya está ocupada.

Por ejemplo, si el contenido base establece:

1. Módulo A
2. Módulo B

Pero el Administrador anteriormente los dejó como:

1. Módulo B
2. Módulo A

al intentar restaurarlos, Telar puede intentar poner primero A en la posición 1 mientras B todavía ocupa esa posición.

La base rechaza el cambio y el restablecimiento no puede completarse.

También puede pasar cuando falta un elemento base pero su posición está actualmente ocupada por contenido adicional.

**Cómo debería estar:**

La actualización y el restablecimiento deben reorganizar el contenido de forma segura, resolviendo temporalmente los conflictos de posición.

Si se está actualizando normalmente, debe conservar el contenido adicional.

Si se solicitó un restablecimiento completo, debe poder retirar el contenido adicional y dejar finalmente el orden definido por el contenido base.

**3. Hacer que "Restablecer" realmente devuelva todo al estado base**

**Cómo está ahora:**

La herramienta puede terminar correctamente sin haber restaurado completamente el comportamiento original del contenido base.

Por ejemplo, si una lección perteneciente al contenido base fue archivada anteriormente, ejecutar el restablecimiento actualiza su información, pero puede dejarla todavía archivada.

Por tanto, la lección sigue sin aparecer normalmente en el recorrido educativo aunque forme parte del contenido base.

También existen algunos datos del módulo que la herramienta compara durante la verificación, pero no vuelve a sincronizar durante el restablecimiento.

**Cómo debería estar:**

Cuando el Administrador solicite restablecer el contenido base, Telar debe devolver todos los elementos base a su estado esperado.

Si una lección base debe estar activa, debe volver a estar activa.

Además, todos los datos que Telar utiliza para decidir si el contenido coincide con el baseline deben ser también restaurados por esa operación.

La herramienta solo debe informar éxito cuando el contenido haya quedado realmente en el estado base esperado.

---

### CU-24 — Gestionar una ejecución aislada

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar ejecuta el código dentro de contenedores aislados y aplica límites de seguridad y recursos. También controla la cantidad de ejecuciones simultáneas, captura `stdout` y `stderr`, obtiene métricas, maneja cancelación, timeout y exceso de memoria, guarda los resultados y elimina normalmente los recursos temporales al finalizar.

Sin embargo, existen varios escenarios de error en los que Telar puede registrar incorrectamente el resultado de una ejecución, perder la supervisión de un contenedor o dejar recursos sin limpiar.

**Qué falta:**

**1. Evitar que un error analizando los resultados cambie el resultado real de la ejecución**

**Cómo está ahora:**

Después de terminar un programa, Telar puede analizar su salida para obtener métricas o tiempos.

Si ese análisis falla, una ejecución que realmente terminó correctamente puede terminar registrada como fallida.

Por ejemplo:

- el programa termina con éxito;
- el parser no logra interpretar uno de los valores de salida;
- Telar termina registrando la ejecución como un error del sandbox.

**Cómo debería estar:**

El resultado real del programa debe conservarse.

Si únicamente falla el análisis posterior, Telar puede indicar que no pudo obtener las métricas interpretadas, pero no debe convertir una ejecución exitosa en una ejecución fallida.

**2. Detectar si falla el proceso encargado de capturar logs y métricas**

**Cómo está ahora:**

Telar utiliza una tarea interna encargada de recibir y procesar la salida y las métricas del contenedor.

Si esa tarea falla mientras el programa continúa ejecutándose, el proceso principal puede no darse cuenta inmediatamente.

En determinados casos la ejecución podría continuar sin supervisión adecuada.

**Cómo debería estar:**

Telar debe detectar si el proceso de supervisión falla o queda bloqueado.

Debe recuperar esa supervisión o finalizar la ejecución de forma controlada, conservando la información disponible y limpiando los recursos.

**3. Limpiar recursos creados parcialmente cuando falla la preparación**

**Cómo está ahora:**

Existen escenarios donde Telar comienza a preparar una ejecución pero falla antes de terminar.

Por ejemplo:

- crea el directorio temporal del job pero falla al escribir el código;
- crea parcialmente un contenedor pero ocurre un error de conexión antes de terminar de configurarlo.

En estos casos algunos recursos pueden quedar sin limpiar.

**Cómo debería estar:**

Cualquier recurso creado durante la preparación debe eliminarse también cuando la preparación falla a mitad del proceso.

**4. Mantener control de los recursos hasta comprobar que realmente fueron eliminados**

**Cómo está ahora:**

Al finalizar un job, Telar intenta eliminar su contenedor y archivos temporales.

Sin embargo, si esa limpieza falla, puede limitarse a registrar el problema y continuar como si el recurso ya estuviera liberado.

Además, el cupo de ejecución puede liberarse antes de terminar completamente esa limpieza.

**Cómo debería estar:**

Si un contenedor o recurso temporal no pudo eliminarse, Telar debe mantenerlo identificado y volver a intentar o manejar explícitamente ese problema.

Un contenedor que todavía pueda permanecer activo no debe dejar de contar como recurso ocupado.

**5. Recuperar el resultado si falla temporalmente el guardado en SQLite**

**Cómo está ahora:**

Cuando una ejecución termina, Telar intenta guardar su estado y resultados en SQLite.

Si esa operación falla, puede terminar sustituyendo el resultado real por un error interno.

Si también falla el segundo intento, el job puede desaparecer del seguimiento en memoria mientras su registro continúa apareciendo activo en la base.

**Cómo debería estar:**

Telar debe conservar el resultado real pendiente de guardar y volver a reconciliarlo cuando la persistencia esté disponible.

Un problema temporal de SQLite no debe convertir una ejecución exitosa en una ejecución fallida ni dejarla registrada indefinidamente como activa.

**6. Diferenciar un timeout de un fallo de comunicación con Docker**

**Cómo está ahora:**

Telar puede interpretar determinados errores de conexión con Docker como si el programa hubiera excedido su tiempo máximo.

Por tanto, una ejecución puede terminar registrada como `timeout` aunque el problema real haya sido de infraestructura.

**Cómo debería estar:**

Telar debe diferenciar:

- el programa realmente superó el tiempo máximo;
- se perdió la comunicación con Docker o ocurrió otro problema de infraestructura.

Cada caso debe quedar registrado con una causa coherente.

---

### CU-25 — Recuperar ejecuciones inconsistentes al iniciar

**Estado:** 🟡 **Parcial**

**Por qué:**

Cuando Telar inicia, ejecuta automáticamente un proceso de recuperación antes de comenzar a funcionar normalmente.

Este proceso identifica los jobs que quedaron en estados activos después de un cierre o reinicio inesperado y los marca como fallidos por interrupción. También conserva la información histórica que ya estaba guardada y busca contenedores y archivos temporales abandonados para eliminarlos.

Sin embargo, si la limpieza de esos recursos falla, Telar puede continuar iniciando aunque todavía existan contenedores o directorios pendientes de eliminar.

**Qué falta:**

**1. Limpiar los archivos temporales aunque Docker no esté disponible**

**Cómo está ahora:**

La limpieza de los directorios temporales de las ejecuciones está incluida dentro del proceso que también revisa Docker.

Si Docker no puede inicializarse, Telar igualmente corrige los jobs que quedaron activos, pero puede saltarse completamente la limpieza de los archivos temporales aunque esos archivos sí sean accesibles.

**Cómo debería estar:**

La limpieza de archivos temporales debe poder realizarse independientemente de Docker.

Aunque Docker esté caído, Telar debe retirar los directorios de ejecuciones anteriores que pueda identificar y eliminar de forma segura.

**2. Detectar cuando un directorio temporal realmente no pudo eliminarse**

**Cómo está ahora:**

Telar intenta borrar los directorios temporales, pero algunos errores durante esa eliminación pueden ser ignorados.

Incluso puede contabilizar un directorio como eliminado aunque todavía permanezca en el sistema.

**Cómo debería estar:**

Telar debe comprobar si la eliminación realmente fue exitosa.

Si un directorio no pudo eliminarse, debe registrarlo como recurso pendiente y dejar información suficiente para poder volver a intentarlo o diagnosticar el problema.

**3. Mantener bajo control los contenedores que no pudieron eliminarse**

**Cómo está ahora:**

Si Telar encuentra un contenedor abandonado e intenta eliminarlo, pero Docker devuelve un error, registra una advertencia y continúa el arranque.

El contenedor podrá volver a encontrarse en un reinicio posterior gracias a sus identificadores, pero durante la ejecución actual deja de existir un seguimiento activo de ese recurso pendiente.

Telar incluso puede empezar a aceptar nuevas ejecuciones aunque ese contenedor anterior todavía continúe consumiendo recursos.

**Cómo debería estar:**

Si un contenedor abandonado no pudo eliminarse, Telar debe mantener identificado ese pendiente.

Debe volver a intentar su eliminación o reflejar que la recuperación todavía no está completamente resuelta antes de considerar el entorno totalmente disponible para nuevas ejecuciones.

---

### CU-26 — Reportar salud del sistema

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar dispone de un endpoint de salud que comprueba la base de datos, Docker y la imagen necesaria para ejecutar código. También cuenta con una consulta adicional que informa capacidades y límites del sistema.

El reporte funciona correctamente en los escenarios normales y permite indicar, por ejemplo, que el backend está funcionando aunque Docker no esté disponible.

Sin embargo, existen situaciones donde Telar no puede distinguir correctamente la causa de un problema, puede tardar demasiado en responder o puede mantener información desactualizada sobre Docker.

**Qué falta:**

**1. Diferenciar cuando la imagen del runner no existe de cuando no pudo comprobarse**

**Cómo está ahora:**

Si Telar consulta la imagen necesaria para ejecutar código y no la encuentra, reporta:

`runner_image = false`

Pero muestra exactamente el mismo resultado si ocurrió un error al intentar comprobarla, por ejemplo por un problema de conexión o permisos.

Por tanto, no puede distinguir entre:

- "la imagen definitivamente no está instalada";
- "no pude comprobar si está instalada".

**Cómo debería estar:**

El reporte debe permitir distinguir una ausencia confirmada de una comprobación que no pudo realizarse.

**2. Evitar que las comprobaciones de Docker bloqueen demasiado el reporte de salud**

**Cómo está ahora:**

Las consultas hacia Docker pueden esperar hasta 120 segundos y se ejecutan de manera bloqueante.

Sin embargo, Docker Compose espera únicamente unos pocos segundos por la respuesta del healthcheck.

Por tanto, si Docker no responde, el consumidor puede abandonar la consulta antes de que Telar alcance a informar cuál es el problema.

**Cómo debería estar:**

Las comprobaciones deben tener un tiempo de espera razonable y no bloquear el backend.

Si Docker no responde a tiempo, Telar debe devolver el resto del reporte e indicar que ese componente no pudo comprobarse.

**3. Volver a comprobar Docker si no estaba disponible durante el arranque**

**Cómo está ahora:**

Si Telar inicia cuando Docker no está disponible y no logra crear inicialmente su conexión con Docker, conserva ese estado.

Aunque Docker vuelva a funcionar después, las consultas posteriores pueden continuar indicando que no está disponible hasta reiniciar Telar.

**Cómo debería estar:**

Telar debe poder volver a intentar la conexión con Docker y actualizar el estado reportado cuando el servicio vuelva a estar disponible.

**4. Informar cuando quedaron recursos pendientes de una recuperación**

**Cómo está ahora:**

Durante el arranque puede ocurrir que Telar detecte un contenedor antiguo pero no logre eliminarlo.

Ese contenedor puede continuar consumiendo recursos.

Sin embargo, después del arranque los checks de base de datos, Docker e imagen pueden aparecer todos como correctos y no indicar que todavía existe un recurso pendiente de recuperación.

**Cómo debería estar:**

Si un recurso pendiente afecta la capacidad segura para ejecutar nuevos jobs, Telar debe reflejar esa condición dentro de su información operativa hasta que sea solucionada.

---

### CU-27 — Iniciar la aplicación de escritorio

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar dispone de una aplicación de escritorio empaquetable que carga su interfaz y prepara automáticamente los servicios necesarios para funcionar.

En el flujo normal, el usuario no necesita abrir una terminal ni ejecutar manualmente `docker compose`, iniciar el backend o levantar el frontend.

Sin embargo, existen escenarios donde Telar considera que el entorno ya está preparado cuando en realidad solo una parte está funcionando. También tiene problemas para continuar automáticamente la preparación si Docker aparece después del primer intento y algunos errores de inicio no se comunican correctamente al usuario.

**Qué falta:**

**1. Comprobar que todo lo necesario esté realmente preparado antes de dar por terminado el inicio**

**Cómo está ahora:**

Telar considera que el entorno está disponible si encuentra al menos un servicio de Compose ejecutándose.

Esto significa que puede ocurrir:

- algún servicio está encendido;
- el backend todavía no está listo;
- falta la imagen necesaria para ejecutar código;

y aun así Telar puede omitir parte de la preparación automática.

**Cómo debería estar:**

Antes de considerar completado el inicio, Telar debe comprobar los componentes que realmente necesita.

Si algo falta y puede prepararlo automáticamente, debe hacerlo.

Si no puede prepararlo, debe informar claramente qué funcionalidad está limitada.

**2. Continuar automáticamente la preparación cuando Docker vuelva a estar disponible**

**Cómo está ahora:**

Si Telar se abre mientras Docker todavía no está disponible, detecta el problema.

Sin embargo, aunque posteriormente Docker comience a funcionar, Telar no vuelve automáticamente a iniciar la preparación pendiente.

El usuario debe utilizar manualmente los controles disponibles para levantar los servicios.

**Cómo debería estar:**

Si la preparación automática quedó pendiente porque Docker no estaba disponible, Telar debe continuarla cuando detecte que Docker ya está funcionando.

Esto debe diferenciarse de un caso donde el usuario haya detenido explícitamente los servicios.

**3. Comprobar que la imagen necesaria para ejecutar código realmente quedó preparada**

**Cómo está ahora:**

Durante el inicio Telar intenta preparar la imagen del runner.

Sin embargo:

- algunos errores durante la descarga pueden ignorarse;
- no siempre comprueba después si la imagen realmente quedó disponible;
- si encuentra algún servicio ya encendido, puede omitir completamente esta preparación.

Por tanto, el usuario puede entrar normalmente a Telar y descubrir que falta el runner únicamente cuando intenta ejecutar código.

**Cómo debería estar:**

Durante el inicio Telar debe comprobar si la imagen necesaria para las ejecuciones está disponible.

Si falta:

- debe intentar prepararla cuando corresponda;
- o debe informar claramente que la ejecución de código todavía no está disponible y ofrecer una forma de reintentar.

**4. Mostrar la causa real cuando la preparación inicial no puede comenzar**

**Cómo está ahora:**

La comprobación inicial puede detectar problemas como:

- Docker no disponible;
- falta de permisos;
- error de Compose.

Pero parte de esa información se pierde antes de mostrarse en la interfaz.

El usuario puede terminar viendo simplemente que los servicios están detenidos sin entender por qué Telar no logró iniciarlos.

**Cómo debería estar:**

Telar debe conservar el motivo del fallo y mostrar un mensaje comprensible que permita saber qué está impidiendo continuar y cómo volver a intentarlo.

**5. Manejar el fallo de carga de la propia interfaz**

**Cómo está ahora:**

Si Electron no logra cargar los archivos de la interfaz, no existe un flujo específico que informe el problema o permita volver a intentar.

Esto es especialmente problemático porque, si la interfaz no carga, tampoco pueden aparecer los controles normales de diagnóstico.

**Cómo debería estar:**

La aplicación de escritorio debe detectar el fallo de carga de la interfaz y mostrar una indicación independiente que permita diagnosticar o volver a intentar el inicio.

---

### CU-28 — Realizar un taller guiado

**Estado:** 🔴 **No implementado**

**Por qué:**

Telar ya tiene varias funcionalidades que podrían utilizarse para construir talleres: las lecciones muestran contenido educativo, existen ejemplos ejecutables, el estudiante puede modificar código en el simulador, ejecutar programas y consultar sus resultados.

Sin embargo, actualmente **no existe un taller como actividad funcional dentro de Telar**.

No existe una actividad asociada a una lección que tenga sus propias instrucciones, recursos, estado de avance y condiciones para considerarse realizada. Tampoco existe una forma de retomar un taller incompleto ni de hacer que completar un taller contribuya a la completitud de una lección.

Actualmente el recorrido existente es:

**Lección → Ejemplo → Simulador → Resultados**

pero esas funcionalidades no están conectadas como un **taller guiado**.

**Qué falta:**

**1. Implementar el taller como una actividad identificable dentro de una lección**

**Cómo está ahora:**

Una lección puede tener:

- contenido escrito;
- video;
- ejemplo;
- quiz;
- recomendaciones.

Pero no existe una actividad diferenciada que Telar reconozca como taller.

**Cómo debería estar:**

Una lección debe poder tener opcionalmente un taller asociado.

El estudiante debe poder identificarlo y acceder a una actividad que tenga, como mínimo:

- propósito;
- instrucciones;
- recursos necesarios;
- condiciones para considerarla realizada.

No es obligatorio crear una pantalla o tabla llamada literalmente `Taller`, pero sí debe existir funcionalmente esa actividad.

**2. Permitir talleres con código y talleres sin código**

**Cómo está ahora:**

Telar permite lecciones conceptuales sin ejemplo y también permite ejecutar ejemplos en el simulador.

Sin embargo, ninguna de esas dos cosas corresponde actualmente a un taller.

**Cómo debería estar:**

Un taller debe poder funcionar según la actividad definida.

Si no requiere código, el estudiante debe poder seguir las instrucciones y completarlo sin utilizar el simulador.

Si requiere código, debe poder:

- consultar o modificar el código;
- configurar la ejecución cuando corresponda;
- ejecutarlo;
- revisar los resultados;
- realizar ajustes;
- volver a ejecutar.

Todo esto debe mantenerse dentro del contexto del taller que está realizando.

**3. Guardar el estado del taller y permitir retomarlo**

**Cómo está ahora:**

Telar guarda progreso de las lecciones y resultados de las ejecuciones, pero no guarda información que permita saber:

- qué taller comenzó el estudiante;
- si quedó incompleto;
- si ya fue realizado.

Por tanto, abandonar una supuesta actividad y volver posteriormente no recupera un estado de taller.

**Cómo debería estar:**

Telar debe conservar el estado necesario de la actividad.

Si el estudiante abandona un taller antes de terminarlo, debe poder volver posteriormente y continuar con ese taller todavía pendiente.

**4. Definir cuándo un taller está realizado**

**Cómo está ahora:**

Las únicas reglas de completitud existentes para las lecciones son:

- `quiz`;
- `viewed`;
- `run`.

No existe una condición de realización propia de un taller.

Tampoco existe una asociación que permita saber que determinada ejecución del simulador ocurrió como parte de un taller específico.

**Cómo debería estar:**

Cada taller debe tener una condición que permita determinar cuándo fue realizado.

Esta condición debe aplicarse al taller correcto.

Por ejemplo, una ejecución independiente en el simulador no debe completar accidentalmente un taller simplemente porque pertenece a la misma lección.

**5. Integrar la realización del taller con el progreso de la lección**

**Cómo está ahora:**

Una lección no puede indicar que realizar un taller sea uno de sus requisitos.

Por tanto, aunque el estudiante utilice el simulador y realice una actividad práctica por su cuenta, Telar no puede registrar esa actividad como cumplimiento de un taller requerido.

**Cómo debería estar:**

Cuando una lección defina que su taller es un requisito, completar ese taller debe contribuir a su progreso y completitud.

Si el taller es opcional, completarlo no debe alterar incorrectamente la condición de la lección.

**6. Manejar errores dentro del recorrido del taller**

**Cómo está ahora:**

Existen controles de error para funcionalidades individuales como cargar una lección o ejecutar código.

Pero como no existe un taller, tampoco existe manejo de errores asociado al estado de esa actividad.

**Cómo debería estar:**

Si ocurre un problema durante el taller —por ejemplo, falla una ejecución o no puede guardarse su progreso— el estudiante debe poder continuar o reintentar sin que Telar marque falsamente la actividad como realizada.

---

### CU-29 — Seguir la progresión recomendada del curso

**Estado:** 🟡 **Parcial**

**Por qué:**

El Estudiante puede recorrer el curso siguiendo una secuencia definida de módulos y lecciones, avanzar y retroceder incluso entre módulos y acceder directamente a contenido posterior sin completar lo anterior.

Telar también recuerda localmente cuál fue la última lección visitada para permitir retomarla posteriormente.

Sin embargo, existen problemas cuando cambia la disponibilidad del contenido. Algunas lecciones retiradas o deshabilitadas siguen apareciendo o formando parte de la navegación y la opción **Continuar/Empezar** puede terminar enviando al estudiante hacia una lección fija que ya no existe o que no corresponde al curso actual.

**Qué falta:**

**1. Aplicar de forma coherente qué contenido está disponible para el estudiante**

**Cómo está ahora:**

Telar no trata igual todos los estados de una lección.

Por ejemplo:

- una lección archivada deja de participar en **Anterior/Siguiente**, pero puede continuar apareciendo en el catálogo o sidebar;
- una lección con `enabled=false` todavía puede abrirse directamente y también puede formar parte de la secuencia de navegación.

Esto puede producir situaciones donde la estructura visible muestra contenido que realmente ya no debería formar parte del recorrido actual.

**Cómo debería estar:**

El catálogo, la selección directa y la navegación **Anterior/Siguiente** deben utilizar la misma regla para determinar qué contenido está disponible.

Si una lección fue retirada de la progresión, no debe continuar apareciendo como si fuera una lección vigente del curso.

**2. Hacer que "Continuar/Empezar" siempre seleccione una lección válida**

**Cómo está ahora:**

Telar recuerda correctamente la última lección visitada.

Pero si esa lección ya no existe en el contenido actual, utiliza como alternativa fija:

`primerEjemplo`

El problema es que esa lección:

- puede no existir;
- puede no estar disponible;
- puede haber dejado de ser la primera después de un reordenamiento.

Por tanto, **Continuar/Empezar** puede llevar a una ruta que termina en error aunque existan otras lecciones válidas.

**Cómo debería estar:**

Telar debe comprobar primero que la última lección visitada siga disponible.

Si ya no lo está, debe seleccionar una alternativa válida del contenido actual —por ejemplo, la primera lección disponible de la secuencia— o permitir al estudiante escoger desde el catálogo.

No debe depender de un ID fijo que puede no existir.

---

### CU-30 — Comparar ejecuciones

**Estado:** 🔴 **No implementado**

**Por qué:**

Telar permite consultar el historial de ejecuciones y abrir los resultados de cada job individualmente. También existen gráficas y métricas dentro del resultado de una sola ejecución.

Sin embargo, actualmente no existe una funcionalidad que permita seleccionar varias ejecuciones históricas y compararlas conjuntamente.

No existe selección múltiple, no hay reglas para determinar si los jobs escogidos son comparables y tampoco existe una vista que reúna sus configuraciones, resultados y métricas.

**Qué falta:**

**1. Permitir seleccionar varias ejecuciones históricas**

**Cómo está ahora:**

En el historial, cada ejecución tiene una opción para abrir su detalle individual.

No existe una forma de seleccionar dos o más jobs para analizarlos juntos.

**Cómo debería estar:**

El Estudiante debe poder seleccionar al menos dos ejecuciones históricas, agregar o retirar jobs de la selección e iniciar una comparación con los jobs escogidos.

**2. Definir y validar cuándo las ejecuciones pueden compararse**

**Cómo está ahora:**

Telar no tiene reglas que determinen si varias ejecuciones pertenecen a un experimento que tenga sentido comparar.

Por tanto, tampoco puede detectar una selección incompatible.

**Cómo debería estar:**

Telar debe definir criterios de comparabilidad según el tipo de ejecución.

Antes de mostrar una comparación debe comprobar esos criterios.

Si las ejecuciones seleccionadas no pueden compararse, debe explicar el problema y permitir modificar la selección.

**3. Mostrar conjuntamente configuraciones, resultados y métricas**

**Cómo está ahora:**

El historial muestra algunos datos básicos de cada job y el detalle individual contiene información más completa.

Pero el Estudiante debe revisar cada ejecución por separado.

Las gráficas actuales también corresponden únicamente a los datos internos de una sola ejecución.

**Cómo debería estar:**

Telar debe presentar conjuntamente la información disponible de las ejecuciones seleccionadas para que puedan contrastarse.

La comparación debe incluir, cuando existan:

- configuraciones;
- resultados;
- estados;
- tiempos;
- métricas disponibles.

Si una ejecución no posee algún dato, debe mostrarse como información ausente y no inventarse un valor como `0`.

Cuando existan datos adecuados, pueden mostrarse visualizaciones comparativas.

**4. Completar el flujo de navegación y manejo de errores de la comparación**

**Cómo está ahora:**

Como no existe una comparación, tampoco existe una forma de:

- abrir desde ella el detalle de uno de los jobs;
- corregir la selección;
- manejar un job inexistente;
- reintentar si falla la carga de alguno de los elementos.

**Cómo debería estar:**

Desde la comparación debe poder abrirse el detalle individual de cada ejecución correspondiente.

Si una selección tiene problemas o un job no puede recuperarse, Telar debe informar la situación y permitir modificar la selección o volver a intentar.

---

### CU-31 — Exportar resultados y métricas de ejecuciones

**Estado:** 🔴 **No implementado**

**Por qué:**

Telar permite descargar la salida textual de una ejecución mediante CU-10, incluyendo `stdout` y `stderr`.

También conserva en la base de datos información suficiente para construir una exportación más completa, como configuración, estado, duración, métricas y resultados interpretados.

Sin embargo, actualmente no existe una funcionalidad que permita al Estudiante exportar esa información estructurada para utilizarla fuera de Telar.

**Qué falta:**

**1. Implementar una exportación completa de una ejecución**

**Cómo está ahora:**

La única opción disponible descarga un archivo `.txt` con:

- `stdout`;
- `stderr`;
- aviso de truncamiento cuando corresponde.

No incluye información como:

- configuración utilizada;
- estado final;
- duración;
- exit code;
- causa de finalización;
- métricas de CPU;
- memoria;
- procesos;
- tiempos interpretados;
- speedup o eficiencia cuando existen.

**Cómo debería estar:**

El Estudiante debe disponer de una opción para exportar una ejecución con la información disponible de sus tres categorías:

- configuración;
- resultados;
- métricas.

No se exige un formato específico. Puede utilizarse JSON, CSV u otro formato que pueda conservarse y analizarse fuera de Telar.

**2. Manejar correctamente la información que no esté disponible**

**Cómo está ahora:**

Como la exportación completa no existe, tampoco existe un tratamiento definido para los campos opcionales.

Una ejecución puede no tener, por ejemplo:

- métricas;
- tiempos interpretados;
- exit code;
- ejemplo asociado;
- determinados resultados.

**Cómo debería estar:**

La exportación debe incluir los datos que realmente existan.

Cuando un dato no esté disponible, debe mantenerse como ausente y no reemplazarse por valores inventados como `0`.

La falta de una métrica opcional tampoco debe impedir exportar el resto de la ejecución.

**3. Manejar errores y permitir volver a intentar la exportación**

**Cómo está ahora:**

Existen controles de error para la descarga textual de CU-10, pero no existe un flujo de generación de la exportación completa.

**Cómo debería estar:**

Si no puede generarse o entregarse la exportación, Telar debe informar el problema al Estudiante y permitir realizar nuevamente la operación.

El fallo no debe modificar la ejecución histórica ni mostrar una exportación como exitosa cuando no fue generada.

---

### CU-32 — Guardar y reutilizar una configuración de ejecución

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar permite reutilizar parcialmente una ejecución anterior mediante la opción **Re-ejecutar**. Desde los resultados, el estudiante puede volver al simulador con el ejemplo relacionado o con el código utilizado anteriormente, modificarlo y crear una nueva ejecución.

Sin embargo, no existe una funcionalidad para guardar configuraciones independientemente del historial. Además, al utilizar **Re-ejecutar** no se recupera toda la configuración original de la ejecución.

**Qué falta:**

**1. Permitir guardar configuraciones independientemente de las ejecuciones históricas**

**Cómo está ahora:**

Para poder reutilizar una preparación debe existir primero un job.

No existe una opción para:

- preparar una ejecución;
- guardar esa configuración sin ejecutarla;
- consultar posteriormente las configuraciones guardadas;
- seleccionar una de ellas y recuperarla.

Por tanto, las configuraciones reutilizables dependen completamente del historial de ejecuciones.

**Cómo debería estar:**

El Estudiante debe poder guardar explícitamente una configuración desde el simulador sin necesidad de ejecutarla.

Esa configuración debe permanecer disponible para usos posteriores de Telar y poder seleccionarse nuevamente para cargar sus opciones en el simulador.

Modificarla para preparar una nueva ejecución no debe modificar automáticamente la configuración guardada original.

**2. Recuperar correctamente la configuración histórica al utilizar "Re-ejecutar"**

**Cómo está ahora:**

La ejecución histórica sí conserva información como:

- código;
- ejemplo asociado;
- número de hilos;
- timeout;
- filename.

Sin embargo, **Re-ejecutar no recupera toda esa información**.

Actualmente:

- `threads` vuelve a un valor inicial por defecto;
- `timeout` vuelve al valor por defecto;
- para código propio se recuperan código y filename;
- para un ejemplo se carga nuevamente la versión actual del ejemplo.

Por tanto, una ejecución que originalmente utilizó una configuración concreta puede terminar preparada con valores diferentes sin que el Estudiante sea advertido.

**Cómo debería estar:**

Al utilizar **Re-ejecutar**, Telar debe recuperar las opciones relevantes de la ejecución histórica.

Si alguna opción ya no puede utilizarse porque los límites o capacidades actuales cambiaron, debe informar al Estudiante para que pueda ajustarla antes de ejecutar.

Si se utiliza la versión actual del ejemplo en lugar de la versión histórica, también debe quedar claro que el contenido cambió.

**3. Evitar modificar silenciosamente una opción antes de crear el nuevo job**

**Cómo está ahora:**

Puede ocurrir que el simulador muestre un número de hilos superior al máximo permitido actualmente.

Al ejecutar, Telar reduce internamente ese número al máximo disponible sin necesariamente actualizar el valor mostrado ni advertir al Estudiante.

Por ejemplo:

- la interfaz muestra `threads = 4`;
- el sistema actual permite máximo `2`;
- al crear el job se envían `2`.

Por tanto, la ejecución realizada no coincide exactamente con la configuración que el Estudiante creía estar utilizando.

**Cómo debería estar:**

Si una configuración recuperada contiene un valor que ya no es válido, Telar debe mostrarlo claramente antes de ejecutar.

El Estudiante debe poder corregirlo o aceptar explícitamente el ajuste, y la configuración visible debe coincidir con la configuración que finalmente recibe el nuevo job.

---

### CU-33 — Instalar Telar

**Estado:** 🟢 **Implementado**

**Por qué:**

El Estudiante dispone de un recorrido real para obtener e instalar Telar:

**Página pública de descargas → GitHub Releases → instalador correspondiente → aplicación Telar instalada.**

Actualmente existen distribuciones públicas para Windows y Linux. El paquete incluye la aplicación de escritorio, el frontend y los recursos necesarios para que posteriormente pueda iniciarse Telar mediante CU-27.

La instalación también se mantiene correctamente separada de la descarga de cursos: instalar Telar no selecciona ni incorpora automáticamente un curso.

**Qué falta:**

Nada funcional requerido por CU-33.

**Pendiente de validación:**

No existe evidencia versionada suficiente de una prueba completa de la versión actual que recorra:

**descargar → instalar → abrir Telar**

en Windows y Linux.

Esto debe considerarse una validación/QA pendiente, pero no cambia el estado del caso de uso porque no se encontró un defecto funcional concreto en el mecanismo de instalación.

---

### CU-34 — Explorar catálogo de cursos disponibles

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar dispone de un catálogo remoto real y separado del contenido que ya está incorporado localmente.

El Usuario puede consultar publicaciones disponibles, ver información como título, descripción, nivel, versión, cantidad de lecciones, autor y otros datos generales. El catálogo también diferencia correctamente estados como disponible, incorporado, actualización disponible o publicación retirada.

Sin embargo, actualmente el Usuario no puede abrir el detalle de una publicación antes de incorporarla, aunque el backend ya dispone de esa información.

**Qué falta:**

**1. Permitir consultar el detalle de una publicación antes de incorporarla**

**Cómo está ahora:**

Las tarjetas del catálogo muestran información general y permiten directamente **Incorporar**.

El backend ya dispone de una operación que obtiene información más detallada y un preview del contenido, pero esa operación no está conectada a ninguna pantalla de la interfaz.

Por tanto, actualmente el recorrido es:

**Catálogo → publicación → Incorporar**

y falta:

**Catálogo → publicación → Detalle → volver / continuar**

**Cómo debería estar:**

El Estudiante y el Administrador deben poder seleccionar una publicación y consultar su información ampliada y contenido general antes de decidir qué hacer con ella.

Desde ese detalle deben poder regresar al catálogo o continuar posteriormente con la acción correspondiente.

**2. Manejar correctamente una publicación que deja de estar disponible al consultar su detalle**

**Cómo está ahora:**

Como no existe una vista de detalle conectada, tampoco existe el flujo visual donde Telar pueda informar que una publicación seleccionada ya no está disponible.

Además, el endpoint de detalle puede utilizar información de catálogo almacenada en caché, por lo que una publicación retirada podría continuar resolviéndose temporalmente mientras su bundle todavía exista.

**Cómo debería estar:**

Al intentar consultar una publicación que ya no se encuentra disponible, Telar debe informar la situación y permitir regresar al catálogo.

La existencia física del bundle no debe confundirse con que la publicación continúe vigente en el catálogo.

**3. No ocultar publicaciones simplemente porque coinciden con contenido local**

**Cómo está ahora:**

Si una publicación remota tiene el mismo identificador que contenido local cuyo origen no fue una incorporación remota, Telar puede clasificarla como `local_only` y eliminarla de la pantalla.

Por ejemplo:

- existe localmente el módulo `paralelismo`;
- el catálogo publica también `paralelismo`;
- Telar puede ocultar completamente la publicación remota.

Incluso podría terminar mostrando que no existen publicaciones aunque el catálogo remoto sí tenga contenido.

**Cómo debería estar:**

La publicación remota debe continuar siendo visible y consultable.

Si existe algún conflicto con el contenido local, esa situación puede afectar posteriormente la incorporación, pero no debe impedir descubrir la publicación ni consultar su información.

---

### CU-35 — Descargar e incorporar un curso a Telar

**Estado:** 🟢 **Implementado**

**Por qué:**

El Estudiante puede seleccionar una publicación del catálogo e incorporarla mediante un flujo completo y conectado.

Telar conserva la identidad, versión y checksum de la publicación seleccionada, descarga realmente su bundle remoto, valida su estructura e integridad antes de escribirlo y realiza la incorporación mediante una única transacción.

Si ocurre un fallo durante la validación o escritura, la operación se revierte y el contenido no queda presentado como correctamente incorporado.

Además:

- evita incorporar nuevamente la misma publicación;
- protege contenido local existente frente a colisiones;
- registra la incorporación junto con el contenido;
- actualiza el contenido disponible sin exigir reiniciar Telar;
- deja módulos, lecciones, ejemplos y quizzes disponibles localmente;
- conserva el contenido después de reiniciar;
- permite seguir utilizando el contenido incorporado aunque posteriormente no exista conexión con el catálogo;
- informa los errores y permite volver a intentar.

Por tanto, se cumplen los comportamientos funcionales vigentes de CU-35.

**Qué falta:**

Nada funcional requerido específicamente por CU-35.

**Problema relacionado que no cambia el estado:**

Existe un problema de identidad del progreso histórico.

Si una publicación anterior fue retirada pero se conservó el progreso de una de sus lecciones, una publicación diferente que posteriormente reutilice el mismo `lesson_id` puede heredar ese progreso.

Ejemplo:

Publicación A contiene `leccion-1` → el Estudiante la completa → A se elimina → posteriormente una publicación B diferente utiliza también `leccion-1`.

Actualmente B puede recuperar el progreso histórico de A porque el progreso se identifica únicamente mediante `lesson_id`.

Esto debe corregirse para evitar atribuir progreso de contenido diferente, pero corresponde a la gestión/identidad del progreso y no impide que CU-35 cumpla sus requisitos de descarga, validación, incorporación y disponibilidad local. (Se aborda en CU-38.2.)

---

### CU-36 — Descargar un curso para edición

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar permite al Administrador importar una publicación real desde el catálogo, validarla y dejar su contenido disponible dentro de Autoría.

La importación es transaccional, maneja errores y permite posteriormente modificar módulos, lecciones, ejemplos y quizzes.

Sin embargo, el contenido obtenido para edición se almacena en las mismas estructuras que utiliza la experiencia de aprendizaje. Por tanto, guardar modificaciones en Autoría puede hacer que estas aparezcan inmediatamente en **Aprender**, aunque el Administrador todavía no haya publicado el curso.

También existen problemas para garantizar que se importe exactamente la versión seleccionada y para identificar que una publicación ya posee una copia de trabajo equivalente.

**Qué falta:**

**1. Separar la versión en edición del contenido utilizado para aprendizaje**

**Cómo está ahora:**

El contenido importado para Autoría se guarda en las mismas tablas y en el mismo snapshot que consultan las APIs de aprendizaje.

Por ejemplo:

- publicación remota: título `A`;
- Administrador importa y cambia el título a `B`;
- guarda el cambio sin publicar;
- `Aprender` en esa misma instalación ya consulta `B`.

La publicación remota continúa siendo `A`, pero localmente no existe una separación entre contenido editable y contenido disponible para aprendizaje.

**Cómo debería estar:**

Los cambios guardados en Autoría deben mantenerse en una **versión de trabajo**.

Mientras el Administrador no ejecute CU-37 — Publicar un curso:

- Autoría debe consultar los cambios de la versión de trabajo;
- el contenido utilizado para aprendizaje debe continuar mostrando la versión publicada/anterior correspondiente.

Guardar no debe hacer visibles automáticamente los cambios.

**2. Importar exactamente la versión seleccionada por el Administrador**

**Cómo está ahora:**

El diálogo muestra la versión de la publicación que el Administrador está seleccionando.

Sin embargo, al confirmar la importación solamente envía principalmente su identificador y no conserva la versión ni el checksum mostrados.

Por tanto, puede ocurrir:

1. el Administrador ve `Curso A v1`;
2. aparece remotamente `v2`;
3. pulsa importar;
4. Telar termina obteniendo `v2`.

El cambio puede ocurrir sin informar que ya no se obtuvo exactamente lo que había seleccionado.

**Cómo debería estar:**

La solicitud de importación debe quedar anclada a la identidad de la publicación seleccionada, incluyendo versión/checksum cuando corresponda.

Si esa publicación ya cambió, Telar debe:

- obtener exactamente la versión seleccionada cuando todavía exista;
- o informar que la publicación cambió y solicitar actualizar la selección.

No debe sustituirla silenciosamente.

**3. Detectar cuando ya existe una versión de trabajo de la misma publicación**

**Cómo está ahora:**

La importación vinculada evita repetir exactamente el mismo ID.

Sin embargo, el Administrador también puede crear copias independientes con nuevos IDs.

Estas copias no conservan suficiente información sobre la publicación de origen para reconocer que ya existe otra versión de trabajo equivalente.

Por ejemplo, una misma publicación podría terminar importada como:

`curso-copia1`

y posteriormente como:

`curso-copia2`

sin que Telar detecte que ambas provienen de la misma publicación.

**Cómo debería estar:**

Telar debe conservar identidad suficiente sobre la publicación de origen para detectar que ya existe una versión de trabajo.

Si ya existe, debe informar la situación y evitar crear automáticamente otra copia equivalente.

Crear una bifurcación independiente puede continuar existiendo como funcionalidad adicional, pero debe ser una decisión diferenciada y no sustituir la detección requerida.

---

### CU-37 — Publicar un curso

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar dispone de una acción de publicación real y diferente de Guardar.

El Administrador puede revisar una publicación mediante un ensayo previo, confirmarla y posteriormente Telar genera el bundle, lo sube al proveedor remoto y actualiza el índice del catálogo.

Además, el orden de publicación protege correctamente el catálogo: primero se asegura el bundle y únicamente después se anuncia la nueva versión en el índice.

Sin embargo, todavía existen escenarios donde puede publicarse contenido inválido, confirmarse un contenido distinto al revisado o quedar una publicación remota en un estado difícil de recuperar después de un fallo.

**Qué falta:**

**1. Validar la publicación con las mismas reglas necesarias para poder incorporarla**

**Cómo está ahora:**

El publicador valida el esquema general y varias condiciones del contenido, pero no ejecuta todas las validaciones que posteriormente utiliza CU-35 al incorporar el bundle.

Por ejemplo, puede llegar a publicar una lección con regla de completitud `quiz` sin un quiz válido, o conservar órdenes de lecciones que el importador posteriormente rechaza.

Por tanto, Telar puede producir una publicación que aparece correctamente en el catálogo pero que otro usuario no puede incorporar.

**Cómo debería estar:**

Antes de permitir la confirmación final, Telar debe validar el artefacto generado con las reglas necesarias para garantizar que pueda ser consumido nuevamente por Telar.

Si existe un problema, debe identificar qué elemento o condición debe corregir el Administrador y no publicar el bundle.

**2. Vincular la confirmación con el contenido que el Administrador revisó**

**Cómo está ahora:**

El Administrador primero realiza un ensayo y ve qué se publicará.

Sin embargo, esa confirmación no conserva una identidad del contenido revisado, como su checksum, versión o snapshot.

Puede ocurrir:

`Ensayo → contenido B`

Luego el Administrador guarda otro cambio:

`Contenido actual → C`

Y finalmente pulsa confirmar.

La publicación definitiva vuelve a construir el bundle desde el estado actual y puede terminar publicando **C**, aunque lo que el Administrador revisó y confirmó originalmente fue **B**.

**Cómo debería estar:**

La confirmación debe corresponder exactamente al contenido revisado.

Si el contenido cambia después del ensayo, Telar debe invalidar esa confirmación y solicitar una nueva revisión antes de publicar.

**3. Permitir recuperar una publicación cuando el bundle se subió pero el índice no pudo actualizarse**

**Cómo está ahora:**

Telar realiza correctamente:

`subir bundle → actualizar índice`

Por tanto, un fallo del índice no deja al catálogo anunciando un archivo inexistente.

Sin embargo, puede quedar el nuevo bundle almacenado pero todavía sin anunciar.

Al volver a intentar, Telar intenta crear nuevamente el mismo objeto y puede recibir un conflicto porque ese bundle ya existe.

El usuario puede quedar sin una forma funcional de terminar la publicación desde la aplicación.

**Cómo debería estar:**

Telar debe reconocer que el bundle correspondiente ya fue subido correctamente y permitir completar la actualización pendiente del índice.

También puede aplicar otra estrategia de recuperación equivalente, pero un fallo intermedio no debe obligar a realizar correcciones técnicas manuales fuera de Telar.

**4. Reconciliar la publicación remota con el estado local**

**Cómo está ahora:**

Después de publicar correctamente el bundle y actualizar el índice remoto, Telar actualiza localmente información como versión, checksum y fecha de publicación.

Si esa escritura local falla, la operación se muestra como fallida aunque la publicación ya exista remotamente.

Además, si el contenido local cambia mientras la publicación está en proceso, Telar puede terminar asociando el checksum publicado con un estado local diferente al que realmente se publicó.

**Cómo debería estar:**

Telar debe distinguir entre:

`publicación remota completada`

y

`actualización del estado local fallida`.

Debe poder reconciliar posteriormente esa información sin crear otra publicación accidental.

También debe conservar una referencia clara al contenido que realmente se publicó para que cambios posteriores continúen identificándose como trabajo todavía no publicado.

**Problema relacionado que no cambia este estado:**

CU-36 ya presenta un problema separado: los cambios de Autoría también son visibles inmediatamente desde Aprender en la misma instalación.

Guardar no modifica GCS y CU-37 sigue siendo la acción explícita que modifica el catálogo remoto, por lo que ese problema no se cuenta nuevamente como un faltante independiente de CU-37.

---

### CU-38 — Actualizar un curso incorporado

**Estado:** 🟡 **Parcial**

**Por qué:**

Telar puede detectar cuando existe una versión más reciente de una publicación incorporada, informar al Estudiante, mostrar un preview de los cambios y permitirle decidir si desea actualizar.

Cuando el Estudiante confirma, Telar descarga exactamente la versión revisada, valida el bundle antes de aplicarlo y realiza la actualización de forma transaccional. Si ocurre un fallo de descarga, validación, SQLite o reconstrucción del contenido, la versión anterior permanece disponible.

La versión actualizada también queda almacenada localmente y puede utilizarse posteriormente sin volver a descargarla.

Sin embargo, existen problemas en cómo se presenta el contenido retirado, cómo se asocia el progreso histórico a nuevas lecciones y cómo el preview describe algunas recalificaciones.

**Qué falta:**

**1. Excluir del curso actual las lecciones retiradas por una actualización**

**Cómo está ahora:**

Cuando una nueva versión elimina una lección que ya tenía actividad del estudiante, Telar puede conservarla archivada para mantener su historial.

Eso es válido.

El problema es que posteriormente esas lecciones archivadas siguen apareciendo en **Aprender** y continúan contando dentro de los totales y el progreso visible del módulo.

Por ejemplo:

`v1 = A, B, C`

`v2 = A, C`

Si B tenía progreso, puede conservarse internamente como archivada, pero todavía aparecer como si siguiera perteneciendo al contenido vigente.

**Cómo debería estar:**

Las lecciones archivadas pueden conservarse para mantener historial, pero deben quedar excluidas de:

- la estructura actual mostrada en Aprender;
- la navegación vigente;
- los totales actuales del módulo;
- el cálculo visible del progreso de la versión nueva.

**2. Evitar que una lección nueva herede progreso de contenido diferente**

**Cómo está ahora:**

Una actualización puede añadir una nueva lección cuyo `lesson_id` coincida con un registro de progreso histórico que quedó almacenado después de retirar otra publicación.

Telar relaciona ese progreso mediante el ID y puede terminar mostrando la nueva lección como vista o completada aunque el Estudiante nunca haya realizado ese contenido.

**Cómo debería estar:**

Telar debe distinguir entre:

- una lección que realmente continúa dentro de la misma publicación;
- una nueva lección que solamente reutiliza un ID utilizado anteriormente por otro contenido.

Solo el primer caso debe poder recuperar legítimamente su progreso previo.

Una lección realmente nueva debe comenzar con el estado de progreso correspondiente a contenido nuevo.

**3. Hacer que el preview refleje correctamente las recalificaciones que ocurrirán**

**Cómo está ahora:**

El preview informa qué cambios tendrá la actualización y cómo afectarán al progreso.

Sin embargo, existen cambios de quiz donde Telar recalcula realmente el puntaje durante la actualización, pero el preview puede indicar que dicho progreso será **"conservado"**.

Por tanto, el Estudiante puede confirmar una actualización esperando conservar cierto resultado y terminar con un puntaje diferente.

**Cómo debería estar:**

El preview debe representar el mismo efecto que posteriormente aplicará el plan de actualización.

Si una modificación del quiz provoca recalcular un puntaje, debe indicarse como tal antes de que el Estudiante confirme.

---

### CU-39 — Crear un curso

**Estado:** 🔴 **No implementado**

**Por qué:**

Telar permite crear módulos nuevos desde Autoría, guardar su información y continuar editándolos posteriormente.

Sin embargo, actualmente no existe una entidad o flujo funcional de **curso** superior a los módulos.

Todos los módulos forman parte de una colección global y no existe una relación que permita representar, por ejemplo:

- Curso A → Módulos A1 y A2.
- Curso B → Módulos B1 y B2.

Por tanto, las funcionalidades existentes de creación de módulos no implementan CU-39.

**Qué falta:**

**1. Implementar una entidad y flujo real de creación de cursos**

**Cómo está ahora:**

Autoría ofrece **Nuevo módulo**, pero no existe **Nuevo curso**.

Tampoco existe:

- una entidad persistida de curso;
- un formulario de creación;
- información general del curso;
- un endpoint para crearlo;
- un listado de cursos para volver a abrirlos.

**Cómo debería estar:**

El Administrador debe poder crear un curso desde cero, definir y guardar su información general y reencontrarlo posteriormente dentro de Autoría para continuar desarrollándolo.

El curso puede comenzar sin módulos y permanecer como contenido en edición.

**2. Asociar los módulos al curso correspondiente**

**Cómo está ahora:**

Los módulos pertenecen a una única colección global.

Una lección conoce su `module_id`, pero un módulo no posee ninguna referencia equivalente a un `course_id`.

Por tanto, Telar no puede distinguir estructuralmente:

`Curso A → Módulo A1`

de

`Curso B → Módulo B1`.

**Cómo debería estar:**

Cada módulo debe quedar asociado inequívocamente al curso en el que fue creado.

El Administrador debe poder trabajar con varios cursos simultáneamente sin que sus módulos se mezclen.

**3. Mantener el curso en edición separado del contenido estudiantil**

**Cómo está ahora:**

Los cambios guardados desde Autoría reconstruyen el mismo contenido local que utilizan las APIs de aprendizaje.

Por tanto, el contenido creado o modificado puede aparecer en **Aprender** sin haber realizado todavía la publicación correspondiente.

Que el contenido aún no esté en GCS no proporciona aislamiento dentro de la misma instalación.

**Cómo debería estar:**

El curso y su contenido deben permanecer dentro de una versión de trabajo de Autoría.

Hasta que el Administrador lo publique:

- puede seguir editándolo;
- puede añadir módulos y lecciones;
- los estudiantes no deben consumir esos cambios como contenido publicado.

**4. Advertir antes de descartar información inicial sin guardar**

**Cómo está ahora:**

No existe un formulario de creación de cursos.

Además, el formulario de módulo actualmente disponible puede cerrarse con cambios pendientes sin advertencia.

**Cómo debería estar:**

Durante la creación del curso, si existen cambios sin guardar y el Administrador intenta abandonar la edición, Telar debe advertirlo y permitirle permanecer para conservar su trabajo.

---

### CU-40 — Editar información de un curso

**Estado:** 🔴 **No implementado**

**Por qué:**

Telar permite editar la información de los módulos existentes, incluyendo datos como título, descripción, nivel y orden.

Sin embargo, actualmente no existe una entidad funcional de **curso** superior a los módulos ni información general propia de un curso que pueda consultarse o modificarse.

Por tanto, la funcionalidad **Editar módulo** corresponde a CU-14 y no implementa CU-40.

**Qué falta:**

**1. Implementar información general editable a nivel de curso**

**Cómo está ahora:**

No existe:

- entidad persistida de curso;
- información general propia del curso;
- listado o selector de cursos en Autoría;
- formulario para editar un curso;
- endpoint o servicio para guardar esos cambios.

Los datos editables actuales pertenecen exclusivamente a módulos.

**Cómo debería estar:**

El Administrador debe poder seleccionar un curso existente y consultar su información general actualmente guardada.

Debe poder modificar datos suficientes para identificar y describir el curso, guardar los cambios y volver a abrir posteriormente esa misma información.

La operación debe modificar únicamente el curso seleccionado y conservar sus módulos, lecciones y demás contenido.

**2. Proteger los cambios de información general sin guardar**

**Cómo está ahora:**

No existe un editor de curso sobre el cual realizar este flujo.

Además, el formulario de edición de módulo actualmente disponible puede cerrarse con cambios pendientes mediante Cancelar, Escape o cierre del diálogo sin advertencia.

**Cómo debería estar:**

La edición de información general del curso debe detectar cambios pendientes.

Si el Administrador intenta abandonar la edición sin guardarlos, Telar debe advertirlo y permitirle permanecer para continuar trabajando.

Después de guardar correctamente, esos cambios deben dejar de considerarse pendientes.

**3. Mantener la información editada separada de la versión visible al estudiante**

**Cómo está ahora:**

La información que puede modificarse actualmente en Autoría se guarda directamente sobre el snapshot local que también utilizan las APIs de aprendizaje.

Por ejemplo, si el título de un módulo cambia de `A` a `B`, una nueva consulta desde Aprender puede recibir `B` aunque todavía no se haya publicado remotamente.

**Cómo debería estar:**

La información general modificada debe permanecer en la versión de trabajo del curso.

Antes de ejecutar CU-37:

- Autoría debe poder consultar los nuevos valores;
- el estudiante debe continuar utilizando la versión publicada anterior.

Guardar la información no debe equivaler a hacerla visible para estudiantes.

---

### CU-41 — Eliminar un curso

**Estado:** 🔴 **No implementado**

**Por qué:**

Actualmente el Administrador no dispone de una funcionalidad para eliminar un curso —ni una operación equivalente sobre la unidad publicable actual— que coordine su eliminación de Autoría con su retirada del catálogo.

Telar sí permite:

- borrar localmente un módulo vacío;
- desinstalar una copia incorporada;
- detectar cuando una publicación dejó de existir remotamente y mostrarla como **Ya no publicado**.

Sin embargo, ninguna de estas operaciones permite al Administrador retirar una publicación desde Telar.

La conservación de las copias y del progreso de los estudiantes cuando una publicación desaparece remotamente ya está soportada, pero esta capacidad por sí sola no implementa CU-41.

**Qué falta:**

**1. Implementar la eliminación administrativa y retirada del catálogo**

**Cómo está ahora:**

La acción administrativa disponible es **Borrar módulo**, que:

- únicamente elimina contenido local;
- exige que el módulo esté vacío;
- no consulta si estaba publicado;
- no modifica el catálogo remoto;
- no elimina su entrada del índice.

Por tanto, un módulo previamente publicado puede eliminarse localmente y continuar disponible remotamente para otros usuarios.

**Cómo debería estar:**

El Administrador debe disponer de una acción específica para eliminar la unidad gestionada.

Antes de realizarla, Telar debe advertir sus consecuencias y solicitar confirmación.

Si el contenido estaba publicado, la operación debe:

- retirarlo de Autoría;
- retirarlo del catálogo;
- impedir nuevas incorporaciones;
- impedir nuevas actualizaciones;
- conservar las copias que otros estudiantes ya tengan instaladas.

**2. Impedir nuevas descargas y actualizaciones después de retirar una publicación**

**Cómo está ahora:**

Cuando una publicación desaparece externamente del índice, Telar puede reconocerla como **Ya no publicado** y la interfaz deja de ofrecer normalmente su actualización.

Sin embargo, el servicio de actualización puede descargar directamente una versión conocida sin comprobar nuevamente que la publicación continúe vigente en el índice.

Por tanto, conocer el ID y la versión de un bundle retirado puede permitir continuar utilizando el endpoint de actualización aunque ya no deba estar disponible.

La instalación inicial consulta el índice, pero tampoco garantiza siempre una comprobación fresca de la retirada debido al uso de caché.

**Cómo debería estar:**

Las operaciones normales de incorporación y actualización deben comprobar que la publicación continúe disponible.

Una publicación retirada no debe poder incorporarse ni actualizarse mediante Telar aunque:

- se conozca su ID;
- se conozca su versión;
- los bundles históricos continúen físicamente almacenados.

No es necesario eliminar esos bundles históricos; simplemente deben dejar de considerarse publicaciones disponibles.

**3. Manejar coherentemente los fallos entre eliminación local y retirada remota**

**Cómo está ahora:**

El borrado local de módulos cuenta con rollback de SQLite.

Sin embargo, no existe todavía una operación que coordine:

`eliminación en Autoría + retirada del catálogo`.

Por tanto, tampoco existe manejo para escenarios como:

- retirada remota correcta pero eliminación local fallida;
- eliminación local correcta pero retirada remota fallida;
- error actualizando el índice;
- reintento después de un estado intermedio.

**Cómo debería estar:**

La eliminación completa debe evitar presentar éxito cuando solo una parte de la operación terminó.

Ante un fallo debe conservar o recuperar un estado coherente y permitir reintentar o reconciliar la operación sin afectar otras publicaciones.

**Comportamiento que ya funciona y debe conservarse:**

Cuando una publicación deja de existir remotamente, una copia que el Estudiante ya tenía incorporada:

- permanece almacenada localmente;
- conserva sus lecciones;
- conserva su progreso;
- conserva los intentos de quiz;
- conserva los jobs históricos;
- puede continuar utilizándose offline;
- puede mostrarse como **Ya no publicado**.

Este comportamiento satisface parcialmente RF-APR-27 y debe mantenerse al implementar la eliminación administrativa.

No debe confundirse **Eliminar curso** con **Desinstalar copia local**: CU-41 debe retirar la publicación para nuevos usuarios sin borrar el contenido que los estudiantes ya habían incorporado.
