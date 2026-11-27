# Esqueleto de Dockerfile para microservicios FastAPI — NO CAMBIAR su estructura.
# El puerto sale de `PORT` (lo fija docker-compose por servicio).
FROM python:3.12-slim
WORKDIR /app
ENV PORT=3116
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 3116
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
