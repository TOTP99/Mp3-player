/**
 * 万锦留声机 - 竖屏独立版（index.html + style.css + game.js）
 * 与横屏老虎机是两个完全独立的游戏，仅通过 localStorage 的
 * "wanjin_slot_save" 存档共用同一份余额 / 下注 / 累积奖池。
 */

// ---------- 符号表（与横屏老虎机保持一致，赔率/图案不独立维护一份）----------
const SYMBOLS = [
  { key: "seven", label: "7️⃣", color: "#ff2d2d", multiplier: 50 },
  { key: "blossom", label: "🌸", color: "#ff8fab", multiplier: 20 },
  { key: "hibiscus", label: "🌺", color: "#ff4d6d", multiplier: 15 },
  { key: "grape", label: "🍇", color: "#9b5de5", multiplier: 10 },
  { key: "strawberry", label: "🍓", color: "#ff2d55", multiplier: 8 },
  { key: "cherry", label: "🍒", color: "#e63946", multiplier: 6 },
  { key: "mushroom", label: "🍄", color: "#c77dff", multiplier: 4 },
];

// ---------- 中奖概率表（结果导向，与横屏老虎机口径一致）----------
// 先按目标概率决定这一把的结果类型，再倒推三个轮子该显示什么符号，
// 保证综合期望回报率(RTP)可控，不受符号分布组合数学效应影响。
const SPIN_TABLE_TOTAL = 1000000;
const THREE_OF_KIND_WEIGHTS = {
  blossom: 700,
  hibiscus: 1000,
  grape: 1700,
  strawberry: 2300,
  cherry: 3200,
  mushroom: 4500,
};
const JACKPOT_WEIGHT = 320; // 约 1/3125 把出一次三连 7️⃣
const PAIR_WEIGHT = 270000; // 27% 出对子

function buildSpinOutcomeTable() {
  const table = [{ type: "pair", weight: PAIR_WEIGHT }];
  Object.keys(THREE_OF_KIND_WEIGHTS).forEach((key) => {
    table.push({ type: "three", key, weight: THREE_OF_KIND_WEIGHTS[key] });
  });
  table.push({ type: "jackpot", key: "seven", weight: JACKPOT_WEIGHT });
  const used = table.reduce((sum, item) => sum + item.weight, 0);
  table.push({ type: "none", weight: Math.max(0, SPIN_TABLE_TOTAL - used) });
  return table;
}
const SPIN_OUTCOME_TABLE = buildSpinOutcomeTable();

function pickWeighted(table) {
  const total = table.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < table.length; i++) {
    roll -= table[i].weight;
    if (roll <= 0) return table[i];
  }
  return table[table.length - 1];
}

function symbolByKey(key) {
  return SYMBOLS.find((s) => s.key === key) || SYMBOLS[0];
}

function pickRandom(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// 根据本节点抽中的结果类型，倒推三个轮子应显示的符号（数组顺序=轮子顺序）
function rollSpinResult() {
  const outcome = pickWeighted(SPIN_OUTCOME_TABLE);

  if (outcome.type === "jackpot" || outcome.type === "three") {
    const s = symbolByKey(outcome.key);
    return [s, s, s];
  }

  if (outcome.type === "pair") {
    const pairSymbol = pickRandom(SYMBOLS);
    let oddSymbol = pickRandom(SYMBOLS);
    while (oddSymbol.key === pairSymbol.key) {
      oddSymbol = pickRandom(SYMBOLS);
    }
    const arrangements = [
      [pairSymbol, pairSymbol, oddSymbol],
      [pairSymbol, oddSymbol, pairSymbol],
      [oddSymbol, pairSymbol, pairSymbol],
    ];
    return pickRandom(arrangements);
  }

  // none：三个互不相同的符号
  const shuffled = shuffleArray(SYMBOLS);
  return [shuffled[0], shuffled[1], shuffled[2]];
}

// 判定三个轮子结果的中奖类型与金额：与横屏老虎机共用同一套判定逻辑
function evaluateSpinResult(a, b, c, bet, jackpotValue) {
  const isThreeOfAKind = a.key === b.key && b.key === c.key;
  const isJackpot = isThreeOfAKind && a.key === "seven";
  const isPair =
    !isThreeOfAKind && (a.key === b.key || a.key === c.key || b.key === c.key);

  if (isJackpot) {
    return { type: "jackpot", win: jackpotValue, symbol: a };
  }
  if (isThreeOfAKind) {
    return { type: "three", win: bet * a.multiplier, symbol: a };
  }
  if (isPair) {
    const pairSymbol = a.key === b.key || a.key === c.key ? a : b;
    return { type: "pair", win: bet * 2, symbol: pairSymbol };
  }
  return { type: "none", win: 0, symbol: null };
}

// ---------- 背景音乐歌单清单 ----------
// mp3 文件实际托管在另一个仓库（source/mp3 目录），本页面跨库引用，不在本地存放音频。
// 加歌方式：把 mp3 文件改名为 1.mp3、2.mp3 …按你想要的播放顺序编号，
// 放进 source 仓库的 mp3 目录即可，以后无需再改这里的代码
// （如果文件总数变了，记得同步改下面的 BG_MUSIC_MAX）。
const BG_MUSIC_BASE = "https://totp99.github.io/source/mp3/";
const BG_MUSIC_MAX = 99; // 支持的最大编号（对应 1.mp3 ~ 99.mp3），实际数量以 source/mp3 目录为准

// ---------- 背景音乐（含频谱分析） ----------
class BGMusic {
  constructor() {
    this.currentNum = 1;
    this._skipAttempts = 0; // 连续跳过次数，防止全部文件缺失时死循环

    this.audio = new Audio();
    this.audio.loop = false; // 由 ended/error 事件控制切歌
    this.audio.preload = "auto";
    this.audio.volume = 0.5;

    const savedEnabled = localStorage.getItem("bgMusicEnabled");
    this.enabled = savedEnabled === null ? true : savedEnabled === "true";

    const savedMode = localStorage.getItem("bgMusicPlayMode");
    const savedShuffleLegacy = localStorage.getItem("bgMusicShuffle") === "true";
    let mode = savedMode || (savedShuffleLegacy ? "shuffle" : "order");
    if (mode !== "order" && mode !== "shuffle" && mode !== "single" && mode !== "all") {
      mode = "order";
    }
    this.playMode = mode;
    this.shuffle = this.playMode === "shuffle";

    const savedNum = parseInt(localStorage.getItem("bgMusicCurrentNum") || "1", 10);
    this.currentNum =
      Number.isFinite(savedNum) && savedNum >= 1 && savedNum <= BG_MUSIC_MAX
        ? savedNum
        : 1;

    // Web Audio 分析：频谱 → 均衡条（声高 / 情绪 / 男女声区 / 乐器频段）
    this.ctx = null;
    this.analyser = null;
    this._source = null;
    this._gain = null;
    this._freqData = null;
    this._connected = false;

    this.bands = [0, 0, 0, 0, 0];
    this.energy = 0;
    this.brightness = 0;
    this.vocalBias = 0;
    this._playing = false;
    this._bandBins = null;
    this._analyserFailed = false;

    this.audio.addEventListener("ended", () => this._advance());
    this.audio.addEventListener("error", () => this._advance());
    this.audio.addEventListener("playing", () => {
      this._skipAttempts = 0;
    });

    this._loadTrack(this.currentNum);
    this._setupMediaSession();
  }

  _setupMediaSession() {
    try {
      if (!("mediaSession" in navigator)) return;
      const update = () => {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "TP音乐 · 第 " + this.currentNum + " 首",
          artist: "万锦留声机",
          album: "Background",
        });
        navigator.mediaSession.playbackState = this.isPlaying()
          ? "playing"
          : "paused";
      };
      navigator.mediaSession.setActionHandler("play", () => {
        this.play();
        update();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        this.pause();
        update();
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        this.skipPrev();
        update();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        this.skipNext();
        update();
      });
      this.audio.addEventListener("play", update);
      this.audio.addEventListener("pause", update);
      update();
    } catch (e) {}
  }

  ensureAnalyser() {
    if (this._connected) {
      this._resumeCtx();
      return true;
    }
    if (this._analyserFailed) return false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        this._analyserFailed = true;
        return false;
      }
      if (!this.ctx) this.ctx = new AC();
      this._resumeCtx();
      if (!this.analyser) {
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.6;
        this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
        this._rebuildBandBins();
      }
      if (!this._source) {
        this._source = this.ctx.createMediaElementSource(this.audio);
        this._gain = this.ctx.createGain();
        this._gain.gain.value = 1;
        this._source.connect(this.analyser);
        this._source.connect(this._gain);
        this._gain.connect(this.ctx.destination);
      }
      this._connected = true;
      return true;
    } catch (e) {
      this._analyserFailed = true;
      this._connected = false;
      return false;
    }
  }

  _resumeCtx() {
    if (this.ctx && this.ctx.state === "suspended") {
      const r = this.ctx.resume();
      if (r && typeof r.catch === "function") r.catch(() => {});
    }
  }

  _playAudio() {
    this._resumeCtx();
    try {
      const p = this.audio.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          this._playing = false;
        });
      }
    } catch (e) {
      this._playing = false;
    }
  }

  _rebuildBandBins() {
    if (!this.analyser || !this.ctx) return;
    const n = this.analyser.frequencyBinCount;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const ranges = [
      [40, 120],
      [120, 320],
      [320, 1200],
      [1200, 4000],
      [4000, 12000],
    ];
    this._bandBins = ranges.map(([lo, hi]) => [
      Math.max(0, Math.floor(lo / binHz)),
      Math.min(n - 1, Math.ceil(hi / binHz)),
    ]);
  }

  sampleSpectrum() {
    const playing =
      this.enabled &&
      this.audio &&
      !this.audio.paused &&
      !this.audio.ended &&
      this.audio.currentTime > 0;
    this._playing = playing;

    if (!playing) {
      for (let i = 0; i < 5; i++) this.bands[i] *= 0.88;
      this.energy *= 0.9;
      this.brightness *= 0.92;
      this.vocalBias *= 0.92;
      return this.bands;
    }

    if (this._connected && this.analyser && this._freqData) {
      this.analyser.getByteFrequencyData(this._freqData);
      const data = this._freqData;
      if (!this._bandBins) this._rebuildBandBins();
      const bins = this._bandBins;

      for (let b = 0; b < 5; b++) {
        const a = bins[b][0];
        const c = bins[b][1];
        let sum = 0;
        const count = c - a + 1;
        for (let i = a; i <= c; i++) sum += data[i];
        const avg = sum / count / 255;
        let v = avg * 1.35;
        if (v > 1) v = 1;
        v = v * (0.85 + 0.15 * v);
        this.bands[b] = this.bands[b] * 0.55 + v * 0.45;
      }

      const e =
        (this.bands[0] +
          this.bands[1] +
          this.bands[2] +
          this.bands[3] +
          this.bands[4]) *
        0.2;
      this.energy = this.energy * 0.6 + e * 0.4;

      const bright =
        (this.bands[3] * 0.45 + this.bands[4] * 0.55) /
        (this.bands[0] * 0.5 + this.bands[1] * 0.3 + 0.15);
      this.brightness =
        this.brightness * 0.7 + (bright > 1.4 ? 1.4 : bright) * 0.3;

      this.vocalBias =
        this.vocalBias * 0.75 + (this.bands[3] - this.bands[1]) * 0.25;
    } else {
      const t = performance.now() * 0.001;
      const pulse = 0.35 + 0.25 * Math.sin(t * 4.2);
      const raw0 = pulse * (0.7 + 0.3 * Math.sin(t * 2.1));
      const raw1 = pulse * (0.45 + 0.25 * Math.sin(t * 3.3 + 1));
      const raw2 = pulse * (0.55 + 0.3 * Math.sin(t * 5.1 + 2));
      const raw3 = pulse * (0.4 + 0.35 * Math.sin(t * 6.7 + 0.5));
      const raw4 = pulse * (0.3 + 0.4 * Math.sin(t * 8.9 + 1.2));
      this.bands[0] = this.bands[0] * 0.7 + raw0 * 0.3;
      this.bands[1] = this.bands[1] * 0.7 + raw1 * 0.3;
      this.bands[2] = this.bands[2] * 0.7 + raw2 * 0.3;
      this.bands[3] = this.bands[3] * 0.7 + raw3 * 0.3;
      this.bands[4] = this.bands[4] * 0.7 + raw4 * 0.3;
      this.energy = this.energy * 0.7 + pulse * 0.3;
      this.brightness = 0.5;
      this.vocalBias = 0;
    }

    return this.bands;
  }

  isPlaying() {
    try {
      return (
        !!this.enabled &&
        !!this.audio &&
        !this.audio.paused &&
        !this.audio.ended
      );
    } catch (e) {
      return !!this._playing;
    }
  }

  _loadTrack(num) {
    this.currentNum = num;
    try {
      localStorage.setItem("bgMusicCurrentNum", String(num));
    } catch (e) {}
    this.audio.src = new URL(`${num}.mp3`, BG_MUSIC_BASE).href;
    this.audio.loop = this.playMode === "single";
    this._notifyTrackChange();
  }

  onTrackChange(cb) {
    if (typeof cb !== "function") return;
    if (!this._trackChangeListeners) this._trackChangeListeners = [];
    this._trackChangeListeners.push(cb);
  }

  _notifyTrackChange() {
    if (!this._trackChangeListeners) return;
    for (const cb of this._trackChangeListeners) {
      try {
        cb(this.currentNum);
      } catch (e) {}
    }
  }

  // order: 顺序到尽头后停；all: 顺序循环；shuffle: 随机；single: 单曲循环
  _pickNext() {
    if (this.playMode === "single") {
      return this.currentNum;
    }
    if (this.playMode === "shuffle") {
      if (BG_MUSIC_MAX <= 1) return 1;
      let next;
      do {
        next = 1 + Math.floor(Math.random() * BG_MUSIC_MAX);
      } while (next === this.currentNum);
      return next;
    }
    return this.currentNum >= BG_MUSIC_MAX ? 1 : this.currentNum + 1;
  }

  _advance() {
    this._skipAttempts += 1;
    if (this._skipAttempts > BG_MUSIC_MAX) {
      return;
    }
    if (this.playMode === "order" && this.currentNum >= BG_MUSIC_MAX) {
      this._loadTrack(1);
      this.pause();
      return;
    }
    if (this.playMode === "single") {
      this.audio.currentTime = 0;
      if (this.enabled) this._playAudio();
      return;
    }
    this._loadTrack(this._pickNext());
    if (this.enabled) this._playAudio();
  }

  setPlayMode(mode) {
    if (
      mode !== "order" &&
      mode !== "shuffle" &&
      mode !== "single" &&
      mode !== "all"
    ) {
      mode = "order";
    }
    this.playMode = mode;
    this.shuffle = mode === "shuffle";
    this.audio.loop = mode === "single";
    localStorage.setItem("bgMusicPlayMode", mode);
    localStorage.setItem("bgMusicShuffle", String(this.shuffle));
  }

  skipNext() {
    this._skipAttempts = 0;
    this._loadTrack(this._pickNext());
    if (this.enabled) this._playAudio();
  }

  skipPrev() {
    this._skipAttempts = 0;
    let prev;
    if (this.shuffle) {
      prev = this._pickNext();
    } else {
      prev = this.currentNum <= 1 ? BG_MUSIC_MAX : this.currentNum - 1;
    }
    this._loadTrack(prev);
    if (this.enabled) this._playAudio();
  }

  // 显式播放（▶️ 键）
  async play() {
    if (!this.audio) return;
    this.ensureAnalyser();
    if (!this.enabled) {
      this.enabled = true;
      localStorage.setItem("bgMusicEnabled", "true");
    }
    this._fadeGainTo(1, 0.05);
    this._playAudio();
  }

  // 需在用户手势（点击/触摸/按键）中调用，否则浏览器会拦截自动播放
  async tryPlay() {
    if (!this.enabled) return;
    this.ensureAnalyser();
    this._fadeGainTo(1, 0.05);
    this._playAudio();
  }

  _fadeGainTo(target, seconds) {
    if (!this._gain || !this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const g = this._gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + seconds);
    } catch (e) {}
  }

  pause() {
    if (this._gain && this.ctx && this.ctx.state === "running") {
      this._fadeGainTo(0, 0.06);
      const audioEl = this.audio;
      const gain = this._gain;
      setTimeout(() => {
        try {
          audioEl.pause();
        } catch (e) {}
        try {
          gain.gain.cancelScheduledValues(this.ctx.currentTime);
          gain.gain.setValueAtTime(1, this.ctx.currentTime);
        } catch (e) {}
      }, 70);
      return;
    }
    try {
      this.audio.pause();
    } catch (e) {}
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    localStorage.setItem("bgMusicEnabled", String(enabled));
    if (enabled) {
      this.tryPlay();
    } else {
      this.pause();
    }
  }
}

const bgMusic = new BGMusic();

// ---------- 首点解锁音频（iOS / 部分 Android 需用户手势） ----------
function unlockAudioOnce() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      if (ctx.state === "suspended") {
        const r = ctx.resume();
        if (r && typeof r.catch === "function") r.catch(() => {});
      }
    }
  } catch (e) {}
  try {
    bgMusic.tryPlay(); // 首次用户手势时启动背景音乐（若已开启）
  } catch (e) {}
  document.removeEventListener("touchstart", unlockAudioOnce, true);
  document.removeEventListener("mousedown", unlockAudioOnce, true);
  document.removeEventListener("keydown", unlockAudioOnce, true);
}
document.addEventListener("touchstart", unlockAudioOnce, true);
document.addEventListener("mousedown", unlockAudioOnce, true);
document.addEventListener("keydown", unlockAudioOnce, true);
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) {
    try {
      bgMusic.tryPlay();
    } catch (e) {}
  }
});

// ---------- 留声机主界面 + 迷你老虎机 ----------
// 余额/下注/累积奖池通过 localStorage 的 "wanjin_slot_save" 与横屏老虎机
// 共用同一份存档；两个游戏各自独立运行，互不依赖对方是否打开。
(function setupPhonograph() {
  var vinyl = document.getElementById("ph-vinyl");
  var arm = document.getElementById("ph-arm");
  var horn = document.getElementById("ph-horn");
  var label = document.getElementById("ph-label");
  var playBtn = document.getElementById("ph-play");
  var pauseBtn = document.getElementById("ph-pause");
  var prevBtn = document.getElementById("ph-prev");
  var nextBtn = document.getElementById("ph-next");
  var orderChip = document.getElementById("ph-order");
  var shuffleChip = document.getElementById("ph-shuffle");
  var trackNum = document.getElementById("ph-track-num");
  var clockFullEl = document.getElementById("ph-clock-full");
  var balanceEl = document.getElementById("ph-balance");
  var betEl = document.getElementById("ph-bet");
  var msgEl = document.getElementById("ph-msg");
  var spinBtn = document.getElementById("ph-spin");
  var spectrum = document.getElementById("ph-spectrum");
  var reelEls = [
    document.getElementById("ph-r0"),
    document.getElementById("ph-r1"),
    document.getElementById("ph-r2"),
  ];
  if (!vinyl || !playBtn || !pauseBtn) return;

  var miniSpinning = false;
  var phActive = false;
  var raf = 0;
  var vinylAngle = 0;
  var vinylVel = 0;
  var specSmooth = [0, 0, 0, 0, 0];
  var specHistory = [];
  var specLastSampleAt = 0;
  var specLastEnergy = 0;
  var specPhase = 0;
  var lastPlaying = null;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function updateClock() {
    var d = new Date();
    if (clockFullEl) {
      clockFullEl.textContent =
        pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    }
  }

  function syncTrack() {
    if (trackNum) {
      trackNum.textContent =
        pad2(bgMusic.currentNum) + "/" + pad2(BG_MUSIC_MAX);
    }
    var trackTitle = document.getElementById("ph-track-title");
    if (trackTitle) {
      trackTitle.textContent =
        "第 " + pad2(bgMusic.currentNum) + " 首 · TP音乐";
    }
  }

  function syncPlayUi() {
    var playing = bgMusic.isPlaying();
    if (playBtn) playBtn.classList.toggle("on", playing);
    if (pauseBtn) pauseBtn.classList.toggle("on", !playing);
    if (vinyl) vinyl.classList.toggle("playing", playing);
    if (label) label.classList.toggle("playing", playing);
    if (horn) horn.classList.toggle("playing", playing);
    if (arm && playing !== lastPlaying) {
      arm.classList.toggle("down", playing);
      arm.classList.toggle("up", !playing);
      lastPlaying = playing;
    }
    syncTrack();
    if (orderChip) orderChip.classList.toggle("on", bgMusic.playMode === "order");
    if (shuffleChip) shuffleChip.classList.toggle("on", bgMusic.playMode === "shuffle");
  }

  if (typeof bgMusic.onTrackChange === "function") {
    bgMusic.onTrackChange(syncTrack);
  }

  function readSave() {
    try {
      var raw = localStorage.getItem("wanjin_slot_save");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function writeSave(bal, bet, jackpotValue) {
    try {
      localStorage.setItem(
        "wanjin_slot_save",
        JSON.stringify({ balance: bal, bet: bet, jackpotValue: jackpotValue }),
      );
    } catch (e) {}
  }

  function syncWallet() {
    var bal = 1000;
    var bet = 50;
    var s = readSave();
    if (s) {
      if (typeof s.balance === "number") bal = s.balance;
      if (typeof s.bet === "number") bet = s.bet;
    }
    if (balanceEl) balanceEl.textContent = Number(bal).toFixed(0);
    if (betEl) betEl.textContent = "—$" + Number(bet).toFixed(0);
  }

  function setMsg(t) {
    if (msgEl) msgEl.textContent = t;
  }

  var SPEC_GRADIENT_RGB = [
    [255, 45, 149],
    [255, 140, 66],
    [255, 224, 102],
    [64, 224, 255],
    [61, 90, 255],
  ];
  var SPEC_COLOR_LUT = (function () {
    var lut = new Array(64);
    var stops = SPEC_GRADIENT_RGB;
    var n = stops.length - 1;
    for (var i = 0; i < 64; i++) {
      var t = i / 63;
      var pos = t * n;
      var seg = pos | 0;
      if (seg >= n) seg = n - 1;
      var localT = pos - seg;
      var c1 = stops[seg];
      var c2 = stops[seg + 1];
      var r = (c1[0] + (c2[0] - c1[0]) * localT + 0.5) | 0;
      var g = (c1[1] + (c2[1] - c1[1]) * localT + 0.5) | 0;
      var b = (c1[2] + (c2[2] - c1[2]) * localT + 0.5) | 0;
      lut[i] = "rgb(" + r + "," + g + "," + b + ")";
    }
    return lut;
  })();
  function specColorAt(t) {
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return SPEC_COLOR_LUT[(t * 63 + 0.5) | 0];
  }

  function drawSpectrum() {
    if (!spectrum || !phActive) return;
    var ctx = spectrum.getContext("2d");
    if (!ctx) return;

    var w = spectrum.width;
    var h = spectrum.height;
    var mid = h / 2;
    ctx.clearRect(0, 0, w, h);

    var now = performance.now();
    if (!drawSpectrum._lastAnalAt) drawSpectrum._lastAnalAt = 0;
    if (now - drawSpectrum._lastAnalAt > 32) {
      bgMusic.sampleSpectrum();
      drawSpectrum._lastAnalAt = now;
    }

    var bands = bgMusic.bands || [0, 0, 0, 0, 0];
    var playing = bgMusic.isPlaying();

    for (var b = 0; b < 5; b++) {
      var target = playing ? bands[b] : 0;
      specSmooth[b] = specSmooth[b] * 0.82 + target * 0.18;
    }

    var energy = bgMusic.energy || 0;
    var bass = specSmooth[0] || 0;
    var body = specSmooth[1] || 0;
    var transient = Math.max(0, energy - specLastEnergy);

    if (!playing) {
      specHistory = [];
      specLastSampleAt = now;
      specLastEnergy = 0;
      specPhase = 0;
    } else {
      if (!specLastSampleAt) specLastSampleAt = now;
      var elapsed = now - specLastSampleAt;
      var steps = Math.min(2, Math.floor(elapsed / 42));

      for (var s = 0; s < steps; s++) {
        var sampleEnergy = energy < 0 ? 0 : energy > 1 ? 1 : energy;
        var sampleBass = bass < 0 ? 0 : bass > 1 ? 1 : bass;
        var sampleBody = body < 0 ? 0 : body > 1 ? 1 : body;

        var amp = 14 + sampleEnergy * 56 + sampleBass * 62 + transient * 88;

        specPhase += 0.018 + sampleBass * 0.05 + sampleBody * 0.016;

        var skewed = specPhase + 0.32 * Math.sin(specPhase);
        var tri = (2 / Math.PI) * Math.asin(Math.sin(skewed));

        var swell = 0.6 + 0.4 * Math.max(0, Math.sin(specPhase * 0.22 + 0.4));
        var punch = transient * 3.5 > 1 ? 1 : transient * 3.5;

        var sample = tri * amp * (swell + punch * 0.5);

        if (specHistory.length > 0) {
          sample = sample * 0.82 + specHistory[specHistory.length - 1] * 0.18;
        }

        specHistory.push(sample);
        if (specHistory.length > 96) specHistory.shift();
      }

      if (steps > 0) specLastSampleAt += steps * 42;
      specLastEnergy = energy;
    }

    var points = specHistory.length;
    if (points < 2) {
      ctx.restore && ctx.restore();
      return;
    }

    var maxAbs = 1;
    for (var m = 0; m < points; m++) {
      var a = specHistory[m];
      if (a < 0) a = -a;
      if (a > maxAbs) maxAbs = a;
    }

    if (!drawSpectrum._xs) {
      drawSpectrum._xs = new Float32Array(128);
      drawSpectrum._ys = new Float32Array(128);
    }
    var xs = drawSpectrum._xs;
    var ys = drawSpectrum._ys;
    var invMax = 1 / maxAbs;
    var invN = 1 / (points - 1);

    for (var i = 0; i < points; i++) {
      var t = i * invN;
      xs[i] = (1 - t) * w;
      var normalized = specHistory[i] * invMax;
      var y = mid + normalized * (h * 0.55);
      var dy = (y - mid) / (h * 0.52);
      var dy2 = dy * dy;
      y = mid + (dy * (h * 0.52)) / (1 + dy2 * 0.35);
      ys[i] = y;
    }

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = playing ? 0.95 : 0.28;
    ctx.lineWidth = playing ? 1.6 : 1.2;
    ctx.setLineDash([7, 6]);
    ctx.shadowBlur = 0;

    var bandsN = 5;
    var seg = Math.max(1, (points / bandsN) | 0);
    for (var k = 0; k < bandsN; k++) {
      var i0 = k * seg;
      var i1 = k === bandsN - 1 ? points - 1 : (k + 1) * seg;
      if (i1 <= i0) continue;
      var tMid = (i0 + i1) * 0.5 * invN;
      ctx.beginPath();
      ctx.moveTo(xs[i0], ys[i0]);
      for (var i = i0 + 1; i <= i1; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.strokeStyle = specColorAt(tMid);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  function tickVinyl() {
    if (!vinyl) return;
    var playing = bgMusic.isPlaying();
    var energy = bgMusic.energy || 0;
    var targetVel = playing ? 1.8 + energy * 1.2 : 0;
    vinylVel += (targetVel - vinylVel) * (playing ? 0.06 : 0.08);
    if (Math.abs(vinylVel) < 0.002) vinylVel = 0;
    vinylAngle = (vinylAngle + vinylVel) % 360;
    vinyl.style.transform = "rotate(" + vinylAngle.toFixed(2) + "deg)";
  }

  function loop() {
    if (!phActive) return;
    if (document.hidden) {
      raf = 0;
      return;
    }
    tickVinyl();
    drawSpectrum();
    syncPlayUi();
    raf = requestAnimationFrame(loop);
  }

  function startPh() {
    phActive = true;
    updateClock();
    syncWallet();
    syncPlayUi();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (!document.hidden) {
      raf = requestAnimationFrame(loop);
    }
  }

  if (!window.__phVisibilityBound) {
    window.__phVisibilityBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (phActive && !raf) {
        raf = requestAnimationFrame(loop);
      }
    });
  }

  playBtn.addEventListener("click", function () {
    bgMusic.play();
    setTimeout(syncPlayUi, 80);
  });
  pauseBtn.addEventListener("click", function () {
    bgMusic.pause();
    setTimeout(syncPlayUi, 80);
  });
  prevBtn.addEventListener("click", function () {
    bgMusic.skipPrev();
    bumpArmOnSeek();
  });
  function bumpArmOnSeek() {
    if (!arm) return;
    arm.classList.add("up");
    arm.classList.remove("down");
    lastPlaying = null;
    setTimeout(function () {
      syncPlayUi();
    }, 420);
  }
  nextBtn.addEventListener("click", function () {
    bgMusic.skipNext();
    bumpArmOnSeek();
  });
  if (orderChip) {
    orderChip.addEventListener("click", function () {
      bgMusic.setPlayMode("order");
      syncPlayUi();
    });
  }
  if (shuffleChip) {
    shuffleChip.addEventListener("click", function () {
      bgMusic.setPlayMode("shuffle");
      syncPlayUi();
    });
  }

  // 迷你三格：与横屏共用余额存档、共用符号表(SYMBOLS)和判定逻辑
  // (rollSpinResult / evaluateSpinResult)，不再各自维护一份容易脱节的赔率表
  var DEFAULT_BASE_JACKPOT = 25000;
  var DEFAULT_JACKPOT = 25800;

  function randSym() {
    return SYMBOLS[(Math.random() * SYMBOLS.length) | 0];
  }

  function setReel(el, sym) {
    if (!el) return;
    el.innerHTML = "<span>" + sym.label + "</span>";
  }

  spinBtn.addEventListener("click", function () {
    if (miniSpinning) return;
    // 按下不触发音效：本页用户多在听歌，SPIN 音效会打断播放体验
    var bet = 50;
    var bal = 1000;
    var jackpotValue = DEFAULT_JACKPOT;
    var s = readSave();
    if (s) {
      if (typeof s.balance === "number") bal = s.balance;
      if (typeof s.bet === "number") bet = s.bet;
      if (typeof s.jackpotValue === "number") jackpotValue = s.jackpotValue;
    }
    if (bal < bet) {
      setMsg("—");
      return;
    }
    miniSpinning = true;
    spinBtn.disabled = true;
    bal -= bet;
    // 每转一次，JACKPOT 池累积当前下注的 5%
    jackpotValue += Math.max(1, Math.round(bet * 0.05));
    writeSave(bal, bet, jackpotValue);
    syncWallet();
    setMsg("");

    // 起转时就按概率表一次性决定这一把的结果，动画只是把它"演"出来
    var finalResult = rollSpinResult();
    var a = finalResult[0];
    var b = finalResult[1];
    var c = finalResult[2];

    var ticks = 0;
    var timer = setInterval(function () {
      setReel(reelEls[0], randSym());
      setReel(reelEls[1], randSym());
      setReel(reelEls[2], randSym());
      ticks++;
      if (ticks > 12) {
        clearInterval(timer);
        setReel(reelEls[0], a);
        setReel(reelEls[1], b);
        setReel(reelEls[2], c);

        var evalResult = evaluateSpinResult(a, b, c, bet, jackpotValue);
        var win = evalResult.win;

        if (evalResult.type === "jackpot") {
          setMsg("💎 JACKPOT +" + win);
        } else if (evalResult.type === "three") {
          setMsg(a.label + a.label + a.label + " +" + win);
        } else if (evalResult.type === "pair") {
          setMsg("一对 +" + win);
        } else {
          setMsg("");
        }

        if (win > 0) {
          bal += win;
          if (evalResult.type === "jackpot") {
            // JACKPOT 基础值按当前下注比例缩放（以 bet=50 为基准单位）
            jackpotValue =
              Math.round(DEFAULT_BASE_JACKPOT * (bet / 50)) +
              250 +
              Math.round(Math.random() * 1000);
          }
        }
        writeSave(bal, bet, jackpotValue);
        syncWallet();
        miniSpinning = false;
        spinBtn.disabled = false;
      }
    }, 70);
  });

  setInterval(updateClock, 1000);
  updateClock();
  syncWallet();
  syncPlayUi();

  // 独立页面：加载后立即启动（无需等待横竖屏切换）
  startPh();
})();
