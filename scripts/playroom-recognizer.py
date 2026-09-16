#!/usr/bin/env python3
"""Local VAD + utterance ASR: stdin PCM only; ephemeral results, no recordings.

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
model = root / "data/playroom/sherpa-onnx-whisper-small.en"
recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
    tokens=str(model / "small.en-tokens.txt"),
    encoder=str(model / "small.en-encoder.int8.onnx"),
    decoder=str(model / "small.en-decoder.int8.onnx"),
    num_threads=2, provider="cpu", language="en", task="transcribe",
)
config = sherpa_onnx.VadModelConfig()
config.silero_vad.model = str(root / "data/playroom/silero_vad.onnx")
config.silero_vad.min_speech_duration = 0.1
config.silero_vad.min_silence_duration = 0.6
config.silero_vad.max_speech_duration = 8
config.sample_rate = 16000
vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=12)
pending = np.empty(0, dtype=np.float32)
recent = np.empty(0, dtype=np.float32)
total_samples = 0
generation = frames = 0
print(json.dumps({"type": "ready"}), flush=True)
while True:
    command = sys.stdin.buffer.read(1)
    if not command:
        break
    if command == b"\x00":
        generation = struct.unpack(">I", sys.stdin.buffer.read(4))[0]
        vad.reset()
        pending = np.empty(0, dtype=np.float32)
        recent = np.empty(0, dtype=np.float32)
        total_samples = 0
        continue
    if command != b"\x01":
        raise ValueError("Invalid command")
    pcm = sys.stdin.buffer.read(640)
    if len(pcm) != 640:
        break
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    total_samples += len(samples)
    recent = np.concatenate((recent, samples))[-192000:]
    pending = np.concatenate((pending, samples))
    while len(pending) >= 512:
        vad.accept_waveform(pending[:512])
        pending = pending[512:]
    while not vad.empty():
        # Retain no recordings or conversation context; each bounded utterance
        # gets a fresh decoder. Never decode silence as a potential game answer.
        segment = vad.front
        # Preserve quiet consonants and articles before the VAD threshold.
        # Detector boundaries are not precise phonetic boundaries. Keep only a
        # bounded in-memory ring and 250 ms of context around each utterance.
        ring_start = total_samples - len(recent)
        start = max(ring_start, segment.start - 4000)
        end = min(total_samples, segment.start + len(segment.samples) + 4000)
        samples = recent[start-ring_start:end-ring_start].copy()
        vad.pop()
        if len(samples) < 1600 or len(samples) > 160000:
            continue
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        text = stream.result.text.strip()
        if text:
            print(json.dumps({"type": "answer", "generation": generation, "text": text[:1000]}), flush=True)
    frames += 1
    if frames % 50 == 0:
        print(json.dumps({"type": "progress"}), flush=True)
