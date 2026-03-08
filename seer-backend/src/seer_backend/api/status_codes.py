"""FastAPI status-code compatibility helpers."""

from fastapi import status

# FastAPI deprecated the older 413/422 aliases while keeping the numeric codes unchanged.
HTTP_413_CONTENT_TOO_LARGE = getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413)
HTTP_422_UNPROCESSABLE_CONTENT = getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422)
