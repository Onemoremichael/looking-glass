#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Python 3.11+; dependencies and models stay in ignored, project-local data/.
mkdir -p data/wake
python3 -m venv data/wake/venv
data/wake/venv/bin/pip install --only-binary=:all: -r scripts/wake-requirements.txt
archive=data/wake/english-model.tar.bz2
curl -fL --max-time 120 -o "$archive" https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
test "$actual" = f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a
tar -xjf "$archive" -C data/wake
data/wake/venv/bin/python scripts/wake-detector.py < /dev/null
