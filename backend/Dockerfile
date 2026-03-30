FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY frontend_bundle/ ./frontend_build/

CMD ["sh", "-c", "gunicorn --worker-class eventlet -w 1 app:app --bind 0.0.0.0:${PORT:-8080}"]