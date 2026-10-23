# Servicio de llamadas de Parcero Seguro (Pipecat + WhatsApp Calling API).
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
# Librerías de sistema que usan el audio (Opus) y el cifrado de WebRTC.
RUN apt-get update && apt-get install -y --no-install-recommends libopus0 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app.py bot.py prompt.py ./
RUN useradd -m -u 10001 appuser && chown -R appuser /app
USER appuser
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
