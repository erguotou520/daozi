# 语音播报 · 语音包说明

> 运行时代码：`src/audio/announce.ts`（组合规则）、`src/audio/combos.ts`（整句组合表）、`src/audio/voice.ts`（播放队列）
> 音频目录：`assets/resources/audio/voice/`
> 生成脚本：`scripts/voice/generate.py` + `scripts/voice/phrases.json` + `scripts/voice/combos.json`

## 1. 为什么不用现成语音包

| 来源 | 内容 | 能不能直接用 |
| --- | --- | --- |
| [lzy271713290/CMCCmahjong](https://github.com/lzy271713290/CMCCmahjong) | 34 张牌名 + 碰 / 杠 / 胡，`nv/*.mp3` 很全 | 仓库没有 LICENSE，音频来源不明，不能随项目分发 |
| [Satle9999/my-mahjong-voice](https://github.com/Satle9999/my-mahjong-voice) | 一整套日语播报（ロン / ツモ / ポン / カン / リーチ） | 日语，且没有许可证 |
| [Freesound](https://freesound.org/search/?q=mahjong) / [OpenGameArt](https://opengameart.org/) | 麻将馆环境音、洗牌、牌碰撞 | 没有人声报牌 |
| 商业麻将 App / 雀魂 | 中文播报很全 | 版权音频，不能拆包使用 |

「枯只压」「杠后赛花」「三打一」「大拿」是倒子麻将的地方术语，现成包本来就不会有。
早期用 Kokoro-82M 合成过一版，中文音色偏机械；现在整体换成 **Apache-2.0 的
[Fun-CosyVoice3-0.5B](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)** 做零样本音色克隆，
用一段中文女声样本（`scripts/voice/prompt.wav`，取自 CosyVoice 仓库）生成全部播报。

## 2. 覆盖范围

### 牌名（34）

- 万：`wan1`–`wan9`（一万…九万）
- 筒：`tong1`–`tong9`（一筒…九筒）
- 条：`tiao1`–`tiao9`（**幺鸡**、二条…九条）
- 字牌：`east` 东风、`south` 南风、`west` 西风、`north` 北风、`red` 红中、`green` 发财、`white` 白板

### 动作（8）

`peng` **对**（碰）、`gang` 杠、`angang` 暗杠、`zimo` 自摸、`hu` 胡、`qianggang` 抢杠胡、`ting` 听牌、`liuju` 流局。

### 牌型（20）

`dana` 大拿、`kuzhiya` 枯只压、`qingyise` 清一色、`duiduihu` 对对胡、`ganghousaihua` 杠后赛花、
`qidui` 七对、`dadiaoche` 大吊车、`laoxiaodui` 老小对、
`bangbang` 棒棒、`sihuo` 四活、`caoyise` 草一色、`yijiu` 一一九、
`shuangtong` 双通、`shuangsihuo` 双四活、`sangang` 三杠、`sandakan` 三大坎、`qingshui` 清水、
`yadang` 压当、`dandiao` 单吊、`gangkai` 杠开。

「乱分」在结算里已经同时标记为清一色，所以播报只喊一次 **清一色**。
「连号」「不动手」这类小牌型不播，避免每把都念一串小字。
`三打一` 只在触发亮牌时播一次，成牌时不重复。

### 整句组合（18）

`自摸清一色`、`自摸对对胡`、`自摸枯只压`、`自摸七对`、`自摸大吊车`、
`自摸清一色大拿`、`自摸对对胡大拿`、`自摸枯只压大拿`、`自摸七对大拿`、`自摸大吊车大拿`、
`自摸清一色对对胡`、`自摸清一色对对胡大拿`、
`杠后赛花清一色`、`杠后赛花对对胡`、`杠后赛花清一色大拿`、`抢杠胡对对胡`、
`胡清一色`、`胡对对胡`。

这 18 条是**整句一次合成**，自摸和后面的牌型之间没有任何拼接缝，听起来就是一句话。
完整清单在 `scripts/voice/combos.json`，运行时由 `combos.ts` 按 clip 序列精确匹配。

## 3. 三档情绪

| 档 | 语速 | 后期 | 用在哪 |
| --- | --- | --- | --- |
| 1 平播 | 1.00× | 压缩 + 统一响度 | 打牌、对、平胡、抢杠、听牌、流局 |
| 2 提气 | 1.06× | 压缩 + 提亮 | 杠、暗杠、普通自摸、带牌型的成牌、整句组合 |
| 3 爆发 | 1.12× | +1 半音 + 压缩 + 限幅 | 大拿、50 点以上、清一色 / 七对 / 大吊车 |

牌名单独用 1.15×，避免「幺鸡」这类短词拖长。

档位选择在 `voiceTierFor()`：大拿或点数 ≥ 50 → 3 档；自摸、点数 ≥ 20、
有清一色 / 七对 / 大吊车，或除底点外还有牌型 → 2 档；其余 1 档。

## 4. 组合与停顿

`buildWinAnnouncement()` 的输出顺序：

```
自摸 / 杠后赛花 / 抢杠胡 / 胡
  → 牌型（按分量降序，最多 3 个）
  → 大拿（压轴）
```

- **自摸永远第一个喊**。
- **自摸 × 杠后赛花**：杠后赛花本身就是杠后补摸成牌，只喊「杠后赛花」，不再喊「自摸」。
- **大拿压轴**，最后一段用 3 档。
- **抢杠**喊「抢杠胡」，不会因为状态里还带着 `afterKong` 误喊杠后赛花。
- 一条播报最多 5 段。
- **18 个常见组合走整句音频**，中间没有任何 gap。
- 不在整句表里的组合逐段播放，`gapMs` 全部为 0；`voice.ts` 用 `SoundManager` 串行播放。
- 音频首尾只保留 5ms 静音、8ms 淡入 / 30ms 淡出，进一步避免拼接缝。

牌型权重：清一色 > 七对 > 大吊车 > 对对胡 > 枯只压 > 一一九/双通/双四活/三杠/三大坎 >
清水 > 草一色 > 四活 > 棒棒 > 压当/单吊。

例：

| 成牌 | 播报 |
| --- | --- |
| 平胡 | 胡 |
| 自摸 | 自摸 |
| 自摸 + 清一色 | 自摸清一色（整句） |
| 自摸 + 枯只压 | 自摸枯只压（整句） |
| 自摸 + 对对胡 + 大拿 | 自摸对对胡大拿（整句） |
| 杠后补摸 + 清一色 | 杠后赛花清一色（整句，不喊自摸） |
| 抢杠 + 对对胡 | 抢杠胡对对胡（整句） |
| 接牌 + 单吊 | 胡 → 单吊（gap 0） |

## 5. 文件与播放

- 命名：`<id>_<tier>.mp3`，24kHz 单声道 48kbps。
- 牌名只有 1 档；杠 / 暗杠 2 档；自摸 / 胡 / 抢杠 / 大拿 / 牌型 3 档；整句组合同样 3 档。
- 共 **179 段，1.1MB**（不含试听串烧）。
- 启动后延迟 800ms 预加载牌名和常用动作，1.2s 后再预加载牌型 / 整句；也可以按需现取。
- 播放用 `Laya.SoundManager`，按 clip 串行；新播报会打断旧播报；每段 3 秒超时兜底。
- 右上角「音 / 静」开关，状态存在 `daozi.voice.v1`；静音会立刻停掉当前播报。

## 6. 重新生成

```bash
# 1. 拉 CosyVoice3 和依赖（独立 venv，不装进项目）
git clone --recursive https://github.com/FunAudioLLM/CosyVoice /tmp/CosyVoice
uv venv -p 3.11 /tmp/cosyenv
uv pip install --python /tmp/cosyenv/bin/python \
  torch==2.3.1 torchaudio==2.3.1 transformers==4.51.3 x-transformers==2.11.24 \
  HyperPyYAML==1.2.3 hydra-core omegaconf conformer==0.3.2 diffusers==0.29.0 \
  librosa==0.10.2 soundfile==0.12.1 pyworld==0.3.4 modelscope==1.20.0 \
  onnxruntime==1.18.0 numpy==1.26.4 pyarrow==18.1.0 inflect==7.3.1 \
  lightning==2.2.4 gdown wget rich matplotlib
uv pip install --python /tmp/cosyenv/bin/python "setuptools<81"
uv pip install --python /tmp/cosyenv/bin/python --no-build-isolation openai-whisper==20231117

# 2. 下载模型（约 9GB，含推理不需要的 ONNX 文件，可删）
/tmp/cosyenv/bin/python - <<'PY'
from modelscope import snapshot_download
snapshot_download('FunAudioLLM/Fun-CosyVoice3-0.5B-2512', local_dir='/tmp/models/cosy3')
PY

# 3. 生成（默认会跳过已存在的文件）
/tmp/cosyenv/bin/python scripts/voice/generate.py --demo
/tmp/cosyenv/bin/python scripts/voice/generate.py --only zimo,c_zimo_qingyise --force
```

生成脚本做：CosyVoice3 零样本克隆 → 去首尾静音 → 淡入淡出 → 峰值归一 →
按档位变调变速（3 档 +1 半音）→ 压缩 → -15 LUFS → 限幅 → 48kbps mp3。

试听串烧在 `docs/voice-demo.mp3`，包含：单张报牌、对、杠、暗杠、普通自摸、
自摸清一色、自摸枯只压、自摸对对胡大拿、杠后赛花清一色、三打一、抢杠胡对对胡、胡清一色。

## 7. 许可

- 合成模型：[Fun-CosyVoice3-0.5B-2512](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)，Apache-2.0。
- 音色样本：`scripts/voice/prompt.wav`，来自 CosyVoice 仓库的 `asset/zero_shot_prompt.wav`（Apache-2.0）。
- 生成脚本：本仓库 GPL-3.0-or-later。
- 合成音频随本仓库分发；如果换成真人录音，请自行确认录音师授权。

## 8. 已知限制

- 克隆声线是年轻女声，不是真人解说；如果要更「麻将机」的男声，可以换 `prompt.wav` 重新生成。
- 「枯只压」的 TTS 文本写作「枯枝压」以保证读成 `kū zhī yā`，文件名和界面仍用「枯只压」。
- 整句表只覆盖最常见的 18 种组合；更冷门的组合会逐段播放，虽然 gap 为 0，仍不如整句自然。
- 单机 CPU 合成 RTF 约 4–5，全量 179 段约 25–30 分钟；换 MPS / GPU 会快很多。
