#!/bin/bash
# Builds the Lambda deployment folder (.lambda-build) without Docker:
# pip downloads prebuilt Linux ARM64 wheels for Python 3.12, then the app code is copied in.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=.lambda-build
rm -rf "$OUT" && mkdir -p "$OUT"

uv pip install --quiet --target "$OUT" \
  --python-platform aarch64-manylinux2014 --python-version 3.12 --only-binary=:all: \
  -r requirements.txt

# boto3 ships with the Lambda runtime; drop the bundled copy and other dead weight
rm -rf "$OUT"/boto3* "$OUT"/botocore* "$OUT"/s3transfer* "$OUT"/uvloop* "$OUT"/bin/__pycache__
find "$OUT" -type d \( -name "__pycache__" -o -name "tests" -o -name "test" \) -prune -exec rm -rf {} +

rsync -a --exclude ".venv" --exclude "venv" --exclude ".lambda-build" --exclude "__pycache__" --exclude "temp_charts" \
  --exclude "cliniq.db" --exclude ".env" --exclude "scripts" --exclude "Procfile" \
  ./ "$OUT"/

echo "Lambda bundle: $(du -sh "$OUT" | cut -f1) (limit 250 MB unzipped)"
