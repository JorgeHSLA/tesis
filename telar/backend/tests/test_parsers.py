"""Suite 5 (architecture §11): los 6 parser_id contra los stdout LITERALES
de examples-content.md §6 (fixtures en tests/fixtures/stdout/).

Reglas §7.2: orden no determinista (solo conjunto), output truncado ⇒ null,
speedup(n)=t(1)/t(n), eficiencia(n)=speedup(n)/n, pair con
speedup_vs_reference = referencia/paralelo.
"""

from __future__ import annotations

import pytest

from app.services.output_parser import PARSER_IDS, parse_output

from conftest import load_stdout


def test_los_6_parser_ids_congelados():
    assert PARSER_IDS == {
        "none", "sweep_pi", "sweep_transporte",
        "pair_openmp_numpy", "pair_openmp_blas", "pair_parallel_serial",
    }


# ─────────────────────────────── sweep_pi ────────────────────────────────────


def test_sweep_pi_spmd_literal():
    result = parse_output("sweep_pi", load_stdout("sweep_pi_spmd.txt"))
    assert result["parser_id"] == "sweep_pi"
    assert result["kind"] == "sweep"
    assert result["correct"] is None and result["extra"] == {}
    series = result["series"]
    assert [p["threads"] for p in series] == [1, 2, 4, 8]
    assert series[0]["time_s"] == 0.812
    assert series[0]["speedup"] == 1.0 and series[0]["efficiency"] == 1.0
    # spmd NO escala (false sharing): speedup ~1 con 8 hilos — no es error
    assert series[3]["speedup"] == pytest.approx(0.812 / 0.902, abs=0.01)


def test_sweep_pi_critical_literal_escala():
    result = parse_output("sweep_pi", load_stdout("sweep_pi_critical.txt"))
    series = result["series"]
    assert series[1]["speedup"] == pytest.approx(0.812 / 0.418, abs=0.01)
    assert series[3]["speedup"] == pytest.approx(0.812 / 0.119, abs=0.01)
    assert series[3]["efficiency"] == pytest.approx(series[3]["speedup"] / 8, abs=0.01)


def test_sweep_orden_no_determinista():
    """Regla 2 §7.2: jamás asumir orden de líneas — solo conjunto."""
    shuffled = "\n".join(reversed(load_stdout("sweep_pi_critical.txt").splitlines()))
    result = parse_output("sweep_pi", shuffled)
    assert result is not None
    assert [p["threads"] for p in result["series"]] == [8, 4, 2, 1]
    by_threads = {p["threads"]: p for p in result["series"]}
    assert by_threads[1]["speedup"] == 1.0  # el baseline sigue siendo t(1)
    assert by_threads[8]["speedup"] == pytest.approx(0.812 / 0.119, abs=0.01)


def test_sweep_sin_baseline_devuelve_null():
    sin_uno = "\n".join(
        line for line in load_stdout("sweep_pi_critical.txt").splitlines()
        if not line.startswith("hilos = 1 ")
    )
    assert parse_output("sweep_pi", sin_uno) is None


# ─────────────────────────── sweep_transporte ────────────────────────────────


def test_sweep_transporte_literal_contrato():
    result = parse_output(
        "sweep_transporte", load_stdout("sweep_transporte.txt")
    )
    assert result["parser_id"] == "sweep_transporte"
    assert result["kind"] == "sweep"
    series = result["series"]
    # valores EXACTOS del ejemplo de api-contract §7.4
    assert series[0] == {
        "threads": 1, "time_s": 0.726, "speedup": 1.0, "efficiency": 1.0
    }
    assert series[1]["speedup"] == 2.84
    assert series[1]["efficiency"] == 1.42
    assert series[2]["speedup"] == 4.2
    assert series[3]["speedup"] == 7.98
    assert result["extra"] == {
        "transmitidas_pct": 2.35, "reflejadas_pct": 20.85, "absorbidas_pct": 76.8
    }
    assert result["correct"] is None


# ─────────────────────────────── pairs ───────────────────────────────────────


def test_pair_openmp_numpy_literal():
    result = parse_output(
        "pair_openmp_numpy", load_stdout("pair_suma_vectores.txt")
    )
    assert result == {
        "parser_id": "pair_openmp_numpy",
        "kind": "pair",
        "parallel_time_s": 0.0189,
        "reference_time_s": 0.0242,  # ojo al espacio de "numpy :" (§6)
        "reference_label": "numpy",
        "speedup_vs_reference": round(0.0242 / 0.0189, 2),
        "correct": True,
    }


def test_pair_openmp_blas_literal():
    result = parse_output("pair_openmp_blas", load_stdout("pair_matrices.txt"))
    assert result["reference_label"] == "blas"
    assert result["parallel_time_s"] == 0.412
    assert result["reference_time_s"] == 0.031  # np.dot con sufijo "(BLAS...)"
    assert result["speedup_vs_reference"] == round(0.031 / 0.412, 2)
    assert result["correct"] is True


def test_pair_parallel_serial_literal():
    result = parse_output(
        "pair_parallel_serial", load_stdout("pair_stencil.txt")
    )
    assert result["reference_label"] == "serial"
    assert result["parallel_time_s"] == 0.912
    assert result["reference_time_s"] == 0.989  # "serial  :" con 2 espacios
    assert result["speedup_vs_reference"] == 1.08  # del contrato §7.4
    assert result["correct"] is True  # "paralelo == serial? True"


def test_pair_correct_false():
    stdout = load_stdout("pair_suma_vectores.txt").replace(
        "correcto? True", "correcto? False"
    )
    result = parse_output("pair_openmp_numpy", stdout)
    assert result["correct"] is False


def test_pair_incompleto_devuelve_null():
    solo_paralelo = "tiempo openmp: 0.5 s\n"
    assert parse_output("pair_openmp_numpy", solo_paralelo) is None


# ─────────────────────────────── none ────────────────────────────────────────


@pytest.mark.parametrize("fixture", [
    "none_hello.txt",         # orden no determinista (impreso desde @njit)
    "none_for_pi.txt",
    "none_entorno_datos.txt",
    "none_mandelbrot.txt",    # valores irreproducibles A PROPÓSITO (no error)
    "none_monte_carlo.txt",
    "none_pi_task.txt",
    "none_fibonacci.txt",
])
def test_parser_none_jamas_parsea(fixture):
    assert parse_output("none", load_stdout(fixture)) is None


def test_asserts_de_correccion_presentes_en_fixtures():
    """Regla 6 §6: los valores sirven como verificación de corrección."""
    assert "pi = 3.141592653589794" in load_stdout("none_pi_task.txt")
    assert "fib( 35 ) = 9227465" in load_stdout("none_fibonacci.txt")
    assert "correcto? True" in load_stdout("pair_suma_vectores.txt")
    assert "paralelo == serial? True" in load_stdout("pair_stencil.txt")


# ────────────────────────── reglas transversales ─────────────────────────────


def test_truncado_jamas_se_parsea():
    stdout = load_stdout("sweep_transporte.txt")
    assert parse_output("sweep_transporte", stdout, truncated=True) is None
    assert parse_output("pair_openmp_numpy",
                        load_stdout("pair_suma_vectores.txt"),
                        truncated=True) is None


def test_stdout_vacio_o_none():
    assert parse_output("sweep_pi", "") is None
    assert parse_output("sweep_pi", None) is None


def test_parser_desconocido_no_rompe_el_finish():
    assert parse_output("parser_inventado", "hilos = 1 | ...") is None


def test_formato_que_no_casa_devuelve_null():
    assert parse_output("sweep_pi", load_stdout("none_hello.txt")) is None
    assert parse_output("sweep_transporte", load_stdout("none_fibonacci.txt")) is None
    assert parse_output("pair_parallel_serial", load_stdout("none_for_pi.txt")) is None


# ─────────────── fixes de auditoría (BL-03, BL-25, BL-26, BL-37) ──────────────


def test_bl03_hilos_cero_devuelve_null_sin_lanzar():
    """`hilos = 0` (posible con código editado por el estudiante) NO puede
    lanzar ZeroDivisionError: el docstring promete «jamás lanza» y la
    excepción reclasificaba un job exitoso como failed/sandbox_error."""
    stdout = (
        "hilos = 1 | pi = 3.141593 | tiempo = 0.812 s\n"
        "hilos = 0 | pi = 3.141593 | tiempo = 0.500 s\n"
    )
    assert parse_output("sweep_pi", stdout) is None


def test_bl03_hilos_cero_en_transporte_tampoco_lanza():
    stdout = (
        "hilos = 1 | tiempo = 0.726 s | transmitidas: 2.35 % "
        "| reflejadas: 20.85 % | absorbidas: 76.8 %\n"
        "hilos = 0 | tiempo = 0.100 s | transmitidas: 2.35 % "
        "| reflejadas: 20.85 % | absorbidas: 76.8 %\n"
    )
    assert parse_output("sweep_transporte", stdout) is None


@pytest.mark.parametrize("parser_id,stdout", [
    ("pair_openmp_numpy", "tiempo openmp: 0.02 s\ntiempo numpy : 0.000 s\n"),
    ("pair_openmp_blas", "tiempo openmp : 0.4 s\ntiempo np.dot : 0 s\n"),
    ("pair_parallel_serial", "tiempo paralelo: 0.9 s\ntiempo serial  : 0.000 s\n"),
])
def test_bl25_referencia_cero_o_negativa_devuelve_null(parser_id, stdout):
    """Regla general «algún time_s<=0 ⇒ None»: también para la referencia
    (antes producía speedup_vs_reference=0.0 mostrado como «0x»)."""
    assert parse_output(parser_id, stdout) is None


def test_bl26_hilos_duplicados_devuelve_null():
    """Dos líneas con el mismo N (re-impresión por bug del estudiante) ⇒
    serie corrupta: se descarta entera en vez de pintarla como válida."""
    stdout = (
        "hilos = 1 | pi = 3.141593 | tiempo = 0.812 s\n"
        "hilos = 2 | pi = 3.141593 | tiempo = 0.418 s\n"
        "hilos = 2 | pi = 3.141593 | tiempo = 0.430 s\n"
    )
    assert parse_output("sweep_pi", stdout) is None


def test_bl26_serie_parcial_sin_duplicados_sigue_siendo_valida():
    """Solo la duplicación invalida; un barrido parcial {1,2} es una serie
    legítima (el conjunto de hilos no está fijado por contrato)."""
    stdout = (
        "hilos = 1 | pi = 3.141593 | tiempo = 0.812 s\n"
        "hilos = 2 | pi = 3.141593 | tiempo = 0.418 s\n"
    )
    result = parse_output("sweep_pi", stdout)
    assert [p["threads"] for p in result["series"]] == [1, 2]


def test_bl37_efficiency_desde_tiempos_crudos_un_solo_redondeo():
    """efficiency = t(1)/(t(n)·n) redondeada UNA vez — no derivada del
    speedup ya redondeado (el doble redondeo desviaba el 2º decimal)."""
    stdout = (
        "hilos = 1 | pi = 3.141593 | tiempo = 1.0 s\n"
        "hilos = 2 | pi = 3.141593 | tiempo = 0.4926 s\n"
    )
    result = parse_output("sweep_pi", stdout)
    point = result["series"][1]
    # crudo: 1.0/(0.4926*2) = 1.01502… → 1.02. Con doble redondeo:
    # speedup=2.03 → 2.03/2 = 1.015 → 1.01 (desviado).
    assert point["speedup"] == 2.03
    assert point["efficiency"] == 1.02


# ───────── auditoría de métricas: el contrato «jamás lanza» y valores finitos ─────────

_SWEEP_PI_OK = "hilos = 1 | pi = 3.1 | tiempo = 1.0 s\n"
_GIGANTE = "9" * 400  # un solo float que desborda a inf


@pytest.mark.parametrize(
    ("parser_id", "stdout"),
    [
        ("sweep_pi", "hilos = 1 | pi = 3.1 | tiempo = 1.2.3 s"),
        ("sweep_pi", "hilos = 1 | pi = 3.1 | tiempo = . s"),
        (
            "sweep_transporte",
            "hilos = 1 | tiempo = 1.2.3 s | transmitidas: 1 % | reflejadas: 1 % | absorbidas: 1 %",
        ),
        (
            "sweep_transporte",
            "hilos = 1 | tiempo = 1 s | transmitidas: 1.2.3 % | reflejadas: 1 % | absorbidas: 1 %",
        ),
        ("pair_openmp_numpy", "tiempo openmp: 1.2.3 s\ntiempo numpy: 2 s"),
        ("pair_openmp_numpy", "tiempo openmp: 1 s\ntiempo numpy: . s"),
        ("pair_parallel_serial", "tiempo paralelo: 1.2.3 s\ntiempo serial: 2 s"),
    ],
)
def test_numero_malformado_devuelve_null_sin_lanzar(parser_id, stdout):
    # El regex `[\d.]+` casa «1.2.3» y «.»; float() lanzaría ValueError.
    # El docstring promete «jamás lanza»: el estudiante imprime lo que quiera.
    assert parse_output(parser_id, stdout) is None


@pytest.mark.parametrize(
    ("parser_id", "stdout"),
    [
        ("sweep_pi", _SWEEP_PI_OK + f"hilos = 2 | pi = 3 | tiempo = {_GIGANTE} s"),
        ("sweep_pi", f"hilos = 1 | pi = 3 | tiempo = {_GIGANTE} s"),
        ("pair_openmp_numpy", f"tiempo openmp: {_GIGANTE} s\ntiempo numpy: 2 s"),
        ("pair_openmp_numpy", f"tiempo openmp: 1 s\ntiempo numpy: {_GIGANTE} s"),
    ],
)
def test_tiempo_infinito_devuelve_null_no_nan(parser_id, stdout):
    # inf ⇒ speedup/eficiencia NaN ⇒ JSON inválido (NaN/Infinity). Se descarta.
    assert parse_output(parser_id, stdout) is None
