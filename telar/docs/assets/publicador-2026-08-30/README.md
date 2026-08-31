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
