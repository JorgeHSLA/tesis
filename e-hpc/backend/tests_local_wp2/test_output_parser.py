"""Los 6 parser_id de architecture.md §7.2 contra los stdout LITERALES
de docs/analysis/examples-content.md §6 (formatos reales verificados)."""

from __future__ import annotations

from app.services.output_parser import PARSER_IDS, parse_output

# ── stdouts literales (examples-content §6) ──────────────────────────────────

SPMD_STDOUT = (
    "hilos = 1 | pi = 3.1415926535897523 | tiempo = 0.726 s\n"
    "hilos = 2 | pi = 3.1415926535897527 | tiempo = 0.256 s\n"
    "hilos = 4 | pi = 3.1415926535897514 | tiempo = 0.173 s\n"
    "hilos = 8 | pi = 3.1415926535897523 | tiempo = 0.091 s\n"
)

TRANSPORTE_STDOUT = (
    "hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 % | reflejadas: 20.85 % | absorbidas: 76.8 %\n"
    "hilos = 2 | tiempo = 0.256 s | transmitidas: 2.36 % | reflejadas: 20.8 % | absorbidas: 76.84 %\n"
    "hilos = 4 | tiempo = 0.173 s | transmitidas: 2.33 % | reflejadas: 20.9 % | absorbidas: 76.77 %\n"
    "hilos = 8 | tiempo = 0.091 s | transmitidas: 2.34 % | reflejadas: 20.87 % | absorbidas: 76.79 %\n"
)

# ojo al espacio antes de los dos puntos en "numpy :" (§6 fila 6)
SUMAVECTORES_STDOUT = (
    "correcto? True\n"
    "tiempo openmp: 0.412 s\n"
    "tiempo numpy : 0.389 s\n"
)

MATRICES_STDOUT = (
    "correcto? True\n"
    "tiempo openmp : 1.234 s\n"
    "tiempo np.dot : 0.456 s (BLAS optimizado, la referencia a batir)\n"
)

# dos espacios antes de ":" en "tiempo serial  :" (§6 fila 12)
STENCIL_STDOUT = (
    "paralelo == serial? True\n"
    "tiempo paralelo: 0.912 s\n"
    "tiempo serial  : 0.989 s\n"
    "temperatura cerca del borde caliente: 24.375\n"
)

FIB_STDOUT = "fib( 10 ) = 55\nfib( 20 ) = 6765\nfib( 30 ) = 832040\nfib( 35 ) = 9227465\n"
PITASK_STDOUT = "pi = 3.141592653589794\n"
HELLO_STDOUT = "Hello from thread 2\nHello from thread 0\nHello from thread 1\n"


def test_parser_ids_congelados():
    assert PARSER_IDS == {
        "none", "sweep_pi", "sweep_transporte",
        "pair_openmp_numpy", "pair_openmp_blas", "pair_parallel_serial",
    }


# ── sweeps ───────────────────────────────────────────────────────────────────


def test_sweep_pi_literal():
    parsed = parse_output("sweep_pi", SPMD_STDOUT)
    assert parsed is not None
    assert parsed["parser_id"] == "sweep_pi"
    assert parsed["kind"] == "sweep"
    assert parsed["correct"] is None
    series = parsed["series"]
    assert [p["threads"] for p in series] == [1, 2, 4, 8]
    assert [p["time_s"] for p in series] == [0.726, 0.256, 0.173, 0.091]
    # speedup(n) = t(1)/t(n); eficiencia(n) = speedup(n)/n (valores del contrato §7.4)
    assert [p["speedup"] for p in series] == [1.0, 2.84, 4.2, 7.98]
    assert [p["efficiency"] for p in series] == [1.0, 1.42, 1.05, 1.0]


def test_sweep_transporte_literal():
    parsed = parse_output("sweep_transporte", TRANSPORTE_STDOUT)
    assert parsed is not None
    assert parsed["parser_id"] == "sweep_transporte"
    assert parsed["kind"] == "sweep"
    series = parsed["series"]
    assert [p["threads"] for p in series] == [1, 2, 4, 8]
    assert series[3]["speedup"] == 7.98
    assert parsed["extra"] == {
        "transmitidas_pct": 2.35,
        "reflejadas_pct": 20.85,
        "absorbidas_pct": 76.8,
    }


def test_sweep_sin_baseline_devuelve_none():
    sin_hilo_1 = "\n".join(SPMD_STDOUT.splitlines()[1:])
    assert parse_output("sweep_pi", sin_hilo_1) is None


def test_sweep_orden_de_lineas_no_importa():
    desordenado = "\n".join(reversed(SPMD_STDOUT.strip().splitlines()))
    parsed = parse_output("sweep_pi", desordenado)
    assert parsed is not None
    por_hilos = {p["threads"]: p["speedup"] for p in parsed["series"]}
    assert por_hilos[8] == 7.98


# ── pairs ────────────────────────────────────────────────────────────────────


def test_pair_openmp_numpy_literal():
    parsed = parse_output("pair_openmp_numpy", SUMAVECTORES_STDOUT)
    assert parsed == {
        "parser_id": "pair_openmp_numpy",
        "kind": "pair",
        "parallel_time_s": 0.412,
        "reference_time_s": 0.389,
        "reference_label": "numpy",
        "speedup_vs_reference": 0.94,
        "correct": True,
    }


def test_pair_openmp_blas_literal():
    parsed = parse_output("pair_openmp_blas", MATRICES_STDOUT)
    assert parsed == {
        "parser_id": "pair_openmp_blas",
        "kind": "pair",
        "parallel_time_s": 1.234,
        "reference_time_s": 0.456,
        "reference_label": "blas",
        "speedup_vs_reference": 0.37,
        "correct": True,
    }


def test_pair_parallel_serial_literal():
    parsed = parse_output("pair_parallel_serial", STENCIL_STDOUT)
    assert parsed == {
        "parser_id": "pair_parallel_serial",
        "kind": "pair",
        "parallel_time_s": 0.912,
        "reference_time_s": 0.989,
        "reference_label": "serial",
        "speedup_vs_reference": 1.08,
        "correct": True,
    }


def test_pair_correct_false_se_propaga():
    stdout = SUMAVECTORES_STDOUT.replace("correcto? True", "correcto? False")
    parsed = parse_output("pair_openmp_numpy", stdout)
    assert parsed is not None and parsed["correct"] is False


def test_pair_incompleto_devuelve_none():
    assert parse_output("pair_openmp_numpy", "tiempo openmp: 0.412 s\n") is None


# ── none / reglas transversales ──────────────────────────────────────────────


def test_parser_none_y_scripts_que_no_miden():
    assert parse_output("none", FIB_STDOUT) is None
    assert parse_output("none", PITASK_STDOUT) is None
    assert parse_output("none", HELLO_STDOUT) is None


def test_truncado_jamas_se_parsea():
    assert parse_output("sweep_pi", SPMD_STDOUT, truncated=True) is None
    assert parse_output("pair_openmp_blas", MATRICES_STDOUT, truncated=True) is None


def test_stdout_vacio_o_formato_ajeno():
    assert parse_output("sweep_pi", "") is None
    assert parse_output("sweep_pi", None) is None
    assert parse_output("sweep_pi", HELLO_STDOUT) is None
    assert parse_output("parser_inexistente", SPMD_STDOUT) is None
