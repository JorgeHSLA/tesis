# `e2e/` — suite de verificación end-to-end (Playwright)

Vive **dentro del repo** a propósito. La suite anterior estaba en
`~/.telar-verify/e2e/`, sin versionar: nadie más podía correrla, CI no podía
reproducirla y «verificado» no era comprobable por terceros. Era uno de los
hallazgos de la revisión previa al refactor.

## Qué verifica

Los cambios del área educativa, sobre el DOM que ve el estudiante:

| Archivo | Cubre |
|---|---|
| `tests/leccion.spec.ts` | C1 (la lección abre mostrando la lección), F1 («ZINE» retirado + nombre accesible del rail), C4 (metadatos pedagógicos a pantalla), E1 (la lección conceptual y su video de YouTube) |
| `tests/catalogo.spec.ts` | F2 (una fila por lección, contadores correctos), E1 en el catálogo y en el selector del simulador |

## Cómo correrla

El stack se levanta **fuera** de Playwright: el backend necesita su propia DB
temporal y el frontend un build con `VITE_API_BASE` apuntando a ese backend.
Encadenarlo en `webServer` ataría la config al entorno de cada quien.

Regla del repo (`CLAUDE.md`): `npm ci` y los builds **nunca sobre `/mnt/d`**.
No es cosmética — sobre drvfs la suite de vitest tardaba 306 s y 6 workers no
llegaban a arrancar; en ext4 son 17 s y 33/33.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22

# 1 · backend con DB temporal, en un puerto libre (8000 suele tenerlo el
#     contenedor de compose; no lo pises)
export TMP=/tmp/telar-e2e && mkdir -p $TMP/jobs
cd backend && TELAR_DB_PATH=$TMP/telar.db TELAR_JOBS_DIR=$TMP/jobs \
  TELAR_ADMIN_MODE=1 \
  TELAR_ALLOWED_ORIGINS="http://127.0.0.1:4173,http://localhost:4173,null" \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8010 &

# 2 · frontend: build en ext4 apuntando a ese backend, y servirlo
rsync -a --exclude node_modules --exclude dist frontend/ ~/.telar-build/frontend/
cd ~/.telar-build/frontend && npm ci
VITE_API_BASE=http://127.0.0.1:8010 VITE_WS_BASE=ws://127.0.0.1:8010 npm run build
npx vite preview --port 4173 --host 127.0.0.1 --strictPort &

# 3 · los tests
rsync -a --exclude node_modules e2e/ ~/.telar-build/e2e/
cd ~/.telar-build/e2e && npm install && npx playwright install chromium
TELAR_E2E_BASE_URL=http://127.0.0.1:4173 npx playwright test
```

Todo en **loopback**, coherente con la restricción del repo: el backend no tiene
autenticación y monta el socket de Docker.

## Contenido que dan por hecho

`catalogo.spec.ts` y la parte E1 de `leccion.spec.ts` esperan un módulo
conceptual, que se crea contra la API admin del backend de pruebas:

```bash
API=http://127.0.0.1:8010/api/v1
curl -s -X POST $API/admin/modules -H 'Content-Type: application/json' -d '{
  "id":"f1","order":9,"title":"Fundamentos de paralelismo",
  "description":"Track conceptual que precede a los módulos prácticos.",
  "level":"Básico"}'

curl -s -X POST $API/admin/lessons -H 'Content-Type: application/json' -d '{
  "id":"queEsUnHilo","module_id":"f1","order":1,
  "title":"¿Qué es un hilo?","estimated_minutes":5,
  "content_markdown":"# ¿Qué es un hilo?\n\nUna **unidad de ejecución** dentro de un proceso.",
  "recommended":[],"completion_rule":"viewed",
  "video_url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLnoDeberiaSobrevivir"}'
```

Ese `&list=…` está a propósito: uno de los tests comprueba que **no sobrevive**
ni a la normalización del servidor ni a la del cliente.

## Un defecto que encontró

El primer paso de esta suite destapó que los enlaces del rail lateral **no
tenían nombre accesible**: `.nav-label` está en `display: none` (el rail mide
56 px) y el tooltip es un `::after` con `content: attr(data-tip)`, contenido
generado por CSS que no llega al árbol de accesibilidad. Un lector de pantalla
anunciaba «enlace» sin más en toda la navegación principal (WCAG 2.4.4 y 4.1.2).
Se arregló con `aria-label`, y el test `todos los enlaces del rail tienen nombre
accesible` lo defiende.
