# Publicador del catálogo (CU-38) — verificación en navegador

`dialogo-publicacion-ensayo.png` — el diálogo de §11.8 tras pulsar «Ver qué se
publicará», con el backend hablando **con Google de verdad**
(`TELAR_CATALOG_DRIVER=gcs`, bucket `clasestelar`).

Lo que la captura demuestra y no se puede deducir del código:

* La credencial se resolvió contra el bucket: el diálogo nombra la cuenta de
  servicio real (`telar-publicador@…`), que solo se conoce leyendo la clave.
* El ensayo (`dry_run`) es un viaje completo a Google que **no escribe**: dice
  versión, número de lecciones y bytes exactos del bundle que se subiría.
* «Publicar v1» solo se habilita después del ensayo. Antes está deshabilitado,
  que es el invariante del diálogo: publicar es irreversible.

Tras esta captura se pulsó «Publicar v1» y el objeto apareció en
`gs://clasestelar/modulos/mUiDemo/v1.json`, con el índice actualizado por CAS.
El módulo de demostración se borró del bucket después.

---

`dialogo-importacion-copia.png` — el diálogo de §11.7 (CU-37) en modo «copia
independiente», leyendo el bucket **real** (`clasestelar`).

Lo que demuestra:

* La lista sale del catálogo de verdad: «Fundamentos de paralelismo · v1 · 2
  lecciones» es lo que había publicado en ese momento.
* Los dos modos se presentan **explicados**, no tras una casilla «avanzado».
  Elegir mal no da un error: da un comportamiento distinto meses después (el
  vinculado recibe actualizaciones que pisan lo editado; la copia no).
* El prefijo deja de ser abstracto: se enseña el id que saldrá
  (`mfundamentos-mio-<id-de-lección>`) **antes** de importar.

Tras esta captura se pulsó «Importar» y el módulo entró como `mfundamentos-mio`
en estado `local_only` —o sea, sin fila en `installed_modules`— con sus lecciones
renombradas a `mfundamentos-mio-f1Hilo` y `mfundamentos-mio-f1Practica`.
Importar solo LEE, así que el bucket no se modificó.
