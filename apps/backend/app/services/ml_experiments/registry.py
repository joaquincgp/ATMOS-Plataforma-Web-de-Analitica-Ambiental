from __future__ import annotations

from app.services.ml_experiments.runner import ModelRunner

_RUNNERS: dict[str, ModelRunner] = {}


class ModelNotImplementedError(Exception):
    pass


def register_runner(name: str, runner: ModelRunner) -> None:
    _RUNNERS[name] = runner


def get_runner(name: str) -> ModelRunner:
    runner = _RUNNERS.get(name)
    if runner is None:
        raise ModelNotImplementedError(
            f"El algoritmo '{name}' todavía no está implementado. "
            "Por ahora solo está disponible LSTM."
        )
    return runner
