# Parcero Seguro: API (Fastify) + PWA compilada en un solo contenedor.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev -w apps/api --include-workspace-root=false
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist
# Sin privilegios de root.
RUN chown -R node:node /app
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
