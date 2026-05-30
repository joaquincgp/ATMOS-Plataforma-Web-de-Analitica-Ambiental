from __future__ import annotations

import argparse
import fnmatch
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def should_exclude(relative_path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(relative_path, pattern) for pattern in patterns)


def create_zip(source_dir: Path, output_path: Path, excludes: list[str]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_path, "w", ZIP_DEFLATED) as archive:
        for path in source_dir.rglob("*"):
            if not path.is_file():
                continue
            relative_path = path.relative_to(source_dir).as_posix()
            if should_exclude(relative_path, excludes):
                continue
            archive.write(path, relative_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a deployment zip with glob exclusions.")
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_path", type=Path)
    parser.add_argument("--exclude", action="append", default=[])
    args = parser.parse_args()

    create_zip(args.source_dir.resolve(), args.output_path.resolve(), args.exclude)


if __name__ == "__main__":
    main()
