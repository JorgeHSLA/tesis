# Telar — Makefile raíz (architecture.md §10.3)
#
# REGLA WSL2 / ext4 (architecture.md §9-§10, encapsulada aquí):
#   El repo vive en /mnt/d (drvfs, ~10x más lento y sin symlinks fiables).
#   npm ci / builds / contextos docker NUNCA se ejecutan sobre /mnt/d:
#   los targets build-* sincronizan el paquete a $(BUILD_ROOT) (ext4),
#   compilan allí y copian de vuelta SOLO los artefactos (dist/,
#   package-lock.json). node_modules jamás se crea en /mnt/d.
#   Los targets dev-* asumen que se invocan desde un clon de trabajo en
#   ext4 (~/dev/telar) o desde $(BUILD_ROOT) ya sincronizado.

SHELL      := /bin/bash
ROOT       := $(CURDIR)
BUILD_ROOT ?= $(HOME)/.telar-build
NVM        := export NVM_DIR="$$HOME/.nvm" && . "$$NVM_DIR/nvm.sh" &&

RSYNC_EXCLUDES := --exclude node_modules --exclude dist --exclude dist-electron \
                  --exclude release --exclude .venv --exclude __pycache__ \
                  --exclude .vite --exclude '*.db'

.PHONY: dev-backend dev-frontend dev-desktop build-runner build-images up down \
        test dist sync-repo sync-frontend sync-desktop build-frontend build-desktop \
        check-contract publish-images

## ── Dev multi-proceso (backend nativo WSL + Vite + Electron) ────────────────
dev-backend:            ## uvicorn con reload (nativo WSL; DB y jobs en ~/.telar)
	mkdir -p $(HOME)/.telar
	cd backend && uvicorn app.main:app --reload --port 8000

dev-frontend:           ## Vite dev server :5173
	$(NVM) npm --prefix frontend run dev

dev-desktop:            ## esbuild watch + electron apuntando a Vite
	$(NVM) npm --prefix desktop run dev

## ── Imágenes Docker (contexto SIEMPRE en ext4) ──────────────────────────────
sync-repo:              ## repo → $(BUILD_ROOT)/repo (ext4)
	mkdir -p $(BUILD_ROOT)/repo
	rsync -a --delete $(RSYNC_EXCLUDES) $(ROOT)/ $(BUILD_ROOT)/repo/

build-runner: sync-repo ## construye la imagen telar-runner (perfil build)
	cd $(BUILD_ROOT)/repo && docker compose --profile build build runner

build-images: sync-repo ## compose build frontend backend + runner
	cd $(BUILD_ROOT)/repo && docker compose build frontend backend
	cd $(BUILD_ROOT)/repo && docker compose --profile build build runner

up: sync-repo           ## compose up -d (desde el clon ext4)
	cd $(BUILD_ROOT)/repo && docker compose up -d

down:
	cd $(BUILD_ROOT)/repo && docker compose down

## ── Builds npm encapsulados (rsync → ext4 → build → artefactos de vuelta) ──
sync-frontend:
	mkdir -p $(BUILD_ROOT)/frontend
	rsync -a --delete $(RSYNC_EXCLUDES) $(ROOT)/frontend/ $(BUILD_ROOT)/frontend/

build-frontend: sync-frontend  ## npm ci + tsc + vite build en ext4; trae dist/ y lock
	$(NVM) cd $(BUILD_ROOT)/frontend && npm ci && npx tsc --noEmit && npm run build
	rsync -a --delete $(BUILD_ROOT)/frontend/dist/ $(ROOT)/frontend/dist/
	cp $(BUILD_ROOT)/frontend/package-lock.json $(ROOT)/frontend/package-lock.json

sync-desktop:
	mkdir -p $(BUILD_ROOT)/desktop
	rsync -a --delete $(RSYNC_EXCLUDES) $(ROOT)/desktop/ $(BUILD_ROOT)/desktop/

build-desktop: sync-desktop    ## npm ci + esbuild + typecheck en ext4
	$(NVM) cd $(BUILD_ROOT)/desktop && npm ci && npm run build && npm run typecheck
	cp $(BUILD_ROOT)/desktop/package-lock.json $(ROOT)/desktop/package-lock.json

## ── Tests y distribución ────────────────────────────────────────────────────
test:                   ## pytest backend + vitest frontend (en ext4)
	cd backend && python -m pytest
	$(NVM) npm --prefix frontend run test

check-contract:         ## telar.d.ts (frontend) == telar-api.d.ts (desktop)
	cmp frontend/src/types/telar.d.ts desktop/types/telar-api.d.ts \
	  && echo "contrato window.telar: OK (idénticos)"

# electron-builder resuelve extraResources '../frontend/dist' relativo a
# desktop/, por eso build-frontend deja el dist en $(BUILD_ROOT)/frontend/dist.
dist: build-frontend build-desktop  ## vite build + electron-builder --linux
	export ELECTRON_CACHE=$(HOME)/.cache/electron && \
	export ELECTRON_BUILDER_CACHE=$(HOME)/.cache/electron-builder && \
	$(NVM) cd $(BUILD_ROOT)/desktop && npx electron-builder --linux
	rsync -a $(BUILD_ROOT)/desktop/release/ $(ROOT)/desktop/release/

## ── Publicación de imágenes a GHCR (electron-spec.md §6.1, modo A) ──────────
# El compose EMPAQUETADO (desktop/resources/compose/compose.yaml) referencia
# estas imágenes por tag fijo. Sin publicarlas, el instalador distribuido a
# terceros no puede levantar el stack (`up -d` falla al no poder hacer pull).
# Requiere login previo:
#   echo $$GHCR_TOKEN | docker login ghcr.io -u TU_USUARIO --password-stdin
# (token clásico de GitHub con scope `write:packages`).
#
# Tras el primer push las imágenes nacen PRIVADAS: hay que marcarlas públicas
# a mano en github.com/orgs/$(GHCR_OWNER)/packages -> cada paquete ->
# Package settings -> Change visibility -> Public. Si no, el instalador solo
# funciona para quien tenga credenciales.
GHCR_OWNER      ?= telar-javeriana
GHCR_REGISTRY   ?= ghcr.io/$(GHCR_OWNER)
BACKEND_VERSION ?= 1.0.1
RUNNER_VERSION  ?= 0.5.1

.PHONY: publish-images
publish-images: build-images build-runner  ## etiqueta y sube backend+runner a GHCR
	docker tag telar-backend:latest $(GHCR_REGISTRY)/telar-backend:$(BACKEND_VERSION)
	docker tag telar-runner:$(RUNNER_VERSION) $(GHCR_REGISTRY)/telar-runner:$(RUNNER_VERSION)
	docker push $(GHCR_REGISTRY)/telar-backend:$(BACKEND_VERSION)
	docker push $(GHCR_REGISTRY)/telar-runner:$(RUNNER_VERSION)
	@echo "Publicadas. Recuerda marcarlas PÚBLICAS en GitHub Packages."
