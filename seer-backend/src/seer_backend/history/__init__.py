"""History domain package."""

from seer_backend.history.service import HistoryService, UnavailableHistoryService

__all__ = ["HistoryService", "UnavailableHistoryService"]
