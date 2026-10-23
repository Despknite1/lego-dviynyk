# LEGO-Двійник: Node 20 + Python 3 (torso graphic helper). LDraw parts library is downloaded at build time.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pil curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY faces/catalog.json ./faces/catalog.json
COPY ldraw ./ldraw
ENV NODE_ENV=production LDRAW_DIR=/app/ldraw PORT=8787
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 8787
HEALTHCHECK CMD curl -fsS http://localhost:8787/healthz || exit 1
CMD ["node", "server.js"]
