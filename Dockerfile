FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME/bin:$PNPM_HOME:$PATH

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN mkdir -p "$PNPM_HOME" \
    && corepack enable \
    && pnpm install --frozen-lockfile

COPY --chown=node:node . .

ARG LOGOS_ANTHROPIC_API_KEY
RUN pnpm build
RUN mkdir -p logs .logos-runs && chown -R node:node logs .logos-runs

ENV NODE_ENV=production
ENV PORT=8080

USER node

EXPOSE 8080

CMD ["pnpm", "start"]
