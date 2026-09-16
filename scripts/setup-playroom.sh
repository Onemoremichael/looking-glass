#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Reuse the pinned local sherpa runtime installed by npm run wake:setup.
test -x data/wake/venv/bin/python
mkdir -p data/playroom
archive=data/playroom/english-asr.tar.bz2
curl -fL --max-time 120 -o "$archive" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
test "$actual" = 9c559283e8498d3fe95913c79ca1cb454bb26281ac2b102b41306c7d752765d9
tar -xjf "$archive" -C data/playroom
data/wake/venv/bin/python scripts/playroom-recognizer.py < /dev/null
