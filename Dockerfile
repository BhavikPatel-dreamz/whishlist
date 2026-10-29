FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Repo uses pnpm (pnpm-lock.yaml), not npm package-lock.json.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile --prod \
  && pnpm remove @shopify/cli \
  && pnpm store prune

COPY . .

RUN pnpm exec prisma generate && pnpm run build

CMD ["pnpm", "run", "docker-start"]
