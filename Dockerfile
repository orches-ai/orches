# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /build
COPY orches/frontend/package*.json ./
RUN npm ci
COPY orches/frontend/ .
RUN npm run build

# ── Stage 2: Python backend ───────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Install Python deps
COPY orches/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY orches/ .

# Copy built frontend
COPY --from=frontend /build/dist ./frontend/dist

# Persistent data dirs (overridden by Docker volumes)
RUN mkdir -p data workspace registry/agents

EXPOSE 8000

ENV ORCHES_ENV=production

CMD ["python", "main.py"]
