from __future__ import annotations

from app.services.ml_experiments.registry import ModelNotImplementedError, get_runner, register_runner

# Mutable flag kept in a dict so registration state can be updated without a
# module-level `global` rebind (which pylint flags as global-statement).
_REGISTRATION_STATE = {"done": False}


def _register_all() -> None:
    if _REGISTRATION_STATE["done"]:
        return
    # Imports are deferred here so that PyTorch is never loaded at web server
    # startup — only when the first training job actually runs.
    from app.services.ml_experiments.models.gru import GruModelRunner
    from app.services.ml_experiments.models.lstm import LstmModelRunner
    from app.services.ml_experiments.models.transformer import TransformerModelRunner

    register_runner("lstm", LstmModelRunner())
    register_runner("gru", GruModelRunner())
    register_runner("transformer", TransformerModelRunner())
    _REGISTRATION_STATE["done"] = True


def get_runner_lazy(name: str) -> object:
    _register_all()
    return get_runner(name)


__all__ = ["ModelNotImplementedError", "get_runner", "get_runner_lazy", "register_runner"]
