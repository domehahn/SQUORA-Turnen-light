#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def tf_output(name: str) -> str:
    return subprocess.check_output(
        ["terraform", "output", "-raw", name],
        cwd=ROOT,
        text=True,
    ).strip()

template = (ROOT / "wrangler.jsonc.tmpl").read_text()

replacements = {
    "__WORKER_NAME__": tf_output("worker_name"),
    "__D1_DATABASE_NAME__": tf_output("d1_database_name"),
    "__D1_DATABASE_ID__": tf_output("d1_database_id"),
    "__EXPORT_BUCKET_NAME__": tf_output("export_bucket_name"),
    "__ENVIRONMENT__": "prod",
}

for old, new in replacements.items():
    template = template.replace(old, new)

out = ROOT / "wrangler.jsonc"
out.write_text(template)
print(f"Wrote {out}")
