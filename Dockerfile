FROM node:24 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run dashboard:build
RUN npm run build

FROM node:24

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/dashboard/dist ./dashboard/dist
COPY --chown=node:node --from=builder /app/assets ./assets

ENV PORT=4000
EXPOSE ${PORT}
USER node

CMD ["node", "dist/app.js"]
