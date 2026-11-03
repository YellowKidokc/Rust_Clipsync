# Build context is the repo root (see docker-compose.yml): the image carries the vault API and the
# same React front end, built to talk to this container's own /api.
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV VITE_API_URL=/api
RUN npx vite build --outDir /web

FROM node:22-alpine
WORKDIR /srv
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=web /web ./web
ENV NODE_ENV=production PORT=8790 WEB_ROOT=/srv/web
EXPOSE 8790
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8790/api/health || exit 1
CMD ["node", "src/index.js"]
