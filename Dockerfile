FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run dashboard:build
RUN npm run build

FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY --from=builder /app/assets ./assets

ENV PORT=4000
EXPOSE ${PORT}

CMD ["node", "dist/app.js"]