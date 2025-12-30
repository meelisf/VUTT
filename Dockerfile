FROM python:3.9-slim

WORKDIR /app

# Install system dependencies if any (none strictly needed for current scripts, but good practice)
# RUN apt-get update && apt-get install -y --no-install-recommends ...

# Copy requirements if we had them. Since we use stdlib, we just copy scripts.
# COPY requirements.txt .
# RUN pip install -r requirements.txt

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
