# ---------- ЭТАП СБОРКИ (BUILDER) ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Устанавливаем ВСЕ зависимости (включая dev для сборки и tsx)
COPY package*.json ./
RUN npm install

# Копируем всё и собираем Next.js (чтобы сайт работал)
COPY . .
RUN npm run build

# ---------- ЭТАП ЗАПУСКА (RUNNER) ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Копируем зависимости и результаты сборки
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.json ./drizzle.config.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Копируем папки, которые нужны для работы воркера
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/db ./db

# Настраиваем окружение
ENV NODE_ENV=production

# Команда по умолчанию (для сайта)
# В docker-compose.yml для воркера мы её переопределим
CMD ["npm", "run", "start"]