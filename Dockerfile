# syntax=docker/dockerfile:1

# One long-running Next server. Deployed incident, camera, GPS and signaling
# state use configured Blob storage; a single process does not replace it.
# The Python/native pipeline is deployed separately.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The Mapbox token is a public browser token and Next inlines it at build time,
# so it has to be present here rather than supplied at boot.
ARG NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=""
ENV NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=$NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
# Left unset on purpose: every role route is served from this one image.
ENV PAW_PATROL_WORKSPACE=""
RUN pnpm run build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=8080
COPY --from=build /app/.next/standalone ./
# server.js serves neither of these on its own.
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
