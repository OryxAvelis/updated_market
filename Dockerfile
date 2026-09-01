FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server

COPY server ./server
COPY admin ./admin
COPY css ./css
COPY img ./img
COPY js ./js
COPY *.html ./

RUN npm run check --prefix server \
  && npm prune --omit=dev --prefix server

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TRUST_PROXY=1 \
    TLS_TERMINATED_BY_PROXY=true \
    ENFORCE_PROXY_HTTPS_REDIRECT=false \
    BACK4APP_DYNAMIC_ORIGIN=true

WORKDIR /app

COPY --from=build --chown=node:node /app/server/package.json /app/server/package-lock.json ./server/
COPY --from=build --chown=node:node /app/server/node_modules ./server/node_modules
COPY --from=build --chown=node:node /app/server/src ./server/src
COPY --from=build --chown=node:node /app/server/scripts/migrate-and-start.js ./server/scripts/migrate-and-start.js
COPY --from=build --chown=node:node /app/server/certs/aiven-ca.pem ./server/certs/aiven-ca.pem
COPY --from=build --chown=node:node /app/admin ./admin
COPY --from=build --chown=node:node /app/css ./css
COPY --from=build --chown=node:node /app/img ./img
COPY --from=build --chown=node:node /app/js ./js
COPY --from=build --chown=node:node /app/*.html ./

USER node

EXPOSE 8080

CMD ["npm", "run", "start:with-migrations", "--prefix", "server"]
