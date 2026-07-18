FROM node:24.17.0-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @searvia/crawler-worker... build
RUN pnpm --filter @searvia/crawler-worker deploy --prod /runtime

FROM node:24.17.0-alpine AS runtime

ENV NODE_ENV=production
ENV CRAWL_RENDER_BROWSER_EXECUTABLE=/usr/bin/chromium-browser
WORKDIR /app

RUN apk add --no-cache chromium

COPY --from=build --chown=node:node /runtime ./

USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
