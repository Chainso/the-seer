"""Dedicated maintenance runtime for action lease-expiry reconciliation."""

from __future__ import annotations

import asyncio
import logging
import signal
from contextlib import suppress
from time import monotonic

from seer_backend.actions.service import (
    ActionsService,
    UnavailableActionsService,
    build_actions_service,
)
from seer_backend.config.settings import Settings
from seer_backend.logging import configure_logging


async def run_maintenance_loop(settings: Settings) -> int:
    """Run lease-expiry sweeps on a fixed interval until process shutdown."""

    logger = logging.getLogger(__name__)
    if not settings.actions_sweeper_enabled:
        logger.info("actions_sweeper_disabled")
        return 0

    service = build_actions_service(settings)
    if isinstance(service, UnavailableActionsService):
        logger.error("actions_sweeper_init_failed", extra={"reason": service.reason})
        return 1

    assert isinstance(service, ActionsService)
    interval_seconds = max(int(settings.actions_sweeper_interval_seconds), 1)
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop_event.set)

    logger.info(
        "actions_sweeper_started",
        extra={
            "interval_seconds": interval_seconds,
            "batch_size": settings.actions_sweeper_batch_size,
            "advisory_lock_id": settings.actions_sweeper_advisory_lock_id,
            "retry_delay_seconds": settings.actions_sweeper_retry_delay_seconds,
        },
    )

    while not stop_event.is_set():
        cycle_started = monotonic()
        try:
            stats = await service.sweep_expired_leases(
                advisory_lock_id=settings.actions_sweeper_advisory_lock_id,
                batch_size=settings.actions_sweeper_batch_size,
                retry_delay_seconds=settings.actions_sweeper_retry_delay_seconds,
            )
        except Exception as exc:  # pragma: no cover - process/runtime behavior
            logger.exception("actions_sweeper_cycle_failed", extra={"error": str(exc)})
        else:
            duration_ms = int((monotonic() - cycle_started) * 1000)
            level = logging.INFO if stats.leadership_acquired else logging.DEBUG
            logger.log(
                level,
                "actions_sweeper_cycle",
                extra={
                    "leadership_acquired": stats.leadership_acquired,
                    "scanned_actions": stats.scanned_actions,
                    "transitioned_retry_wait": stats.transitioned_retry_wait,
                    "transitioned_dead_letter": stats.transitioned_dead_letter,
                    "attempts_marked_lease_expired": stats.attempts_marked_lease_expired,
                    "dead_letter_upserts": stats.dead_letter_upserts,
                    "duration_ms": duration_ms,
                },
            )

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except TimeoutError:
            continue

    logger.info("actions_sweeper_stopped")
    return 0


def run() -> None:
    """CLI entrypoint for sweeper process."""

    settings = Settings()
    configure_logging(settings.log_level)
    raise SystemExit(asyncio.run(run_maintenance_loop(settings)))


if __name__ == "__main__":
    run()
