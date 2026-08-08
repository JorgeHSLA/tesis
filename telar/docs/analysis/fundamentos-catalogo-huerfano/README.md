# `fundamentos/` — catálogo huérfano (movido fuera de `app/content/`)

**Origen:** estaba en `backend/app/content/fundamentos/`. La auditoría de lógica
de negocio (BL-27, `docs/audits/business-logic-audit.md`) lo marcó como
**contenido muerto**: 4 módulos / 23 lecciones / 2 quizzes que ningún `.py`
referencia y que el seeder/loader (`ContentRepository.from_fixtures` /
`seed_content`) nunca carga —solo leen el `catalog.json` superior de
`app/content/`—. Además su esquema es **incompatible** con el modelo actual
(lecciones sin `example` pareado, claves distintas), así que `_CatalogFx` no
podría cargarlo tal cual.

**Decisión (auditoría S4, zona gris 8):** NO integrarlo. Se mueve aquí como
material de una posible fase futura ("Fundamentos de paralelismo" previo a
OpenMP). Integrarlo requeriría extender el modelo a lecciones sin ejemplo y
reescribir el seeder; queda fuera del alcance actual.

**Si algún día se integra:** habrá que adaptar el esquema al de
`app/content/catalog.json` (o extender `ContentRepository`/`seed_content` para
lecciones sin ejemplo pareado) y mover el material de vuelta bajo el content
servido.
