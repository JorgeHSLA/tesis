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
