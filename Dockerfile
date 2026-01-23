FROM python:3.9-slim

WORKDIR /app

# Install git (required for GitPython)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Mark /data as safe directory for Git (mounted volume has different owner)
RUN git config --global --add safe.directory /data

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
CMD ["/bin/bash", "-c", "python3 -m server.file_server & python3 -m server.image_server & wait"]
