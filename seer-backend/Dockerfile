FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir uv

COPY pyproject.toml README.md ./
COPY src ./src

RUN uv pip install --system .

EXPOSE 8000

CMD ["uvicorn", "seer_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
