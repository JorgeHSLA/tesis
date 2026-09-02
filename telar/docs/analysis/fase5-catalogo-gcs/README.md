# Fase 5 — Catálogo remoto de módulos (GCS): material de diseño

Documentos de trabajo que produjo el diseño de la Fase 5, guardados aquí para que
sobrevivan a la sesión que los generó. **No son contrato**: el contrato vive en
[`../../architecture/api-contract.md`](../../architecture/api-contract.md) §11 y en
[`../../architecture/data-model.md`](../../architecture/data-model.md) §3 y §8, que
son los que mandan.

## Qué hay aquí

| Archivo | Qué es | Estado |
|---|---|---|
| `plan.md` | **El plan de implementación**: 26 commits ordenados (C1..C26), archivos nuevos y modificados, puntos de ruptura de los tests, plan de pruebas y 17 riesgos con mitigación. Es el documento por el que se retoma el trabajo | Vigente, con las salvedades de abajo |
| `investigacionGcs.md` | API real de `google-cloud-storage` 3.13.1 y de OAuth de escritorio, **verificada empíricamente** contra un venv y un bucket público, no de memoria | Vigente como referencia |
| `mapaBackend.md` | Mapa de impacto del backend con `archivo:línea`: qué asume que toda lección tiene ejemplo, qué rompe el `order` por módulo, qué invariantes dejan de valer | Vigente |
| `mapaFrontend.md` | Lo mismo para el frontend: qué pantallas rompen con `example_id` nullable, qué pantalla nueva hace falta, qué tests se caen | Vigente |
| `esquemaJson.md` | Diseño del formato de intercambio y, sobre todo, las **reglas de endurecimiento** del bundle (claves JSON duplicadas, Trojan Source, nombres reservados, derivación de rutas, topes por capas) | Vigente; el esquema final está en el contrato |
| `algoritmoMerge.md` | El algoritmo de actualización que preserva el progreso (CU-39) y su tabla de casos borde. Es la pieza más delicada de la fase | Vigente |
| `migration5-verificada.sql` | El DDL de la migración 5 tal como se verificó contra SQLite real antes de inscribirlo | Ya aplicado en `backend/app/schema.sql` |

No se guardan aquí el borrador del contrato ni el de la §11: **quedaron superados**
por lo que se escribió en `api-contract.md`, y tener dos versiones del contrato es
justo la clase de ambigüedad que este proyecto evita.

## Decisiones posteriores al diseño (los documentos NO las reflejan)

Estas tres se tomaron **después** de que el diseño se produjera, así que donde el
plan y el contrato se contradigan, **manda el contrato**:

1. **La escritura del admin usa una CUENTA DE SERVICIO, no OAuth loopback.**
   Los documentos describen el flujo Authorization Code + PKCE contra
   `127.0.0.1`; es correcto y viable, pero con la pantalla de consentimiento en
   modo *Testing* la autorización caduca a los 7 días y `devstorage.read_write`
   exige verificación de Google para publicar. Con un solo admin, re-autenticarse
   cada semana para poder publicar es peor que custodiar un archivo de clave.
   Afecta a: `TELAR_GCS_CREDENTIALS` en vez de `CLIENT_ID`/`CLIENT_SECRET`/
   `TOKEN_PATH`; `403 CATALOG_CREDENTIALS_INVALID` en vez de
   `CATALOG_AUTH_REQUIRED`/`OAUTH_TIMEOUT`/`OAUTH_FAILED`; un solo endpoint de
   solo lectura `GET /admin/catalog/credentials` en vez de los tres de `/auth`.
2. **El video de la lección es una URL de YouTube no listado, por lección.** No
   se descarga nada: el bundle transporta el enlace (`video_url`), el servidor lo
   normaliza al escribirlo y el cliente reconstruye el embed sobre
   `youtube-nocookie.com`. Los documentos de diseño no lo contemplan.
3. **«Curso» = «módulo».** No hay entidad nueva por encima del módulo; el módulo
   gana `version` y `checksum` y pasa a ser la unidad publicable.

## Por dónde se retoma

Fases 0 y 1 del plan están **hechas y verdes** (11 commits en
`feat/catalogo-modulos-gcs`): los refactors de la revisión previa, el contrato,
el modelo de datos y la migración 5.

Lo siguiente es **C4** en `plan.md`: `ContentRepository` con `example_id`
opcional y `enabled` como columna propia. De ahí en adelante el plan se sigue en
orden.

Para correr los tests del backend hace falta un venv (el repo no trae ninguno):

```bash
python3 -m venv /tmp/bkenv
/tmp/bkenv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
cd backend && DOCKER_HOST=tcp://127.0.0.1:1 /tmp/bkenv/bin/python -m pytest -q --cov=app --cov-fail-under=80
```

`DOCKER_HOST` inválido es deliberado: fuerza a los tests a usar los fakes del
`Protocol` en vez del daemon real.
