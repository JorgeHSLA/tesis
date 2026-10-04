# lastprivate y default(shared)

**Objetivo:** recuperar el valor de una variable privada al terminar el bucle con `lastprivate`, y declarar de forma explícita que las variables son compartidas con `default(shared)`.

## El problema que resuelve lastprivate

En la lección anterior viste que una variable `private` es una **copia** por hilo: al salir de la región, la variable original recupera el valor que tenía antes. Casi siempre es lo que quieres. Pero a veces necesitas el valor que dejó el bucle, como si se hubiera ejecutado en orden, de una sola vez.

Para eso existe `lastprivate`: la variable es privada durante el bucle, pero al terminar se copia de vuelta el valor de la **última iteración del bucle**.

## Explicación línea a línea

```python
@njit
def con_lastprivate(n):
    x = -1
    with openmp("parallel for lastprivate(x)"):
        for i in range(n):
            x = i * i
    return x
```

- `x = -1` = el valor antes de la región.
- `lastprivate(x)` = cada hilo trabaja con su propia `x`, igual que con `private`. Al final, `x` toma el valor de la iteración **i = n − 1**.
- `con_private(n)` es la misma función pero con `private(x)`: al salir, `x` vuelve a -1.
- `default(shared)` = todas las variables que no tengan otra cláusula son **compartidas**. Ya es el comportamiento por omisión de OpenMP; escribirlo deja la intención explícita en el código.

## Output real

Con 4 hilos:

```
lastprivate(x): x = 81
private(x):     x = -1
default(shared): a = [10. 20. 30. 40. 50.]
```

- **81 = 9 × 9**: el valor de la última iteración (i = 9), aunque esa iteración la haya hecho el hilo 3 y otro hilo haya terminado después. `lastprivate` sigue el **orden del bucle**, no el orden en que terminan los hilos.
- **-1**: con `private`, el trabajo de los hilos no sale de la región.
- **`default(shared)`**: `a` es compartido y cada hilo escribe en posiciones distintas, así que no hay condición de carrera.

## Lo que PyOMP no tiene

En C se usa mucho `default(none)`, que obliga a declarar cada variable como privada o compartida y así evita errores. En PyOMP 0.5.1 **`default(none)` no funciona**. Por eso `default(shared)` y declarar las privadas a mano son la forma de dejarlo claro.

## Pruébalo

Cambia la cantidad de hilos: `lastprivate(x)` siempre da 81. Luego cambia `n` a 20: ¿qué valor esperas?

## Para recordar

- `lastprivate(x)`: privada en el bucle; al final queda el valor de la **última iteración**.
- `private(x)`: privada en el bucle; al final vuelve el valor original.
- `default(shared)`: todo lo no declarado es compartido (es lo que ya pasa por omisión).
- `default(none)` no está disponible en PyOMP 0.5.1.
