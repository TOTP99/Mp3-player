# 万锦留声机 · 项目说明

竖屏独立页面：留声机造型的背景音乐播放器 + 迷你三格老虎机。纯前端，无构建工具、无外部依赖。

**与横屏老虎机（Wanjin Slot Machine / Phaser 版）是两个完全独立的项目**，各自独立部署、独立运行，只通过 `localStorage` 的 `wanjin_slot_save` 这一份存档共用余额/下注/累积奖池。

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.html` | 页面结构：顶部时钟+MP3铜号角、中间唱片机（黑胶+唱针+频谱）、迷你三格老虎机、底部播放/模式按钮 |
| `game.js` | 主逻辑：符号表+概率表、`BGMusic`、`setupPhonograph()`（黑胶/频谱/迷你机） |
| `audio-enhance.js` | 听感增强（独立模块）：高通/低通滤波、压缩器、AGC 自动音量均衡 |
| `style.css` | 黑金配色，`.ph-*` 前缀 |

脚本加载顺序（必须先增强再主逻辑）：`audio-enhance.js` → `game.js`。

`game.js` 内部按声明顺序分三段：第1段 `SYMBOLS`/概率表/`rollSpinResult`/`evaluateSpinResult`；第2段 `class BGMusic`（背景音乐+频谱分析）；第3段 `setupPhonograph()`（黑胶转速、频谱画布、迷你老虎机 SPIN）。

## 核心概念

- **黑胶转速由音乐能量驱动**（`tickVinyl()`）：目标转速约 `3.2 + energy * 1.6`（`energy` 来自 `bgMusic.sampleSpectrum()`），一阶低通平滑过渡。盘心不显示曲号，仅保留偏心金点作方位标记；曲号显示在上方"现在播放"处。
- **频谱是合成波形**（`drawSpectrum()`）：用 `bass`/`body`/`energy`/`transient` 调制三角波曲线并按渐变色上色，不是直接画 FFT 柱状图。
- **听感增强链路**（`audio-enhance.js`）：`mp3 → 频谱analyser(直连) → 高通(~70Hz) → 低通(~13kHz) → 压缩器 → AGC → 主增益 → 扬声器`。切歌时 `resetAgc()` 避免沿用上一首增益。调参入口在顶部 `DEFAULTS`（`targetRms`/`highpassHz`/`agcMin`/`agcMax` 等）。
- **浏览器限制**：刷新后需用户先点一次播放，Web Audio 才会真正启动。
- **迷你老虎机存档为 merge 写入**（`readSave()`/`writeSave()`）：只更新 `balance`/`bet`/`jackpotValue`，保留横屏版可能写入的其它字段。
- **播放模式仅"顺序/随机"**：顺序播完最后一首回到第1首并暂停；随机下一首尽量不与当前相同；控制按钮用内联 SVG 图标（循环箭头=顺序、交叉箭头=随机）。
- **动画帧只在页面可见时跑**：`document.hidden` 时 `cancelAnimationFrame`，切回前台恢复。
- **首次用户手势解锁音频**（`unlockAudioOnce()`）：iOS/部分 Android 要求在触摸/点击/按键中才能启动音频。

## 常见修改速查

- **改音乐曲目**：往 `BG_MUSIC_BASE` 目录放 `1.mp3`、`2.mp3`…，数量上限改 `BG_MUSIC_MAX`（与横屏版是两份独立变量）
- **改音质/响度**：改 `audio-enhance.js` 的 `DEFAULTS`
- **改赔率/中奖概率**：改 `game.js` 顶部 `THREE_OF_KIND_WEIGHTS`/`JACKPOT_WEIGHT`/`PAIR_WEIGHT`/`SYMBOLS`（与横屏版分开维护）
- **改配色**：`style.css` 里的 `--gold` 等变量
- **改黑胶转速**：`tickVinyl()` 里的 `3.2 + energy * 1.6` 与平滑系数
- **改频谱视觉**：`drawSpectrum()` 里的 `SPEC_GRADIENT_RGB`、`amp`/`swell`/`punch`
- **改控制按钮图标**：`index.html` 里对应 `<svg>` 的 `<path>`/`<polyline>` 内容

## 调试建议

- 控制台可看 `bgMusic.currentNum` / `bgMusic.playMode` / `bgMusic.bands` / `bgMusic._enhancer`
- 黑胶不转但音乐在播：查 `bgMusic.isPlaying()` 与 `bgMusic.energy`
- 增强不生效：确认已引入 `audio-enhance.js` 且在用户点击播放之后，看 `bgMusic._enhancer` 是否存在
- 余额与横屏不一致：对比 `localStorage.wanjin_slot_save`，本页已 merge 写入，一般不会冲掉横屏其它字段

## 2026-09-27 商业标准整理
- 去装饰 emoji：标题 `🎵`、"♫ 现在播放"（换 SVG 音符）、余额 `💰`（换 SVG 金币）、中奖提示 `💎`（纯文字）；转盘符号（7️⃣🌸🍒等）保留——与横屏老虎机共用符号表，属游戏内容。
- 文案更直白：余额不足时显示"余额不足"（原只显示"—"）；下注显示"注$50"（原"—$50"）。
- 删死代码：`drawSpectrum` 里无配对 save 的 `ctx.restore()`；`unlockAudioOnce` 里多余的一次性 AudioContext（`tryPlay()` 内已创建）。
- iPhone 14 呼吸：竖屏页面左右留白 10px → 12px；横屏三栏布局与 JS 自适应尺寸保留。
