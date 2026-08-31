# Verificación E2E del catálogo remoto (CU-35 a CU-39)

El recorrido que esta suite comprueba es el que da sentido a toda la Fase 5:

> Un admin publica un módulo. El estudiante lo ve, **elige** incorporarlo,
> avanza en él, y cuando llega una versión nueva la instala **sin perder lo
> avanzado**.

Cada paso se assertá sobre el DOM que ve el estudiante, no sobre respuestas de
la API: que el backend conserve el progreso ya lo prueban 897 tests de pytest;
lo que falta comprobar es que la persona lo *vea*.

## Cómo se simula el bucket sin GCP

No hace falta una cuenta de Google para verificar esto, y no debería hacer
falta: el backend tiene **dos adaptadores del puerto de lectura**
(`TELAR_CATALOG_DRIVER`), y el `http_local` habla el mismo protocolo contra un
servidor estático en loopback. Los dos recorren idéntico código de validación,
checksum, instalación y merge; lo único distinto es el transporte.

`scripts/preparar-bucket.py` genera el bucket **a partir del contenido real del
repo** (`backend/app/content/`), no de datos inventados:

| Módulo | Qué aporta al recorrido |
|---|---|
| `mFundamentos` v1 | Dos lecciones: una conceptual con video de YouTube y otra práctica con código y quiz |
| `mFundamentos` v2 | Añade una tercera lección conceptual — es lo que convierte el E2E en una prueba de CU-39 |
| `mExtra` v1 | Existe solo para comprobar que el estudiante puede **no** incorporar lo que no quiere |

La URL de video de la lección conceptual lleva un `&list=NoDeberiaSobrevivir`
puesto a propósito: uno de los tests comprueba que **no sobrevive** ni a la
normalización del servidor ni a la del cliente.

## Levantar el escenario

Regla del repo (`CLAUDE.md`): `npm` **nunca** sobre `/mnt/d`. Sobre drvfs la
suite de vitest tardaba 306 s y seis workers no llegaban a arrancar; en ext4 son
17 s y 33/33.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22
export TMP=/tmp/telar-e2e && mkdir -p $TMP/jobs $TMP/bucket

# 1 · el bucket falso, servido por un estático en loopback
python3 e2e/scripts/preparar-bucket.py $TMP/bucket --version 1
(cd $TMP/bucket && python3 -m http.server 8095 --bind 127.0.0.1 &)

# 2 · el backend, con el driver local y una DB temporal.
#     Puerto 8015 y no 8000: el 8000 suele tenerlo el contenedor de compose,
#     y pisarlo se nota tarde y mal.
cd backend && TELAR_DB_PATH=$TMP/telar.db TELAR_JOBS_DIR=$TMP/jobs \
  TELAR_ADMIN_MODE=1 \
  TELAR_ALLOWED_ORIGINS="http://127.0.0.1:4174,http://localhost:4174,null" \
  TELAR_CATALOG_BUCKET=telar-e2e TELAR_CATALOG_DRIVER=http_local \
  TELAR_CATALOG_ENDPOINT=http://127.0.0.1:8095 \
  TELAR_CATALOG_LOCAL_ROOT=$TMP/bucket \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8015 &

# 3 · el frontend, compilado en ext4 apuntando a ese backend
rsync -a --exclude node_modules --exclude dist frontend/ ~/.telar-build/frontend/
cd ~/.telar-build/frontend && npm ci
VITE_API_BASE=http://127.0.0.1:8015 VITE_WS_BASE=ws://127.0.0.1:8015 npm run build
npx vite preview --port 4174 --host 127.0.0.1 --strictPort &

# 4 · los tests
rsync -a --exclude node_modules e2e/ ~/.telar-build/e2e/
cd ~/.telar-build/e2e && npm install && npx playwright install chromium
# TELAR_E2E_PYTHON: el guion firma los bundles con la MISMA función que el
# backend (`app.services.catalog_hash`), así que necesita su intérprete.
TELAR_E2E_BASE_URL=http://127.0.0.1:4174 \
TELAR_E2E_API=http://127.0.0.1:8015 \
TELAR_E2E_PREPARAR=$PWD/e2e/scripts/preparar-bucket.py \
TELAR_E2E_BUCKET=$TMP/bucket \
TELAR_E2E_PYTHON=~/.telar-build/bkenv/bin/python \
  npx playwright test catalogo-remoto
```

Todo en **loopback**, coherente con la restricción del repo: el backend no tiene
autenticación y monta el socket de Docker.

## Correr el MISMO recorrido contra Google de verdad

El bucket falso comprueba la lógica; no comprueba el transporte. Para correr los
17 tests contra GCS basta cambiar el driver y dejar que `preparar-bucket.py`
publique también en el bucket real — la spec **no se toca**:

```bash
# el bucket tiene que ser legible sin credenciales:
#   publicAccessPrevention = inherited  +  allUsers → roles/storage.objectViewer
gcloud storage buckets update gs://clasestelar --no-public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://clasestelar \
  --member=allUsers --role=roles/storage.objectViewer

cd backend && TELAR_DB_PATH=$TMP/telar.db TELAR_JOBS_DIR=$TMP/jobs \
  TELAR_ADMIN_MODE=1 \
  TELAR_ALLOWED_ORIGINS="http://127.0.0.1:4174,http://localhost:4174,null" \
  TELAR_CATALOG_BUCKET=clasestelar TELAR_CATALOG_DRIVER=gcs \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8015 &

cd ~/.telar-build/e2e && TELAR_E2E_BASE_URL=http://127.0.0.1:4174 \
  TELAR_E2E_API=http://127.0.0.1:8015 \
  TELAR_E2E_PREPARAR=$REPO/e2e/scripts/preparar-bucket.py \
  TELAR_E2E_BUCKET=$TMP/bucket \
  TELAR_E2E_PYTHON=~/.telar-build/bkenv/bin/python \
  TELAR_E2E_GCS_BUCKET=clasestelar \
  TELAR_E2E_GCS_PROJECT=reliable-banner-470503-j7 \
  npx playwright test catalogo-remoto
```

Resultado el 2026-08-30: **17/17 en verde contra `storage.googleapis.com`.**

### Las dos suites NO comparten base de datos

`catalogo-remoto.spec.ts` instala `mFundamentos`, cuyo título es **«Fundamentos
de paralelismo»**; el escenario de `catalogo.spec.ts`/`leccion.spec.ts` (ver
`e2e/README.md`) crea a mano el módulo `f1` con **ese mismo título**. Corridas
contra la MISMA base de datos, los localizadores por texto encuentran dos
módulos y Playwright falla por modo estricto — cuatro tests en rojo que no
tienen nada que ver con el código.

Cada suite con su `TELAR_DB_PATH`. Verificado: en bases separadas van 17/17 y
22/22.

### Lo que solo se ve con el transporte real

El primer intento falló, y el fallo era de verdad. GCS sirve los objetos públicos
con `Cache-Control: public, max-age=3600` **por defecto**, y la caché de borde de
Google entrega esa copia aunque el objeto ya se haya reescrito: publicada la v2
del índice, el backend seguía leyendo la v1 con `age=227`. Traducido al
estudiante: *el aviso de «hay versión nueva» tarda hasta una hora en aparecer*, y
CU-38 no se cumple.

Un servidor estático en loopback no tiene caché de borde, así que este fallo era
**invisible** para el driver `http_local` por bien escrito que estuviera. Se
arregló por los dos lados (§11.8.2 y §11.4.2): el publicador sube el índice con
`no-cache` y los bundles —inmutables— con caché de un año, y la relectura forzada
añade un parámetro de un solo uso que cambia la clave de caché. Mandar
`Cache-Control: no-cache` en la *petición* no sirve de nada; se probó.

## Publicar la v2 a mitad del recorrido

El paso de CU-39 necesita que el bucket cambie mientras el estudiante ya tiene
la v1 instalada. Se hace reescribiendo el índice:

```bash
python3 e2e/scripts/preparar-bucket.py $TMP/bucket --version 2
```

Los bundles son **inmutables**: `v1.json` sigue ahí intacto. Lo único que cambia
es a cuál apunta el índice, que es exactamente como se comporta un bucket real.

## Qué NO cubre

- El adaptador **`gcs` real** no se ejercita aquí: comparte todo el código de
  validación, checksum, instalación y merge con `http_local`, y solo difiere en
  el transporte, que se cubre con tests unitarios mockeando `httpx`. Antes de la
  defensa conviene una pasada manual contra un bucket de verdad.
- La **publicación desde la UI de autoría** (CU-37/CU-38): hoy publicar es
  escribir el JSON en el bucket. El diálogo de admin está pendiente.
