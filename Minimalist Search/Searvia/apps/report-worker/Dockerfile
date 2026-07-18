FROM node:24.17.0-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @searvia/report-worker... build
RUN pnpm --filter @searvia/report-worker deploy --prod /runtime

FROM node:24.17.0-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /runtime ./

USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]
