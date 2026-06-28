from __future__ import annotations

from app.services.ml_experiments.runner import ModelRunner

_RUNNERS: dict[str, ModelRunner] = {}


class ModelNotImplementedError(Exception):
    pass


def register_runner(name: str, runner: ModelRunner) -> None:
    _RUNNERS[name] = runner


def list_available_algorithms() -> list[str]:
    return sorted(_RUNNERS.keys())


def get_runner(name: str) -> ModelRunner:
    runner = _RUNNERS.get(name)
    if runner is None:
        available = ", ".join(label.upper() for label in list_available_algorithms()) or "ninguno"
        raise ModelNotImplementedError(
            f"El algoritmo '{name}' todavía no está implementado. Por ahora está(n) disponible(s): {available}."
        )
    return runner
