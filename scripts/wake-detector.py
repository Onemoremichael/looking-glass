#!/usr/bin/env python3
"""Local PCM keyword detector. No microphone API, network, recording or transcripts.

stdin: byte 0 resets stream; byte 1 followed by 640 PCM16LE bytes (16k mono).
byte 2 + mask byte + uint32LE generation sets temporary navigation keywords.
stdout: JSONL ready / wake / shortcut / progress. No recognized transcripts.
"""
import json
import argparse
import sys
from pathlib import Path
import numpy as np
import sherpa_onnx

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--model", choices=["english", "bilingual"], default="english")
args = parser.parse_args()
english = args.model == "english"
model = root / ("data/wake/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01" if english else "data/wake/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20")
suffix = "epoch-12-avg-2-chunk-16-left-64" if english else "epoch-13-avg-2-chunk-8-left-64"
spotter = sherpa_onnx.KeywordSpotter(
    tokens=str(model / "tokens.txt"),
    encoder=str(model / ("encoder-" + suffix + ".int8.onnx")),
    decoder=str(model / ("decoder-" + suffix + ".onnx")),
    joiner=str(model / ("joiner-" + suffix + ".int8.onnx")),
    keywords_file=str(root / ("scripts/wake-keywords-english.txt" if english else "scripts/wake-keywords.txt")),
    num_threads=1, provider="cpu", num_trailing_blanks=1 if english else 2,
)

mask = generation = 0

def emit(kind, **fields):
    print(json.dumps({"type": kind, **fields}), flush=True)

def fresh_stream():
    keywords = []
    if english and mask & 1:
        keywords.append("▁NEXT ▁P AGE :1.5 #0.25 @NEXT_PAGE")
    if english and mask & 2:
        keywords.append("▁PRE V IOUS ▁P AGE :1.5 #0.25 @PREVIOUS_PAGE")
    # sherpa appends the base wake phrase to these per-stream extra keywords.
    result = spotter.create_stream("/".join(keywords)) if keywords else spotter.create_stream()
    # Provide left context even for a phrase spoken immediately after arming.
    result.accept_waveform(16000, np.zeros(16000, dtype=np.float32))
    while spotter.is_ready(result):
        spotter.decode_stream(result)
    return result

stream = fresh_stream()
frames = quiet = age = 0
emit("ready")
while True:
    command = sys.stdin.buffer.read(1)
    if not command:
        break
    if command == b"\x02":
        profile = sys.stdin.buffer.read(5)
        if len(profile) != 5 or profile[0] > 3:
            raise ValueError("Invalid shortcut profile")
        mask, generation = profile[0], int.from_bytes(profile[1:], "little")
        stream = fresh_stream()
        quiet = age = 0
        continue
    if command == b"\x00":
        stream = fresh_stream()
        quiet = age = 0
        continue
    if command != b"\x01":
        raise ValueError("Invalid frame type")
    pcm = sys.stdin.buffer.read(640)
    if len(pcm) != 640:
        break
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    quiet = quiet + 1 if np.max(np.abs(samples)) < .008 else 0
    age += 1
    # Local detector input only: up to +12 dB for far-field/quiet speech. Limit
    # against the frame peak instead of clipping. This cannot improve SNR and
    # also boosts room noise; cloud conversation/speaker levels are untouched.
    peak = float(np.max(np.abs(samples)))
    gain = min(4.0, .95 / peak) if peak > 0 else 1.0
    stream.accept_waveform(16000, samples * gain)
    while spotter.is_ready(stream):
        spotter.decode_stream(stream)
        keyword = spotter.get_result(stream)
        if keyword:
            if keyword == "NEXT_PAGE" and mask & 1:
                emit("shortcut", command="next_page", generation=generation)
            elif keyword == "PREVIOUS_PAGE" and mask & 2:
                emit("shortcut", command="previous_page", generation=generation)
            elif keyword == "HEY_MIRROR":
                emit("wake")
            stream = fresh_stream()
            age = quiet = 0
            break
    # Bound feature history without resetting in the middle of a phrase.
    if (age > 1500 and quiet > 50) or age > 3000:
        stream = fresh_stream()
        age = quiet = 0
    frames += 1
    if frames % 50 == 0:
        emit("progress")
