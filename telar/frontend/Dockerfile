# frontend/Dockerfile — multi-stage node:22 build -> nginx:alpine
# (architecture.md §10.2). El contexto de build se ejecuta SIEMPRE desde el
# clon ext4 (make build-images), nunca desde /mnt/d.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Variante de autoría (build-time, ver src/config.ts): 0 = ESTUDIANTE (default, sin
# la UI de autoría en el bundle); 1 = ADMIN. Lo pasa compose.admin.yaml.
ARG VITE_ADMIN=0
ENV VITE_ADMIN=$VITE_ADMIN
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
