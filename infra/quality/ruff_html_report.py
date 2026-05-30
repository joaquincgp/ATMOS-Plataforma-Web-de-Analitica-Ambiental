from __future__ import annotations

import argparse
import html
import json
from collections import Counter
from pathlib import Path
from typing import Any


def severity_for(code: str) -> str:
    if code.startswith("F"):
        return "Error"
    if code.startswith("B"):
        return "Bug risk"
    if code.startswith("I"):
        return "Import"
    if code.startswith("UP"):
        return "Modernization"
    if code.startswith("E"):
        return "Style"
    return "Issue"


def build_report(findings: list[dict[str, Any]], project_name: str) -> str:
    by_code = Counter(str(item.get("code", "UNKNOWN")) for item in findings)
    by_file = Counter(str(item.get("filename", "unknown")) for item in findings)
    rows = []

    for item in findings:
        location = item.get("location") or {}
        filename = str(item.get("filename", "unknown"))
        code = str(item.get("code", "UNKNOWN"))
        message = str(item.get("message", ""))
        row = location.get("row", "")
        column = location.get("column", "")
        rows.append(
            "<tr>"
            f"<td>{html.escape(severity_for(code))}</td>"
            f"<td><code>{html.escape(code)}</code></td>"
            f"<td>{html.escape(filename)}</td>"
            f"<td>{html.escape(str(row))}:{html.escape(str(column))}</td>"
            f"<td>{html.escape(message)}</td>"
            "</tr>"
        )

    top_codes = "".join(
        f"<li><code>{html.escape(code)}</code>: {count}</li>" for code, count in by_code.most_common(10)
    )
    top_files = "".join(
        f"<li>{html.escape(filename)}: {count}</li>" for filename, count in by_file.most_common(10)
    )
    status = "Passed" if not findings else f"{len(findings)} finding(s)"

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ruff Report - {html.escape(project_name)}</title>
  <style>
    body {{ margin: 0; font-family: Inter, Segoe UI, Arial, sans-serif; color: #1f2937; background: #f8fafc; }}
    header {{ padding: 28px 36px; background: #24384d; color: white; }}
    main {{ padding: 28px 36px; }}
    .summary {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-bottom: 24px; }}
    .panel {{ background: white; border: 1px solid #dce5f1; border-radius: 8px; padding: 18px; }}
    .metric {{ font-size: 30px; font-weight: 700; margin-top: 8px; }}
    table {{ width: 100%; border-collapse: collapse; background: white; border: 1px solid #dce5f1; }}
    th, td {{ padding: 10px 12px; border-bottom: 1px solid #edf2f7; text-align: left; vertical-align: top; }}
    th {{ background: #eef6ff; font-size: 13px; }}
    td {{ font-size: 13px; }}
    code {{ background: #edf2f7; padding: 2px 5px; border-radius: 4px; }}
    ul {{ margin: 8px 0 0; padding-left: 20px; }}
    .empty {{ background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 16px; border-radius: 8px; }}
  </style>
</head>
<body>
  <header>
    <h1>Ruff Static Analysis</h1>
    <p>{html.escape(project_name)} - {html.escape(status)}</p>
  </header>
  <main>
    <section class="summary">
      <div class="panel"><div>Total findings</div><div class="metric">{len(findings)}</div></div>
      <div class="panel"><div>Top rules</div><ul>{top_codes or "<li>No issues</li>"}</ul></div>
      <div class="panel"><div>Most affected files</div><ul>{top_files or "<li>No issues</li>"}</ul></div>
    </section>
    {"<div class='empty'>Ruff did not report issues for the analyzed paths.</div>" if not findings else ""}
    <table>
      <thead>
        <tr><th>Type</th><th>Rule</th><th>File</th><th>Line</th><th>Message</th></tr>
      </thead>
      <tbody>
        {''.join(rows)}
      </tbody>
    </table>
  </main>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Ruff JSON output to a standalone HTML report.")
    parser.add_argument("input_json", type=Path)
    parser.add_argument("output_html", type=Path)
    parser.add_argument("--project-name", default="ATMOS backend")
    args = parser.parse_args()

    findings = json.loads(args.input_json.read_text(encoding="utf-8"))
    args.output_html.parent.mkdir(parents=True, exist_ok=True)
    args.output_html.write_text(build_report(findings, args.project_name), encoding="utf-8")


if __name__ == "__main__":
    main()
