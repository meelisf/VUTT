FROM python:3.9-slim

WORKDIR /app

# Install git (required for GitPython)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY file_server.py .
COPY image_server.py .
COPY users.json .
COPY start_services.sh .

# Make sure scripts are executable
RUN chmod +x start_services.sh

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV VUTT_DATA_DIR=/data

# Create directory for data mount
RUN mkdir -p /data

# Expose ports
EXPOSE 8001
EXPOSE 8002

# We will use a custom entrypoint script or supervisord to run both python scripts?
# For simplicity in Docker, usually one process per container is best.
# But since they share logic/resources, we can run them together with a shell script.
CMD ["/bin/bash", "-c", "python3 file_server.py & python3 image_server.py & wait"]
