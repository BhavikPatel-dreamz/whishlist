FROM node:20-alpine
RUN apk add --no-cache openssl libc6-compat
# Match local lockfile (pnpm 12 / lockfileVersion 9). Older pnpm fails on overrides.
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

# Repo uses pnpm (pnpm-lock.yaml), not npm package-lock.json.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

RUN (pnpm install --frozen-lockfile --prod || pnpm install --prod) \
  && pnpm remove @shopify/cli \
  && pnpm store prune

COPY . .

RUN pnpm exec prisma generate && pnpm run build

CMD ["pnpm", "run", "docker-start"]
