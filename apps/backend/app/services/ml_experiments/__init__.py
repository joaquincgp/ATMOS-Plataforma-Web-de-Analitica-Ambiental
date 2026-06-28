from app.services.ml_experiments.models.gru import GruModelRunner
from app.services.ml_experiments.models.lstm import LstmModelRunner
from app.services.ml_experiments.models.transformer import TransformerModelRunner
from app.services.ml_experiments.registry import get_runner, register_runner

register_runner("lstm", LstmModelRunner())
register_runner("gru", GruModelRunner())
register_runner("transformer", TransformerModelRunner())

__all__ = ["get_runner", "register_runner"]
