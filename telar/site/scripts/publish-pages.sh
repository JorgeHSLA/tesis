#!/usr/bin/env bash
# publish-pages.sh — publica telar/site en GitHub Pages.
#
# El sitio VIVE en este repositorio (es parte del entregable de la tesis) pero
# se SIRVE desde telar-javeriana/telar, que es donde ya estan los releases: asi
# la pagina y los archivos que enlaza comparten organizacion, y no hace falta
# que nadie mas habilite nada en el repo de la tesis.
#
# Publica en la rama huerfana `gh-pages` de ese repositorio. Es huerfana a
# proposito: no comparte historia con `main`, asi que el repo de releases no
# acumula los commits del sitio en su rama principal.
#
# Uso:  bash scripts/publish-pages.sh
#
# Requiere `gh` autenticado con permiso de escritura en telar-javeriana/telar.

set -euo pipefail

REPO="telar-javeriana/telar"
BRANCH="gh-pages"
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v gh >/dev/null || { echo "error: falta 'gh' (GitHub CLI)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "error: 'gh' no esta autenticado"; exit 1; }

[[ -f "$SITE/index.html" && -f "$SITE/release.json" ]] \
  || { echo "error: $SITE no parece el sitio (falta index.html o release.json)"; exit 1; }

# Aviso, no bloqueo: publicar una version distinta de la ultima puede ser
# deliberado (por ejemplo, corregir la pagina sin tocar el release).
# Se lee con sed y no con node: en Git Bash sobre Windows la ruta de $SITE es
# de estilo POSIX (/c/Users/...) y node no la resuelve.
LAST_TAG="$(gh release view -R "$REPO" --json tagName --jq .tagName)"
SITE_TAG="$(sed -n 's/.*"tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SITE/release.json" | head -1)"
if [[ "$LAST_TAG" != "$SITE_TAG" ]]; then
  echo "aviso: release.json apunta a $SITE_TAG y el ultimo release es $LAST_TAG."
  echo "       Si no es intencionado: node scripts/sync-release.mjs"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "clonando $REPO ($BRANCH)…"
if gh api "repos/$REPO/branches/$BRANCH" >/dev/null 2>&1; then
  gh repo clone "$REPO" "$WORK" -- --branch "$BRANCH" --single-branch --depth 1
else
  echo "  la rama no existe todavia: se crea huerfana"
  gh repo clone "$REPO" "$WORK" -- --depth 1
  git -C "$WORK" checkout --orphan "$BRANCH"
  git -C "$WORK" rm -rf . >/dev/null 2>&1 || true
fi

# Se borra el contenido anterior para que un archivo retirado del sitio
# desaparezca tambien de la publicacion.
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

cp "$SITE/index.html" "$SITE/styles.css" "$SITE/app.js" "$SITE/release.json" \
   "$SITE/favicon.svg" "$WORK/"
# Sin esto Pages pasa el sitio por Jekyll, que ignora lo que empiece por «_».
touch "$WORK/.nojekyll"

cd "$WORK"
git add -A
if git diff --cached --quiet; then
  echo "no hay cambios que publicar."
  exit 0
fi

git commit -q -m "sitio de descargas: $SITE_TAG ($(date -u +%Y-%m-%d))"
git push -q origin "$BRANCH"

echo
echo "publicado."
echo "  https://telar-javeriana.github.io/telar/"
echo
echo "Si es la primera vez, habilita Pages una sola vez:"
echo "  gh api -X POST repos/$REPO/pages -f 'source[branch]=$BRANCH' -f 'source[path]=/'"
