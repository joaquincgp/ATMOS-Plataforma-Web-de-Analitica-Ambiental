from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_PACKAGE_DIR = Path(__file__).resolve().parent
_MODELS_DIR = _PACKAGE_DIR / "models"

# Fixed allowlist: the API never reads a path supplied by a client, only one
# of these four known files, so there is no path-traversal surface here.
_SOURCE_FILES: dict[str, tuple[Path, str]] = {
    "dataset": (_PACKAGE_DIR / "dataset.py", "Pipeline de datos compartido"),
    "lstm": (_MODELS_DIR / "lstm.py", "Modelo LSTM"),
    "gru": (_MODELS_DIR / "gru.py", "Modelo GRU"),
    "transformer": (_MODELS_DIR / "transformer.py", "Modelo Transformer"),
}


@dataclass(frozen=True)
class ModelSourceFile:
    key: str
    filename: str
    label: str
    content: str


def list_model_source_files() -> list[ModelSourceFile]:
    files: list[ModelSourceFile] = []
    for key, (path, label) in _SOURCE_FILES.items():
        source_path = Path(path)
        files.append(
            ModelSourceFile(
                key=key,
                filename=source_path.name,
                label=label,
                content=source_path.read_text(encoding="utf-8"),
            )
        )
    return files
