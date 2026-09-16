#!/usr/bin/env python3
"""Local streaming ASR: stdin PCM only; ephemeral JSONL results, no recordings.

Protocol: 0 + uint32 generation resets; 1 + 640 PCM16LE bytes feeds 20 ms.
The Node owner consumes results in memory and never logs the text.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np
import sherpa_onnx

root = Path(__file__).resolve().parent.parent
model = root / "data/playroom/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17"
recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=str(model / "tokens.txt"),
    encoder=str(model / "encoder-epoch-99-avg-1.int8.onnx"),
    decoder=str(model / "decoder-epoch-99-avg-1.onnx"),
    joiner=str(model / "joiner-epoch-99-avg-1.int8.onnx"),
    num_threads=2, provider="cpu", enable_endpoint_detection=True,
    rule1_min_trailing_silence=2.0, rule2_min_trailing_silence=0.7,
    rule3_min_utterance_length=10,
)
stream = recognizer.create_stream()
generation = frames = 0
print(json.dumps({"type": "ready"}), flush=True)
while True:
    command = sys.stdin.buffer.read(1)
    if not command:
        break
    if command == b"\x00":
        generation = struct.unpack(">I", sys.stdin.buffer.read(4))[0]
        stream = recognizer.create_stream()
        continue
    if command != b"\x01":
        raise ValueError("Invalid command")
    pcm = sys.stdin.buffer.read(640)
    if len(pcm) != 640:
        break
    stream.accept_waveform(16000, np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0)
    while recognizer.is_ready(stream):
        recognizer.decode_stream(stream)
    if recognizer.is_endpoint(stream):
        text = recognizer.get_result(stream).strip()
        if text:
            print(json.dumps({"type": "answer", "generation": generation, "text": text[:1000]}), flush=True)
        stream = recognizer.create_stream()
    frames += 1
    if frames % 50 == 0:
        print(json.dumps({"type": "progress"}), flush=True)
