FROM python:3.12-slim

WORKDIR /app

# Install git (required for GitPython)
RUN apt-get update && apt-get install -y --no-install-recommends git poppler-utils openssh-client && rm -rf /var/lib/apt/lists/*

# Mark /data as safe directory for Git (mounted volume has different owner)
RUN git config --global --add safe.directory /data

# Install Python dependencies
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

# Copy application code
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY reference_data/ ./reference_data/

# Make sure scripts are executable
RUN chmod +x server/*.py

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV VUTT_DATA_DIR=/data

# Loo tühjad haakepunktid; runtime-olek tuleb hosti köitest, mitte image'ist.
RUN mkdir -p /data /app/state

# Expose ports
EXPOSE 8001
EXPOSE 8002

# Käivitus: kaks serverit ühes konteineris. Skript lõpetab konteineri, kui
# KUMB TAHES neist sureb, et `restart: always` saaks taastada (#388).
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Healthcheck katab MÕLEMAD pordid. Ta ei taaskäivita midagi (Docker ei
# taaskäivita `unhealthy` konteinerit) — taastuse teeb entrypoint'i `wait -n`;
# healthcheck teeb rippuva protsessi `docker ps`-is nähtavaks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python3 -c "import socket, urllib.request; urllib.request.urlopen('http://127.0.0.1:8002/health', timeout=4).read(); socket.create_connection(('127.0.0.1', 8001), timeout=4).close()"

CMD ["/app/docker-entrypoint.sh"]
