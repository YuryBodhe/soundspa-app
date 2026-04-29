# ---------- ЭТАП СБОРКИ (BUILDER) ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm install

# Копируем исходники и собираем Next.js
COPY . .
RUN npm run build

# ---------- ЭТАП ЗАПУСКА (RUNNER) ----------
FROM node:20-alpine AS runner
WORKDIR /app

# Устанавливаем системную библиотеку для Next.js
RUN apk add --no-cache libc6-compat

# Копируем всё необходимое из билдера
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Копируем папки, которые нужны воркеру (cron-задачам)
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/db ./db

# Настраиваем окружение
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# По умолчанию запускаем сайт
CMD ["npm", "run", "start"]