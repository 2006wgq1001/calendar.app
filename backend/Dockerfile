FROM node:20-slim AS frontend_builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY . .
COPY --from=frontend_builder /app/frontend/build /app/frontend/build
RUN if [ -f backend/requirements.txt ]; then \
			pip install --no-cache-dir -r backend/requirements.txt; \
		elif [ -f requirements.txt ]; then \
			pip install --no-cache-dir -r requirements.txt; \
		else \
			echo "requirements.txt not found"; exit 1; \
		fi
CMD ["sh", "-c", "if [ -f /app/backend/app.py ]; then cd /app/backend; fi; gunicorn --worker-class eventlet -w 1 app:app --bind 0.0.0.0:${PORT:-8080}"]