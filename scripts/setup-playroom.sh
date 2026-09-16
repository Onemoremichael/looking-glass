#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Reuse the pinned local sherpa runtime installed by npm run wake:setup.
test -x data/wake/venv/bin/python
mkdir -p data/playroom
archive=data/playroom/whisper-small.en.tar.bz2
curl -fL --max-time 180 -o "$archive" https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
test "$actual" = 0cdba2b8aaab69e04847f3427cc9709574112e67913a1a84b7fec3a8729faa9a
tar -xjf "$archive" -C data/playroom
curl -fL --max-time 30 -o data/playroom/silero_vad.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
actual=$(shasum -a 256 data/playroom/silero_vad.onnx | cut -d ' ' -f 1)
test "$actual" = 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6
data/wake/venv/bin/python scripts/playroom-recognizer.py < /dev/null
