#!/bin/bash
set -e
python download_data.py
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
