#!/usr/bin/env python3
"""
倒子麻将 · 语音包离线生成（CosyVoice3）

旧版用 Kokoro 合成，中文音色偏机械；现在改用 Apache-2.0 的
Fun-CosyVoice3-0.5B 做零样本音色克隆，并一次性合成整句组合
（例如「自摸清一色」），所以自摸后面不会再有拼接停顿。

输出：
  assets/resources/audio/voice/<id>_<tier>.mp3

依赖（独立 venv，不装进项目）：
  git clone --recursive https://github.com/FunAudioLLM/CosyVoice /tmp/CosyVoice
  uv venv -p 3.11 /tmp/cosyenv
  uv pip install --python /tmp/cosyenv/bin/python \
      torch==2.3.1 torchaudio==2.3.1 transformers==4.51.3 x-transformers==2.11.24 \
      HyperPyYAML==1.2.3 hydra-core omegaconf conformer==0.3.2 diffusers==0.29.0 \
      librosa==0.10.2 soundfile==0.12.1 pyworld==0.3.4 modelscope==1.20.0 \
      onnxruntime==1.18.0 numpy==1.26.4 pyarrow==18.1.0 inflect==7.3.1 \
      lightning==2.2.4 openai-whisper==20231117 gdown wget rich matplotlib
  # openai-whisper 需要 setuptools<81；如遇 pkg_resources 报错：
  uv pip install --python /tmp/cosyenv/bin/python "setuptools<81" \
      --no-build-isolation openai-whisper==20231117

模型：
  /tmp/models/cosy3  (FunAudioLLM/Fun-CosyVoice3-0.5B-2512)

用法：
  /tmp/cosyenv/bin/python scripts/voice/generate.py                 # 全量
  /tmp/cosyenv/bin/python scripts/voice/generate.py --only zimo,qingyise
  /tmp/cosyenv/bin/python scripts/voice/generate.py --demo          # 额外生成试听
  /tmp/cosyenv/bin/python scripts/voice/generate.py --force         # 覆盖已有文件
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
VOICE_DIR = Path(__file__).resolve().parent
MANIFEST = VOICE_DIR / "phrases.json"
COMBOS = VOICE_DIR / "combos.json"
PROMPT_WAV = VOICE_DIR / "prompt.wav"
OUT_DIR = ROOT / "assets" / "resources" / "audio" / "voice"
MODEL_DIR = Path(os.environ.get("COSY_MODEL", "/tmp/models/cosy3"))
COSY_REPO = Path(os.environ.get("COSY_REPO", "/tmp/CosyVoice"))
PROMPT_TEXT = (
    "You are a helpful assistant.<|endofprompt|>"
    "希望你以后能够做的比我还好呦。"
)

SAMPLE_RATE = 24000
BITRATE = "48k"


def trim_silence(samples: np.ndarray, threshold: float = 0.008, pad: float = 0.005) -> np.ndarray:
    if samples.size == 0:
        return samples
    loud = np.flatnonzero(np.abs(samples) > threshold)
    if loud.size == 0:
        return samples
    start = max(0, loud[0] - int(pad * SAMPLE_RATE))
    end = min(samples.size, loud[-1] + int(pad * SAMPLE_RATE))
    return samples[start:end]


def polish(samples: np.ndarray) -> np.ndarray:
    """去首尾静音、8ms 淡入、30ms 淡出、峰值归一。"""
    samples = trim_silence(samples.astype(np.float32))
    if samples.size == 0:
        return samples
    fade_in = min(int(0.008 * SAMPLE_RATE), samples.size // 4)
    fade_out = min(int(0.03 * SAMPLE_RATE), samples.size // 4)
    if fade_in:
        samples[:fade_in] *= np.linspace(0.0, 1.0, fade_in, dtype=np.float32)
    if fade_out:
        samples[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=np.float32)
    peak = float(np.max(np.abs(samples)))
    if peak > 0:
        samples *= 0.89 / peak
    return samples


def ffmpeg_filter(semitone: float) -> str:
    chain = ["highpass=f=60"]
    if semitone:
        ratio = math.pow(2.0, semitone / 12.0)
        chain += [
            f"asetrate={SAMPLE_RATE}*{ratio:.6f}",
            f"aresample={SAMPLE_RATE}",
            f"atempo={1.0 / ratio:.6f}",
        ]
    chain += [
        "acompressor=threshold=-18dB:ratio=2.5:attack=3:release=100:makeup=2",
        "loudnorm=I=-15:TP=-1.5:LRA=6",
        "alimiter=limit=0.95",
    ]
    return ",".join(chain)


def encode(src: Path, dst: Path, semitone: float) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-af",
            ffmpeg_filter(semitone),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-c:a",
            "libmp3lame",
            "-b:a",
            BITRATE,
            str(dst),
        ],
        check=True,
    )


def speed_for(group: str, tier: int) -> float:
    # 牌名短促一点，牌型/组合保持正常语速；高 tier 更快更有冲劲
    base = 1.15 if group == "tile" else 1.0
    return base * {1: 1.0, 2: 1.06, 3: 1.12}[tier]


def semitone_for(tier: int) -> float:
    return 0.0 if tier < 3 else 1.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="逗号分隔的 id，只重生成这些")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的文件")
    parser.add_argument("--demo", action="store_true", help="额外生成 docs/voice-demo.mp3")
    parser.add_argument("--atomic-only", action="store_true")
    parser.add_argument("--combos-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="只生成前 N 条，调试用")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print("找不到 ffmpeg", file=sys.stderr)
        return 1
    if not (MODEL_DIR / "llm.pt").exists():
        print(f"找不到模型 {MODEL_DIR}，先下载 Fun-CosyVoice3-0.5B-2512", file=sys.stderr)
        return 1
    if not PROMPT_WAV.exists():
        print(f"找不到音色样本 {PROMPT_WAV}", file=sys.stderr)
        return 1

    atomic = [] if args.combos_only else json.loads(MANIFEST.read_text(encoding="utf-8"))["phrases"]
    combos = [] if args.atomic_only else json.loads(COMBOS.read_text(encoding="utf-8"))
    only = {item.strip() for item in args.only.split(",") if item.strip()}
    if only:
        atomic = [p for p in atomic if p["id"] in only]
        combos = [c for c in combos if c["id"] in only]
        known = {p["id"] for p in json.loads(MANIFEST.read_text(encoding="utf-8"))["phrases"]}
        known |= {c["id"] for c in json.loads(COMBOS.read_text(encoding="utf-8"))}
        if only - known:
            print(f"未知 id: {', '.join(sorted(only - known))}", file=sys.stderr)
            return 1

    tasks = []
    for phrase in atomic:
        for tier in phrase.get("tiers", [1]):
            tasks.append(
                {
                    "id": phrase["id"],
                    "text": phrase["text"],
                    "group": phrase.get("group", "pattern"),
                    "tier": tier,
                    "label": phrase.get("label") or phrase["text"],
                    "speed": phrase.get("speed", speed_for(phrase.get("group", "pattern"), tier)),
                }
            )
    for combo in combos:
        for tier in (1, 2, 3):
            tasks.append(
                {
                    "id": combo["id"],
                    "text": combo["text"],
                    "group": "pattern",
                    "tier": tier,
                    "label": combo["text"],
                    "speed": speed_for("pattern", tier),
                }
            )
    if args.limit:
        tasks = tasks[: args.limit]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pending = [t for t in tasks if args.force or not (OUT_DIR / f"{t['id']}_{t['tier']}.mp3").exists()]
    print(f"CosyVoice3 音色克隆，共 {len(pending)} / {len(tasks)} 条待生成")

    if not pending:
        if args.demo:
            make_demo()
        return 0

    sys.path.insert(0, str(COSY_REPO))
    sys.path.insert(0, str(COSY_REPO / "third_party" / "Matcha-TTS"))
    import torchaudio
    from cosyvoice.cli.cosyvoice import AutoModel

    print("加载模型…", flush=True)
    model = AutoModel(model_dir=str(MODEL_DIR))
    print(f"模型就绪（{model.sample_rate}Hz）", flush=True)

    tmp = Path(tempfile.mkdtemp(prefix="daozi-cosy-"))
    try:
        for index, task in enumerate(pending, 1):
            text = task["text"]
            speed = task["speed"]
            chunks = []
            for _ in range(2):
                chunks = []
                for _, item in enumerate(
                    model.inference_zero_shot(
                        text,
                        PROMPT_TEXT,
                        str(PROMPT_WAV),
                        text_frontend=False,
                        speed=speed,
                    )
                ):
                    chunks.append(item["tts_speech"].detach().cpu().numpy().squeeze(0))
                if chunks and 0.12 < sum(len(c) for c in chunks) / SAMPLE_RATE < 8:
                    break
                # 极短文本偶尔会生成空音频/拖长，降速重试一次
                speed = 1.15 if speed < 1.05 else 1.0
            if not chunks:
                raise RuntimeError(f"{task['id']} 没有合成出音频")

            samples = polish(np.concatenate(chunks))
            wav = tmp / f"{task['id']}_{task['tier']}.wav"
            sf.write(wav, samples, SAMPLE_RATE, subtype="PCM_16")
            dst = OUT_DIR / f"{task['id']}_{task['tier']}.mp3"
            encode(wav, dst, semitone_for(task["tier"]))
            wav.unlink(missing_ok=True)
            print(
                f"[{index:>3}/{len(pending)}] {task['id']:<28} t{task['tier']} "
                f"{len(samples) / SAMPLE_RATE:.2f}s  {task['label']}",
                flush=True,
            )
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if args.demo:
        make_demo()

    total = sum(path.stat().st_size for path in OUT_DIR.glob("*.mp3"))
    print(f"完成：{len(list(OUT_DIR.glob('*.mp3')))} 个 mp3，共 {total / 1024:.0f} KB")
    return 0


DEMO_SEQUENCE = [
    ("wan1", 1, True),
    ("tong5", 1, True),
    ("tiao1", 1, True),
    ("red", 1, True),
    ("peng", 1, True),
    ("gang", 1, True),
    ("angang", 2, True),
    ("zimo", 1, True),
    ("c_zimo_qingyise", 3, True),
    ("c_zimo_kuzhiya", 3, True),
    ("c_zimo_duiduihu_dana", 3, True),
    ("c_ganghousaihua_qingyise", 3, True),
    ("sandayi", 1, True),
    ("c_qianggang_duiduihu", 2, True),
    ("c_hu_qingyise", 2, True),
]


def make_demo() -> None:
    demo = ROOT / "docs" / "voice-demo.mp3"
    demo.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="daozi-demo-"))
    try:
        silence = tmp / "silence.wav"
        sf.write(silence, np.zeros(int(0.16 * SAMPLE_RATE), dtype=np.float32), SAMPLE_RATE)
        gap = tmp / "gap.wav"
        sf.write(gap, np.zeros(int(0.55 * SAMPLE_RATE), dtype=np.float32), SAMPLE_RATE)
        files = []
        for index, (clip, tier, label) in enumerate(DEMO_SEQUENCE):
            src = OUT_DIR / f"{clip}_{tier}.mp3"
            if not src.exists():
                print(f"跳过试听：缺少 {src.name}", file=sys.stderr)
                continue
            wav = tmp / f"{index:02d}_{clip}_{tier}.wav"
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(src),
                    "-ac",
                    "1",
                    "-ar",
                    str(SAMPLE_RATE),
                    "-c:a",
                    "pcm_s16le",
                    str(wav),
                ],
                check=True,
            )
            files.append(wav)
            files.append(silence)
            if label:
                files.append(gap)
        list_file = tmp / "list.txt"
        list_file.write_text("".join(f"file '{path}'\n" for path in files), encoding="utf-8")
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c:a",
                "libmp3lame",
                "-b:a",
                "64k",
                str(demo),
            ],
            check=True,
        )
        print(f"试听：{demo.relative_to(ROOT)}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
