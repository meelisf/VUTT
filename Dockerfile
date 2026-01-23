FROM python:3.9-slim

WORKDIR /app

# Install git (required for GitPython)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY state/ ./state/

# Make sure scripts are executable
RUN chmod +x server/*.py

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV VUTT_DATA_DIR=/data

# Create directory for data mount
RUN mkdir -p /data

# Expose ports
EXPOSE 8001
EXPOSE 8002

# Run both Python servers
CMD ["/bin/bash", "-c", "python3 server/file_server.py & python3 server/image_server.py & wait"]
