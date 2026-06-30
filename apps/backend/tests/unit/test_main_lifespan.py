# Confirms app startup survives database errors beyond plain connectivity
# issues (e.g. a missing column from a schema that's out of sync), instead of
# crashing the whole process - this exact gap caused a production incident
# where reset_orphaned_jobs() raised ProgrammingError (not OperationalError)
# and took the entire app down.
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from sqlalchemy.exc import OperationalError, ProgrammingError

from app.main import lifespan


async def _noop_worker_loop() -> None:
    await asyncio.sleep(3600)


_DB_ERRORS = [OperationalError("stmt", {}, BaseException()), ProgrammingError("stmt", {}, BaseException())]


@pytest.mark.parametrize("error", _DB_ERRORS)
def test_lifespan_survives_reset_orphaned_jobs_database_errors(error: Exception) -> None:
    async def run() -> None:
        with (
            patch("app.main.settings") as mock_settings,
            patch("app.main.init_db") as mock_init_db,
            patch("app.main.reset_orphaned_jobs", side_effect=error) as mock_reset,
            patch("app.main.ml_job_worker_loop", side_effect=_noop_worker_loop),
        ):
            mock_settings.auto_init_db_on_startup = False
            async with lifespan(None):
                pass

        mock_init_db.assert_not_called()
        mock_reset.assert_called_once()

    asyncio.run(run())


@pytest.mark.parametrize("error", _DB_ERRORS)
def test_lifespan_survives_init_db_database_errors(error: Exception) -> None:
    async def run() -> None:
        with (
            patch("app.main.settings") as mock_settings,
            patch("app.main.init_db", side_effect=error) as mock_init_db,
            patch("app.main.reset_orphaned_jobs") as mock_reset,
            patch("app.main.ml_job_worker_loop", side_effect=_noop_worker_loop),
        ):
            mock_settings.auto_init_db_on_startup = True
            async with lifespan(None):
                pass

        mock_init_db.assert_called_once()
        mock_reset.assert_called_once()

    asyncio.run(run())
