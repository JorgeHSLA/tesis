import numpy as np
from numba.openmp import njit
from numba.openmp import openmp_context as openmp
from numba.openmp import omp_get_thread_num, omp_set_num_threads, omp_get_wtime

# Transporte de particulas por Monte Carlo (version educativa 1D).
# Es EL caso de uso real de PyOMP en simuladores: el codigo MCDC-TNT de
# transporte de neutrones (Oregon State / CEMeNT) usa exactamente este patron
# con numba.openmp en produccion.
#
# Fisica simplificada: una particula entra en una placa (slab) de espesor L.
# Recorre una distancia libre aleatoria d = -ln(r)/sigma_t; al chocar, o es
# absorbida (prob_abs) o rebota en direccion aleatoria (dispersion isotropica).
# Contamos cuantas particulas ATRAVIESAN, REBOTAN hacia atras o son ABSORBIDAS.

A = np.uint64(1664525)        # generador congruencial lineal (LCG) de 32 bits:
C = np.uint64(1013904223)     # cada hilo lleva su propio estado -> sin races
MASK = np.uint64(0xFFFFFFFF)
DIV = 4294967296.0


@njit
def transporte_slab(num_part, espesor, sigma_t, prob_abs, num_threads):
    omp_set_num_threads(num_threads)
    seeds = np.empty(num_threads, dtype=np.uint64)
    for t in range(num_threads):
        seeds[t] = np.uint64(7919 + 104729 * t)  # semilla distinta por hilo

    transmitidas = 0
    reflejadas = 0
    absorbidas = 0

    t0 = omp_get_wtime()
    with openmp("parallel private(tid, s, x, mu, r, dist, viva) shared(seeds)"):
        tid = omp_get_thread_num()
        s = seeds[tid]  # estado del RNG: privado del hilo
        with openmp("for reduction(+:transmitidas, reflejadas, absorbidas)"):
            for p in range(num_part):
                x = 0.0    # posicion: entra por la cara izquierda
                mu = 1.0   # direccion: hacia adentro (+1)
                viva = True
                while viva:
                    s = (A * s + C) & MASK
                    r = s / DIV
                    dist = -np.log(r + 1e-12) / sigma_t  # camino libre medio
                    x = x + mu * dist
                    if x < 0.0:
                        reflejadas += 1      # salio por donde entro
                        viva = False
                    elif x > espesor:
                        transmitidas += 1    # atraveso la placa
                        viva = False
                    else:
                        s = (A * s + C) & MASK
                        r = s / DIV
                        if r < prob_abs:
                            absorbidas += 1  # el material la absorbio
                            viva = False
                        else:
                            # dispersion isotropica: nueva direccion en [-1, 1]
                            s = (A * s + C) & MASK
                            mu = 2.0 * (s / DIV) - 1.0
    elapsed = omp_get_wtime() - t0
    return transmitidas, reflejadas, absorbidas, elapsed


NUM_PART = 5_000_000
ESPESOR = 5.0     # espesor de la placa (en caminos libres medios ~ 1/sigma_t)
SIGMA_T = 1.0     # seccion eficaz total
PROB_ABS = 0.3    # probabilidad de absorcion en cada choque

transporte_slab(1000, ESPESOR, SIGMA_T, PROB_ABS, 1)  # warmup JIT

for nths in (1, 2, 4, 8):
    tr, re, ab, secs = transporte_slab(NUM_PART, ESPESOR, SIGMA_T, PROB_ABS, nths)
    total = tr + re + ab
    print("hilos =", nths, "| tiempo =", round(secs, 3), "s",
          "| transmitidas:", round(100.0 * tr / total, 2), "%",
          "| reflejadas:", round(100.0 * re / total, 2), "%",
          "| absorbidas:", round(100.0 * ab / total, 2), "%")
