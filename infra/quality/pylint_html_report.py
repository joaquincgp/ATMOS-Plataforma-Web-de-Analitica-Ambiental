from __future__ import annotations

import argparse
import html
import json
from collections import Counter
from pathlib import Path
from typing import Any


TYPE_LABELS = {
    "convention": "Convention",
    "refactor": "Refactor",
    "warning": "Warning",
    "error": "Error",
    "fatal": "Fatal",
    "info": "Info",
}


def build_report(findings: list[dict[str, Any]], project_name: str) -> str:
    by_type = Counter(str(item.get("type", "unknown")) for item in findings)
    by_symbol = Counter(str(item.get("symbol", "unknown")) for item in findings)
    by_file = Counter(str(item.get("path", item.get("module", "unknown"))) for item in findings)

    rows = []
    for item in findings:
        msg_type = str(item.get("type", "unknown"))
        symbol = str(item.get("symbol", "unknown"))
        message_id = str(item.get("message-id", item.get("message_id", "")))
        path = str(item.get("path", item.get("module", "unknown")))
        line = item.get("line", "")
        column = item.get("column", "")
        message = str(item.get("message", ""))
        obj = str(item.get("obj", ""))

        rows.append(
            "<tr>"
            f"<td>{html.escape(TYPE_LABELS.get(msg_type, msg_type.title()))}</td>"
            f"<td><code>{html.escape(message_id)}</code></td>"
            f"<td><code>{html.escape(symbol)}</code></td>"
            f"<td>{html.escape(path)}</td>"
            f"<td>{html.escape(str(line))}:{html.escape(str(column))}</td>"
            f"<td>{html.escape(obj)}</td>"
            f"<td>{html.escape(message)}</td>"
            "</tr>"
        )

    type_items = "".join(
        f"<li>{html.escape(TYPE_LABELS.get(msg_type, msg_type.title()))}: {count}</li>"
        for msg_type, count in by_type.most_common()
    )
    symbol_items = "".join(
        f"<li><code>{html.escape(symbol)}</code>: {count}</li>" for symbol, count in by_symbol.most_common(10)
    )
    file_items = "".join(
        f"<li>{html.escape(path)}: {count}</li>" for path, count in by_file.most_common(10)
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pylint Report - {html.escape(project_name)}</title>
  <style>
    body {{ margin: 0; font-family: Inter, Segoe UI, Arial, sans-serif; color: #1f2937; background: #f8fafc; }}
    header {{ padding: 28px 36px; background: #24384d; color: white; }}
    main {{ padding: 28px 36px; }}
    .summary {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }}
    .panel {{ background: white; border: 1px solid #dce5f1; border-radius: 8px; padding: 18px; }}
    .metric {{ font-size: 30px; font-weight: 700; margin-top: 8px; }}
    table {{ width: 100%; border-collapse: collapse; background: white; border: 1px solid #dce5f1; }}
    th, td {{ padding: 10px 12px; border-bottom: 1px solid #edf2f7; text-align: left; vertical-align: top; }}
    th {{ background: #eef6ff; font-size: 13px; position: sticky; top: 0; }}
    td {{ font-size: 13px; }}
    code {{ background: #edf2f7; padding: 2px 5px; border-radius: 4px; }}
    ul {{ margin: 8px 0 0; padding-left: 20px; }}
    .empty {{ background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 16px; border-radius: 8px; }}
  </style>
</head>
<body>
  <header>
    <h1>Pylint Static Analysis</h1>
    <p>{html.escape(project_name)} - {len(findings)} finding(s)</p>
  </header>
  <main>
    <section class="summary">
      <div class="panel"><div>Total findings</div><div class="metric">{len(findings)}</div></div>
      <div class="panel"><div>By type</div><ul>{type_items or "<li>No issues</li>"}</ul></div>
      <div class="panel"><div>Top rules</div><ul>{symbol_items or "<li>No issues</li>"}</ul></div>
      <div class="panel"><div>Most affected files</div><ul>{file_items or "<li>No issues</li>"}</ul></div>
    </section>
    {"<div class='empty'>Pylint did not report issues for the analyzed paths.</div>" if not findings else ""}
    <table>
      <thead>
        <tr>
          <th>Type</th><th>ID</th><th>Symbol</th><th>File</th><th>Line</th><th>Object</th><th>Message</th>
        </tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
  </main>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Pylint JSON output to a standalone HTML report.")
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_html", type=Path)
    parser.add_argument("--project-name", default="ATMOS backend")
    args = parser.parse_args()

    findings = json.loads(args.input_json.read_text(encoding="utf-8"))
    args.output_html.parent.mkdir(parents=True, exist_ok=True)
    args.output_html.write_text(build_report(findings, args.project_name), encoding="utf-8")


if __name__ == "__main__":
    main()
