FROM conduit-builder:latest

WORKDIR /app

COPY --from=conduit-base:latest /app/packages /app/packages
COPY --from=conduit-base:latest /app/libraries/hermes /app/libraries/hermes
COPY --from=conduit-base:latest /app/libraries/node-2fa /app/libraries/node-2fa

RUN yarn install --production --pure-lockfile --non-interactive && yarn cache clean

#RUN apk del .gyp

WORKDIR /app/packages/core

ENV NODE_ENV production

# gRPC port
EXPOSE 55152
# HTTP port
EXPOSE 3030
# Socket port
EXPOSE 3031

CMD ["node", "dist/bin/www.js"]
