from __future__ import annotations

from app.services.ml_experiments.registry import ModelNotImplementedError, get_runner, register_runner

_runners_registered = False


def _register_all() -> None:
    global _runners_registered
    if _runners_registered:
        return
    # Imports are deferred here so that PyTorch is never loaded at web server
    # startup — only when the first training job actually runs.
    from app.services.ml_experiments.models.gru import GruModelRunner
    from app.services.ml_experiments.models.lstm import LstmModelRunner
    from app.services.ml_experiments.models.transformer import TransformerModelRunner

    register_runner("lstm", LstmModelRunner())
    register_runner("gru", GruModelRunner())
    register_runner("transformer", TransformerModelRunner())
    _runners_registered = True


def get_runner_lazy(name: str) -> object:
    _register_all()
    return get_runner(name)


__all__ = ["ModelNotImplementedError", "get_runner", "get_runner_lazy", "register_runner"]
