FROM node:24.22.1-bookworm AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run dashboard:build
RUN npm run build
RUN npm prune --omit=dev

FROM node:24.22.1-bookworm-slim

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY --from=builder /app/assets ./assets

ENV PORT=4000
EXPOSE ${PORT}
USER node

CMD ["node", "dist/app.js"]
