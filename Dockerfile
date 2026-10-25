# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/schema.sql ./schema.sql
COPY --from=builder /app/schema.pg.sql ./schema.pg.sql
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/neon.ts ./neon.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/src/constants ./src/constants
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Ensure data directory exists for local SQLite and daily automated backups
RUN mkdir -p data data/backups

EXPOSE 3000
CMD ["npm", "run", "start"]
