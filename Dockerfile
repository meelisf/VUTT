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

# Vaikimisi käsk = file server. Pildiserver jookseb SAMAST image'ist eraldi
# compose-teenusena (`images`, #388). Healthcheck ja init on compose'is,
# teenuse kaupa.
CMD ["python3", "-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8002"]
