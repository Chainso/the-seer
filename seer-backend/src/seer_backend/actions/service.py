"""Action orchestration service layer."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from uuid import UUID

from seer_backend.actions.errors import ActionDependencyUnavailableError
from seer_backend.actions.models import ActionCreate, ActionRecord
from seer_backend.actions.repository import (
    ActionsRepository,
    PostgresActionsRepository,
)
from seer_backend.config.settings import Settings


class ActionsService:
    """Repository-facing action orchestration service with schema bootstrap guard."""

    def __init__(self, repository: ActionsRepository) -> None:
        self._repository = repository
        self._schema_ready = False
        self._schema_lock = asyncio.Lock()

    async def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return
            await asyncio.to_thread(self._repository.ensure_schema)
            self._schema_ready = True

    async def create_action(self, action: ActionCreate) -> ActionRecord:
        await self.ensure_schema()
        return await asyncio.to_thread(self._repository.create_action, action)

    async def get_action(self, action_id: UUID) -> ActionRecord | None:
        await self.ensure_schema()
        return await asyncio.to_thread(self._repository.get_action, action_id)

    async def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        max_actions: int,
        lease_seconds: int,
    ) -> list[ActionRecord]:
        await self.ensure_schema()
        return await asyncio.to_thread(
            self._repository.claim_actions,
            user_id=user_id,
            instance_id=instance_id,
            max_actions=max_actions,
            lease_seconds=lease_seconds,
        )


class UnavailableActionsService:
    """Fallback service when action orchestration dependencies are unavailable."""

    def __init__(self, reason: str) -> None:
        self.reason = reason

    async def ensure_schema(self) -> None:
        raise ActionDependencyUnavailableError(self.reason)

    async def create_action(self, action: ActionCreate) -> ActionRecord:
        del action
        raise ActionDependencyUnavailableError(self.reason)

    async def get_action(self, action_id: UUID) -> ActionRecord | None:
        del action_id
        raise ActionDependencyUnavailableError(self.reason)

    async def claim_actions(
        self,
        *,
        user_id: str,
        instance_id: str,
        max_actions: int,
        lease_seconds: int,
    ) -> list[ActionRecord]:
        del user_id, instance_id, max_actions, lease_seconds
        raise ActionDependencyUnavailableError(self.reason)


def build_actions_service(settings: Settings) -> ActionsService | UnavailableActionsService:
    try:
        backend_root = Path(__file__).resolve().parents[3]
        migrations_dir = Path(settings.actions_db_migrations_dir)
        if not migrations_dir.is_absolute():
            migrations_dir = backend_root / migrations_dir

        repository = PostgresActionsRepository(
            dsn=settings.actions_db_dsn,
            migrations_dir=migrations_dir,
            pool_size=settings.actions_db_pool_size,
            max_overflow=settings.actions_db_max_overflow,
        )
        return ActionsService(repository=repository)
    except Exception as exc:  # pragma: no cover - tested through fallback behavior
        return UnavailableActionsService(f"actions service initialization failed: {exc}")


def inject_actions_service(app: Any, settings: Settings) -> None:
    app.state.actions_service = build_actions_service(settings)
