FROM conduit-builder:latest

WORKDIR /app

COPY --from=conduit-base:latest /app/modules/authentication /app/modules/authentication
COPY --from=conduit-base:latest /app/libraries/node-2fa /app/libraries/node-2fa

RUN apk update && \
    apk add --no-cache --virtual .gyp python3 make g++ && \
    yarn install --production --pure-lockfile --non-interactive && \
    yarn cache clean && \
    apk del .gyp

WORKDIR /app/modules/authentication

ENV NODE_ENV production

ENV CONDUIT_SERVER conduit_server

ENV SERVICE_URL 0.0.0.0:5000
ENV GRPC_PORT 5000

EXPOSE 5000

CMD ["node", "dist/index.js"]
