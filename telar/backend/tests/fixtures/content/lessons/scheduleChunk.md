# Bloque contra cíclico: el chunk de schedule(static)

**Objetivo:** ver qué iteraciones le tocan a cada hilo según el `schedule`, y por qué el reparto cíclico equilibra el trabajo cuando las iteraciones no cuestan lo mismo.

## Dos formas de repartir

En la suma de vectores usaste `schedule(static, 1000)`. El número después de la coma es el **chunk**: el tamaño de los trozos que se reparten entre los hilos por turnos.

- **`schedule(static)`**, sin chunk: el bucle se parte en **un bloque por hilo**. El hilo 0 hace el primer cuarto, el hilo 1 el segundo, y así.
- **`schedule(static, 1)`**: trozos de **una iteración**, repartidos por turnos. El hilo 0 hace la 0, la 4, la 8…; el hilo 1 la 1, la 5, la 9… Es el reparto **cíclico**.

## Quién hace cada iteración

El ejemplo guarda, para cada iteración, el número del hilo que la hizo. Con 12 iteraciones y 4 hilos:

```
schedule(static):     [0 0 0 1 1 1 2 2 2 3 3 3]
schedule(static, 1):  [0 1 2 3 0 1 2 3 0 1 2 3]
```

Las dos formas reparten 3 iteraciones a cada hilo. La diferencia es **cuáles**.

## Cuando las iteraciones no cuestan lo mismo

Ahora supón que la iteración `i` cuesta `i` unidades de trabajo: las últimas son mucho más caras que las primeras. Es lo que pasa, por ejemplo, al recorrer una matriz triangular. El ejemplo suma el trabajo de cada hilo con 1000 iteraciones:

```
schedule(static):     [ 31125  93625 156125 218625]
schedule(static, 1):  [124500 124750 125000 125250]
```

- **En bloque**, el hilo 3 recibe todas las iteraciones caras: hace **7 veces más trabajo** que el hilo 0. Los otros tres terminan antes y se quedan esperándolo; el programa tarda lo que tarde el hilo más cargado.
- **En cíclico**, cada hilo recibe iteraciones baratas y caras mezcladas: el trabajo queda **casi igual** para todos.

## Lo que PyOMP no tiene

En C, el remedio habitual para el trabajo desigual es `schedule(dynamic)`: los hilos piden trozos a medida que terminan. En PyOMP 0.5.1 **solo existe `schedule(static)`**, y el chunk debe ser un número fijo escrito en la directiva. El reparto cíclico con `static, 1` es la herramienta que sí tienes.

## Pruébalo

Cambia el chunk a 2 en `duenos_ciclico`: ¿cómo queda la lista de dueños?

## Para recordar

- `schedule(static)`: un bloque contiguo por hilo.
- `schedule(static, N)`: trozos de N iteraciones repartidos por turnos.
- Si las iteraciones cuestan distinto, el bloque deja hilos sobrecargados y el cíclico equilibra.
- En PyOMP 0.5.1 no hay `dynamic` ni `guided`, y el chunk debe ser constante.
