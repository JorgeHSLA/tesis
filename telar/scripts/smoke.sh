#!/usr/bin/env bash
#
# scripts/smoke.sh — prueba de humo E2E del stack Telar (WP11).
#
# Levanta el stack con Docker Compose (construye las imágenes si faltan),
# espera a que nginx sirva /health, ejecuta un job real del ejemplo `spmd`
# (barrido de hilos con parser `sweep_pi`) de punta a punta y un ciclo de
# quiz, verificando las respuestas del servidor. Imprime un resumen PASS/FAIL
# y derriba el stack al terminar (`docker compose down`).
#
# Uso:
#   bash scripts/smoke.sh              # levanta, prueba y derriba
#   bash scripts/smoke.sh --keep-up    # deja el stack corriendo al terminar
#
# Requisitos (ver README.md §Prerequisitos): Docker + Compose v2, curl,
# y jq O python3 (el script usa jq si está disponible y cae a python3 si no).
# Idempotente y ejecutable en un WSL2 limpio: reusa imágenes/volúmenes si ya
# existen y usa `docker compose` directamente (no depende de `make`).
set -euo pipefail

# ── Configuración ────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly BASE_URL="http://127.0.0.1:8080"          # UI/API vía nginx (loopback)
readonly EXAMPLE_ID="spmd"                         # barrido de hilos → kind=sweep
readonly LESSON_ID="spmd"                          # lección con quiz de 5 preguntas
readonly HEALTH_RETRIES=60                         # 60 × 5 s = 5 min máx esperando /health
readonly HEALTH_INTERVAL=5
readonly JOB_RETRIES=90                            # 90 × 4 s = 6 min máx esperando el job
readonly JOB_INTERVAL=4

KEEP_UP=0
[[ "${1:-}" == "--keep-up" ]] && KEEP_UP=1

# Directorio temporal para las respuestas curl (limpiado al salir).
WORKDIR="$(mktemp -d)"

# ── Utilidades de salida ─────────────────────────────────────────────────────
c_reset=$'\033[0m'; c_green=$'\033[32m'; c_red=$'\033[31m'
c_blue=$'\033[34m'; c_yellow=$'\033[33m'
info()  { printf '%s[smoke]%s %s\n' "$c_blue"   "$c_reset" "$*"; }
ok()    { printf '%s  ✔ %s%s\n'    "$c_green"  "$*" "$c_reset"; }
warn()  { printf '%s  ! %s%s\n'    "$c_yellow" "$*" "$c_reset"; }
fail()  { printf '%s  x %s%s\n'    "$c_red"    "$*" "$c_reset"; }

STEPS_TOTAL=0
STEPS_OK=0
step_pass() { STEPS_TOTAL=$((STEPS_TOTAL+1)); STEPS_OK=$((STEPS_OK+1)); ok "$1"; }
step_fail() { STEPS_TOTAL=$((STEPS_TOTAL+1)); fail "$1"; return 1; }

# ── Parser JSON: jq si existe, python3 como respaldo ─────────────────────────
HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1

# json_get FILE DOTPATH  → imprime el valor escalar en DOTPATH (p.ej. data.status)
# Usa jq cuando está disponible; si no, python3 (siempre presente: Python 3.12
# es prerequisito). Devuelve cadena vacía si la ruta no existe o es null.
json_get() {
  local file="$1" path="$2"
  if [[ "$HAVE_JQ" == 1 ]]; then
    # `// empty` NO sirve: colapsaría también los `false`. Sólo null/ausente → "".
    jq -r "try (.${path}) catch null | if . == null then empty else . end" "$file"
  else
    TELAR_JPATH="$path" python3 - "$file" <<'PY'
import json, os, sys
path = os.environ["TELAR_JPATH"].split(".")
try:
    with open(sys.argv[1]) as fh:
        cur = json.load(fh)
    for key in path:
        cur = cur[key]
    print("" if cur is None else cur)
except Exception:
    print("")
PY
  fi
}

# ── Manejo de fallos y limpieza ──────────────────────────────────────────────
FAILED=0
mark_failed() { FAILED=1; }

teardown() {
  local rc=$?
  set +e
  if [[ -n "${WORKDIR:-}" && -d "$WORKDIR" ]]; then rm -rf "$WORKDIR"; fi
  if [[ "$KEEP_UP" == 1 ]]; then
    info "Stack dejado en marcha por --keep-up (docker compose ps):"
    ( cd "$REPO_ROOT" && docker compose ps ) || true
  else
    info "Derribando el stack (docker compose down)…"
    ( cd "$REPO_ROOT" && docker compose down ) || true
  fi
  # Resumen final
  echo
  if [[ "$FAILED" == 0 && "$rc" == 0 && "$STEPS_OK" == "$STEPS_TOTAL" && "$STEPS_TOTAL" -gt 0 ]]; then
    printf '%s══ SMOKE PASS ══%s  (%d/%d comprobaciones)\n' \
      "$c_green" "$c_reset" "$STEPS_OK" "$STEPS_TOTAL"
    exit 0
  else
    printf '%s══ SMOKE FAIL ══%s  (%d/%d comprobaciones)\n' \
      "$c_red" "$c_reset" "$STEPS_OK" "$STEPS_TOTAL"
    exit 1
  fi
}
trap teardown EXIT

# ── curl helper: escribe cuerpo a archivo, devuelve código HTTP ──────────────
# http_get  OUTFILE URL
# http_post OUTFILE URL JSON_BODY
http_get() {
  curl -sS -o "$1" -w '%{http_code}' --max-time 30 "$2"
}
http_post_json() {
  curl -sS -o "$1" -w '%{http_code}' --max-time 30 \
    -H 'Content-Type: application/json' -X POST --data "$3" "$2"
}

# ── 0. Comprobaciones previas ────────────────────────────────────────────────
info "Telar smoke test — repo: ${REPO_ROOT}"
command -v docker >/dev/null 2>&1 || { fail "docker no está en PATH"; exit 1; }
docker compose version >/dev/null 2>&1 || { fail "docker compose (v2) no disponible"; exit 1; }
command -v curl >/dev/null 2>&1 || { fail "curl no está en PATH"; exit 1; }
if [[ "$HAVE_JQ" == 1 ]]; then info "parser JSON: jq"; else
  command -v python3 >/dev/null 2>&1 || { fail "ni jq ni python3 disponibles"; exit 1; }
  info "parser JSON: python3 (jq no encontrado)"
fi

# ── 1. Levantar el stack (build si falta) ────────────────────────────────────
info "Levantando el stack (docker compose up -d --build)…"
(
  cd "$REPO_ROOT"
  # --build asegura frontend/backend actualizados; el runner (perfil build) se
  # construye aparte porque `up` ignora el perfil 'build'.
  docker compose build frontend backend
  docker compose --profile build build runner
  docker compose up -d
)

# ── 2. Esperar /health vía nginx ─────────────────────────────────────────────
info "Esperando a que nginx sirva ${BASE_URL}/health …"
health_ok=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  code="$(http_get "$WORKDIR/health.json" "${BASE_URL}/health" || echo 000)"
  if [[ "$code" == 200 ]]; then
    status="$(json_get "$WORKDIR/health.json" status)"
    if [[ "$status" == "ok" ]]; then health_ok=1; break; fi
  fi
  sleep "$HEALTH_INTERVAL"
done
if [[ "$health_ok" == 1 ]]; then
  db="$(json_get "$WORKDIR/health.json" checks.db)"
  runner="$(json_get "$WORKDIR/health.json" checks.runner_image)"
  step_pass "/health respondió 200 status=ok (db=${db}, runner_image=${runner})"
else
  step_fail "/health no llegó a status=ok tras $((HEALTH_RETRIES*HEALTH_INTERVAL))s" || mark_failed
  exit 1
fi

# ── 3. /system: confirmar imagen runner presente ─────────────────────────────
code="$(http_get "$WORKDIR/system.json" "${BASE_URL}/api/v1/system" || echo 000)"
runner_present="$(json_get "$WORKDIR/system.json" data.runner_image_present)"
runner_present_lc="$(printf '%s' "$runner_present" | tr '[:upper:]' '[:lower:]')"
if [[ "$code" == 200 && "$runner_present_lc" == "true" ]]; then
  cores="$(json_get "$WORKDIR/system.json" data.cores)"
  step_pass "/api/v1/system OK (cores=${cores}, runner_image_present=${runner_present})"
else
  warn "/system runner_image_present=${runner_present} (code=${code}); el job podría fallar"
  STEPS_TOTAL=$((STEPS_TOTAL+1)); STEPS_OK=$((STEPS_OK+1))
fi

# ── 4. Crear job del ejemplo spmd ────────────────────────────────────────────
info "Creando job del ejemplo '${EXAMPLE_ID}' (POST /api/v1/jobs)…"
job_body="$(printf '{"example_id":"%s","lesson_id":"%s"}' "$EXAMPLE_ID" "$LESSON_ID")"
code="$(http_post_json "$WORKDIR/job_create.json" "${BASE_URL}/api/v1/jobs" "$job_body" || echo 000)"
JOB_ID="$(json_get "$WORKDIR/job_create.json" data.job_id)"
if [[ "$code" == 202 && -n "$JOB_ID" ]]; then
  threads_eff="$(json_get "$WORKDIR/job_create.json" data.threads_effective)"
  step_pass "job creado (202) job_id=${JOB_ID} threads_effective=${threads_eff}"
else
  step_fail "POST /api/v1/jobs devolvió code=${code} body=$(cat "$WORKDIR/job_create.json")" || mark_failed
  exit 1
fi

# ── 5. Poll hasta estado terminal ────────────────────────────────────────────
info "Esperando a que el job alcance un estado terminal…"
JOB_STATUS=""
for i in $(seq 1 "$JOB_RETRIES"); do
  code="$(http_get "$WORKDIR/job.json" "${BASE_URL}/api/v1/jobs/${JOB_ID}" || echo 000)"
  if [[ "$code" == 200 ]]; then
    JOB_STATUS="$(json_get "$WORKDIR/job.json" data.status)"
    case "$JOB_STATUS" in
      completed|failed|timeout|cancelled) break ;;
      *) : ;;  # queued|creating|compiling|running → seguir
    esac
  fi
  sleep "$JOB_INTERVAL"
done

if [[ "$JOB_STATUS" == "completed" ]]; then
  exit_code="$(json_get "$WORKDIR/job.json" data.exit_code)"
  wall="$(json_get "$WORKDIR/job.json" data.wall_time_ms)"
  step_pass "job status=completed (exit_code=${exit_code}, wall_time_ms=${wall})"
else
  detail="$(json_get "$WORKDIR/job.json" data.error_detail)"
  step_fail "job terminó en status='${JOB_STATUS}' error_detail='${detail}'" || mark_failed
  info "cuerpo del job: $(cat "$WORKDIR/job.json")"
  exit 1
fi

# ── 6. Verificar parsed_timings.kind == sweep ────────────────────────────────
kind="$(json_get "$WORKDIR/job.json" data.parsed_timings.kind)"
parser_id="$(json_get "$WORKDIR/job.json" data.parsed_timings.parser_id)"
if [[ "$kind" == "sweep" ]]; then
  step_pass "parsed_timings.kind='sweep' (parser_id=${parser_id})"
else
  step_fail "parsed_timings.kind='${kind}' (esperado 'sweep')" || mark_failed
fi

# ── 7. GET /output no vacío ──────────────────────────────────────────────────
code="$(http_get "$WORKDIR/output.txt" "${BASE_URL}/api/v1/jobs/${JOB_ID}/output" || echo 000)"
out_bytes=$(wc -c < "$WORKDIR/output.txt" | tr -d ' ')
if [[ "$code" == 200 && "$out_bytes" -gt 0 ]]; then
  step_pass "GET /output devolvió ${out_bytes} bytes de stdout"
else
  step_fail "GET /output code=${code} bytes=${out_bytes}" || mark_failed
fi

# ── 8. Ciclo de quiz: GET quiz → POST attempt → score numérico ───────────────
info "Ejecutando ciclo de quiz de la lección '${LESSON_ID}'…"
code="$(http_get "$WORKDIR/quiz.json" "${BASE_URL}/api/v1/lessons/${LESSON_ID}/quiz" || echo 000)"
q_count="$(json_get "$WORKDIR/quiz.json" data.question_count)"
if [[ "$code" != 200 || -z "$q_count" ]]; then
  step_fail "GET quiz code=${code} question_count='${q_count}'" || mark_failed
else
  step_pass "GET quiz OK (${q_count} preguntas)"

  # Construir el body de respuestas: cada pregunta → 'a' (clave válida). El
  # servidor calcula el score; el smoke sólo verifica que devuelve un número.
  if [[ "$HAVE_JQ" == 1 ]]; then
    answers="$(jq -c '{answers: (reduce .data.questions[] as $q ({}; . + {($q.id): "a"}))}' "$WORKDIR/quiz.json")"
  else
    answers="$(python3 - "$WORKDIR/quiz.json" <<'PY'
import json, sys
with open(sys.argv[1]) as fh:
    d = json.load(fh)
ans = {q["id"]: "a" for q in d["data"]["questions"]}
print(json.dumps({"answers": ans}))
PY
)"
  fi

  code="$(http_post_json "$WORKDIR/attempt.json" \
    "${BASE_URL}/api/v1/lessons/${LESSON_ID}/quiz/attempts" "$answers" || echo 000)"
  score="$(json_get "$WORKDIR/attempt.json" data.score)"
  total="$(json_get "$WORKDIR/attempt.json" data.total)"
  passed="$(json_get "$WORKDIR/attempt.json" data.passed)"
  if [[ "$code" == 201 && "$score" =~ ^[0-9]+$ && -n "$total" ]]; then
    step_pass "quiz calificado por el servidor: score=${score}/${total} passed=${passed}"
  else
    step_fail "POST attempt code=${code} score='${score}' body=$(cat "$WORKDIR/attempt.json")" || mark_failed
  fi
fi

# El resumen PASS/FAIL lo imprime teardown (trap EXIT).
info "Comprobaciones completadas: ${STEPS_OK}/${STEPS_TOTAL}"
