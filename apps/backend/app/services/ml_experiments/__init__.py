from app.services.ml_experiments.models.lstm import LstmModelRunner
from app.services.ml_experiments.registry import get_runner, register_runner

register_runner("lstm", LstmModelRunner())

__all__ = ["get_runner", "register_runner"]
