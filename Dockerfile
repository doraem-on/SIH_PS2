FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM python:3.12-slim-bookworm
WORKDIR /app
COPY --from=web /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=web /app/dist ./dist
COPY --from=web /app/node_modules ./node_modules
COPY package.json ./
COPY scripts/start.mjs scripts/http-policy.mjs ./scripts/
COPY ml ./ml
COPY models ./models
COPY scripts/prepare-models.py ./scripts/
RUN python scripts/prepare-models.py
COPY data/derived ./data/derived
ENV PYTHON=python HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
