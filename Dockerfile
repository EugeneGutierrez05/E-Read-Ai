FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/elibrary.db
VOLUME /data
EXPOSE 3000
# JWT_SECRET (and ideally ADMIN_PASSWORD) MUST be provided at runtime
CMD ["node", "src/server.js"]
