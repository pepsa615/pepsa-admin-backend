FROM node:22.14-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm prisma:generate && pnpm build

FROM node:22.14-alpine AS runtime
ENV NODE_ENV=production
RUN corepack enable && addgroup -S pepsa && adduser -S pepsa -G pepsa
WORKDIR /app
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/prisma ./prisma
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
USER pepsa
EXPOSE 3300
CMD ["node", "dist/start.js"]
