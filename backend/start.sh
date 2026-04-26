#!/bin/bash
set -e
# Download data files first (blocks until done, but Railway now has 10min window)
python download_data.py
# Start the API
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
