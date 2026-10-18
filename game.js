/**
 * 万锦留声机 · 竖屏版
 * 与横屏老虎机独立，仅 localStorage "wanjin_slot_save" 共用余额/下注/奖池。
 */

const SYMBOLS = [
  { key: "seven", label: "7️⃣", multiplier: 50 },
  { key: "blossom", label: "🌸", multiplier: 20 },
  { key: "hibiscus", label: "🌺", multiplier: 15 },
  { key: "grape", label: "🍇", multiplier: 10 },
  { key: "strawberry", label: "🍓", multiplier: 8 },
  { key: "cherry", label: "🍒", multiplier: 6 },
  { key: "mushroom", label: "🍄", multiplier: 4 },
];

// 结果导向概率表：先定结果类型，再倒推轮面（RTP 可控）
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

// 曲目：source 仓库 mp3/1.mp3…；改数量时同步 BG_MUSIC_MAX
const BG_MUSIC_BASE = "https://totp99.github.io/source/mp3/";
const BG_MUSIC_MAX = 99;

class BGMusic {
  constructor() {
    this.currentNum = 1;
    this._skipAttempts = 0;

    this.audio = new Audio();
    this.audio.loop = false;
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous"; // 跨域 + MediaElementSource 必需
    this.audio.volume = 0.8;

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

    this.ctx = null;
    this.analyser = null;
    this._source = null;
    this._gain = null;
    this._freqData = null;
    this._connected = false;

    this.bands = [0, 0, 0, 0, 0];
    this.energy = 0;
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
        this._enhancer = null;
        if (typeof createAudioEnhancer === "function") {
          try {
            var enh = createAudioEnhancer(this.ctx);
            if (enh && enh.connectFrom(this._source, this._gain)) {
              this._enhancer = enh;
            }
          } catch (e) {}
        }
        if (!this._enhancer) {
          this._source.connect(this._gain);
        }
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

  async _requestWakeLock() {
    try {
      if (!("wakeLock" in navigator)) return;
      if (this._wakeLock) return;
      const sentinel = await navigator.wakeLock.request("screen");
      this._wakeLock = sentinel;
      sentinel.addEventListener("release", () => {
        this._wakeLock = null;
      });
    } catch (e) {
      this._wakeLock = null;
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
    if (this._enhancer && typeof this._enhancer.resetAgc === "function") {
      try {
        this._enhancer.resetAgc();
      } catch (e) {}
    }
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

  // order 播完停；all 循环；shuffle 随机；single 单曲
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

  _resetGainToOne() {
    if (this._gain && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this._gain.gain.cancelScheduledValues(now);
        this._gain.gain.setValueAtTime(1, now);
      } catch (e) {}
    } else {
      this._fadeGainTo(1, 0.05);
    }
  }

  /** 播放键：强制开启并播放 */
  async play() {
    if (!this.audio) return;
    this.ensureAnalyser();
    this._resumeCtx();
    if (!this.enabled) {
      this.enabled = true;
      localStorage.setItem("bgMusicEnabled", "true");
    }
    this._resetGainToOne();
    this._playAudio();
    this._requestWakeLock();
  }

  /** 用户手势内尝试播放（受 enabled 控制） */
  async tryPlay() {
    if (!this.enabled) return;
    this.ensureAnalyser();
    this._resumeCtx();
    this._resetGainToOne();
    this._playAudio();
    this._requestWakeLock();
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
    this._releaseWakeLock();
    try {
      this.audio.pause();
    } catch (e) {}
    if (this._gain && this.ctx && this.ctx.state === "running") {
      this._fadeGainTo(0, 0.03);
      const gain = this._gain;
      setTimeout(() => {
        try {
          gain.gain.cancelScheduledValues(this.ctx.currentTime);
          gain.gain.setValueAtTime(1, this.ctx.currentTime);
        } catch (e) {}
      }, 50);
    }
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

function unlockAudioOnce() {
  try {
    bgMusic.tryPlay();
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
    try {
      if (bgMusic.isPlaying()) bgMusic._requestWakeLock();
    } catch (e) {}
  }
});

(function setupPhonograph() {
  var vinyl = document.getElementById("ph-vinyl");
  var vinylWrap = document.querySelector(".ph-vinyl-wrap");
  var arm = document.getElementById("ph-arm");
  var horn = document.getElementById("ph-horn");
  var label = document.getElementById("ph-label");
  var playPauseBtn = document.getElementById("ph-playpause");
  var prevBtn = document.getElementById("ph-prev");
  var nextBtn = document.getElementById("ph-next");
  var barEl = document.getElementById("ph-bar");
  var barFill = document.getElementById("ph-bar-fill");
  var barDot = document.getElementById("ph-bar-dot");
  var curEl = document.getElementById("ph-cur");
  var durEl = document.getElementById("ph-dur");
  var orderChip = document.getElementById("ph-order");
  var shuffleChip = document.getElementById("ph-shuffle");
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
  if (!vinyl || !playPauseBtn || !prevBtn) return;

  var miniSpinning = false;
  var phActive = false;
  var raf = 0;
  var vinylAngle = 0;
  var vinylVel = 0;
  var specSmooth = [0, 0, 0, 0, 0];
  // 三条飘带各自历史与相位，相位差驱动缠绕律动
  var specHist = [[], [], []];
  var specPhase = [0, 2.1, 4.2];
  var specLastSampleAt = 0;
  var specLastEnergy = 0;
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
    var trackTitle = document.getElementById("ph-track-title");
    if (trackTitle) {
      trackTitle.textContent =
        "第 " + pad2(bgMusic.currentNum) + " 首 · TP音乐";
    }
  }

  function syncPlayUi() {
    var playing = bgMusic.isPlaying();
    if (playPauseBtn) playPauseBtn.classList.toggle("on", playing);
    if (vinylWrap) vinylWrap.classList.toggle("playing", playing);
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
      var prev = readSave() || {};
      prev.balance = bal;
      prev.bet = bet;
      prev.jackpotValue = jackpotValue;
      localStorage.setItem("wanjin_slot_save", JSON.stringify(prev));
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
    if (betEl) betEl.textContent = "注$" + Number(bet).toFixed(0);
  }

  function setMsg(t) {
    if (msgEl) msgEl.textContent = t;
  }

  // 三条飘带配色：低音粉橙 / 中音金青 / 高音蓝紫
  var RIBBON_COLORS = [
    [[255, 45, 149], [255, 140, 66], [255, 200, 100]],
    [[255, 224, 102], [64, 224, 255], [120, 200, 255]],
    [[61, 90, 255], [180, 100, 255], [255, 80, 200]],
  ];
  function ribbonColor(ri, t) {
    var stops = RIBBON_COLORS[ri];
    var n = stops.length - 1;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var pos = t * n;
    var seg = pos | 0;
    if (seg >= n) seg = n - 1;
    var localT = pos - seg;
    var c1 = stops[seg];
    var c2 = stops[seg + 1];
    var r = (c1[0] + (c2[0] - c1[0]) * localT + 0.5) | 0;
    var g = (c1[1] + (c2[1] - c1[1]) * localT + 0.5) | 0;
    var b = (c1[2] + (c2[2] - c1[2]) * localT + 0.5) | 0;
    return "rgb(" + r + "," + g + "," + b + ")";
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
    var midB = specSmooth[2] || 0;
    var high = (specSmooth[3] || 0) * 0.6 + (specSmooth[4] || 0) * 0.4;
    var transient = Math.max(0, energy - specLastEnergy);

    // 每条飘带侧重不同频段：0 低音、1 中段、2 高音
    var drive = [
      { amp: bass, speed: 0.014, phaseMul: 0.28, offsetY: 0 },
      { amp: body * 0.7 + midB * 0.3, speed: 0.022, phaseMul: 0.38, offsetY: 0 },
      { amp: high * 0.8 + midB * 0.2, speed: 0.031, phaseMul: 0.48, offsetY: 0 },
    ];

    if (!playing) {
      for (var ri = 0; ri < 3; ri++) specHist[ri] = [];
      specLastSampleAt = now;
      specLastEnergy = 0;
      specPhase[0] = 0;
      specPhase[1] = 2.1;
      specPhase[2] = 4.2;
    } else {
      if (!specLastSampleAt) specLastSampleAt = now;
      var elapsed = now - specLastSampleAt;
      var steps = Math.min(2, Math.floor(elapsed / 42));

      for (var s = 0; s < steps; s++) {
        var sampleEnergy = energy < 0 ? 0 : energy > 1 ? 1 : energy;
        var punch = transient * 3.5 > 1 ? 1 : transient * 3.5;

        for (var ri = 0; ri < 3; ri++) {
          var d = drive[ri];
          var aBand = d.amp < 0 ? 0 : d.amp > 1 ? 1 : d.amp;
          // 相位以不同速度推进，互相错开形成缠绕
          specPhase[ri] +=
            d.speed +
            aBand * 0.04 +
            sampleEnergy * 0.012 +
            (ri === 0 ? bass * 0.03 : 0);

          var skewed =
            specPhase[ri] +
            d.phaseMul * Math.sin(specPhase[ri] * (1.1 + ri * 0.15));
          var tri = (2 / Math.PI) * Math.asin(Math.sin(skewed));
          // 邻条相位交叉项：让三条互相「缠」
          var cross =
            0.22 *
            Math.sin(specPhase[(ri + 1) % 3] * 0.9 + ri) *
            (0.4 + aBand);
          var swell =
            0.55 +
            0.45 * Math.max(0, Math.sin(specPhase[ri] * 0.2 + ri * 0.7));
          var baseAmp =
            10 + sampleEnergy * 42 + aBand * 58 + punch * (50 - ri * 8);
          var sample = (tri + cross) * baseAmp * (swell + punch * 0.35);

          var hist = specHist[ri];
          if (hist.length > 0) {
            sample = sample * 0.8 + hist[hist.length - 1] * 0.2;
          }
          hist.push(sample);
          if (hist.length > 96) hist.shift();
        }
      }

      if (steps > 0) specLastSampleAt += steps * 42;
      specLastEnergy = energy;
    }

    var points = specHist[0].length;
    if (points < 2) return;

    // 三条共用归一化，避免某一条独占振幅
    var maxAbs = 1;
    for (var ri = 0; ri < 3; ri++) {
      var hist = specHist[ri];
      for (var m = 0; m < hist.length; m++) {
        var a = hist[m];
        if (a < 0) a = -a;
        if (a > maxAbs) maxAbs = a;
      }
    }

    if (!drawSpectrum._xs) {
      drawSpectrum._xs = new Float32Array(128);
      drawSpectrum._ys0 = new Float32Array(128);
      drawSpectrum._ys1 = new Float32Array(128);
      drawSpectrum._ys2 = new Float32Array(128);
    }
    var xs = drawSpectrum._xs;
    var yss = [drawSpectrum._ys0, drawSpectrum._ys1, drawSpectrum._ys2];
    var invMax = 1 / maxAbs;
    var invN = 1 / (points - 1);
    var scaleY = h * 0.42;

    for (var i = 0; i < points; i++) {
      var t = i * invN;
      xs[i] = (1 - t) * w;
      for (var ri = 0; ri < 3; ri++) {
        var normalized = specHist[ri][i] * invMax;
        // 垂直微偏：三条中心略错开，交叉更明显
        var yOff = (ri - 1) * (h * 0.06);
        var y = mid + yOff + normalized * scaleY;
        var dy = (y - mid) / (h * 0.5);
        var dy2 = dy * dy;
        y = mid + (dy * (h * 0.5)) / (1 + dy2 * 0.32);
        yss[ri][i] = y;
      }
    }

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 每条飘带视觉参数：低音厚暖、中音最亮、高音细+轻虚线
    // glowW = 光晕线宽，coreW = 芯线宽；high 用 setLineDash
    var ribbonStyle = [
      {
        glowW: playing ? 7.5 : 3.5,
        coreW: playing ? 2.2 : 1.2,
        glowA: playing ? 0.28 : 0.1,
        coreA: playing ? 0.92 : 0.28,
        blur: playing ? 12 : 0,
        shadow: "rgba(255, 90, 60, 0.55)",
        dash: null,
      },
      {
        glowW: playing ? 6.5 : 3,
        coreW: playing ? 2.0 : 1.15,
        glowA: playing ? 0.32 : 0.1,
        coreA: playing ? 0.98 : 0.3,
        blur: playing ? 14 : 0,
        shadow: "rgba(255, 215, 0, 0.6)",
        dash: null,
      },
      {
        glowW: playing ? 5 : 2.5,
        coreW: playing ? 1.4 : 1,
        glowA: playing ? 0.22 : 0.08,
        coreA: playing ? 0.85 : 0.22,
        blur: playing ? 9 : 0,
        shadow: "rgba(120, 140, 255, 0.5)",
        dash: playing ? [5, 4] : [3, 4],
      },
    ];

    function strokeRibbonSeg(ys, i0, i1) {
      ctx.beginPath();
      ctx.moveTo(xs[i0], ys[i0]);
      for (var i = i0 + 1; i < i1; i++) {
        var xc = (xs[i] + xs[i + 1]) / 2;
        var yc = (ys[i] + ys[i + 1]) / 2;
        ctx.quadraticCurveTo(xs[i], ys[i], xc, yc);
      }
      ctx.lineTo(xs[i1], ys[i1]);
      ctx.stroke();
    }

    // 从后往前：高 → 低 → 中（中音最后画，最亮在最前）
    var drawOrder = [2, 0, 1];
    var segN = 6;
    var seg = Math.max(1, (points / segN) | 0);

    for (var o = 0; o < 3; o++) {
      var ri = drawOrder[o];
      var ys = yss[ri];
      var st = ribbonStyle[ri];

      if (st.dash) ctx.setLineDash(st.dash);
      else ctx.setLineDash([]);

      ctx.shadowBlur = st.blur;
      ctx.shadowColor = st.shadow;

      for (var k = 0; k < segN; k++) {
        var i0 = k * seg;
        var i1 = k === segN - 1 ? points - 1 : (k + 1) * seg;
        if (i1 <= i0) continue;
        var tMid = (i0 + i1) * 0.5 * invN;
        var col = ribbonColor(ri, tMid);

        // 1) 光晕底笔：粗、半透明
        ctx.globalAlpha = st.glowA;
        ctx.lineWidth = st.glowW;
        ctx.strokeStyle = col;
        strokeRibbonSeg(ys, i0, i1);

        // 2) 芯线：细、更亮
        ctx.globalAlpha = st.coreA;
        ctx.lineWidth = st.coreW;
        ctx.strokeStyle = col;
        strokeRibbonSeg(ys, i0, i1);
      }
    }

    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  var ambientEl = document.getElementById("ph-ambient");
  var ambientLvl = 0;
  var lastVinylT = 0;
  function tickVinyl(now) {
    if (!vinyl) return;
    // 按真实时间推进：帧率波动时转速依然均匀
    if (!lastVinylT) lastVinylT = now || performance.now();
    var t = now || performance.now();
    var dt = (t - lastVinylT) / 1000;
    lastVinylT = t;
    if (dt <= 0 || dt > 0.25) dt = 0.016;
    var playing = bgMusic.isPlaying();
    var energy = bgMusic.energy || 0;
    var targetVel = playing ? 3.2 + energy * 1.6 : 0; // 度/帧@60fps
    var targetDps = targetVel * 60; // 换算成度/秒
    vinylVel += (targetDps - vinylVel) * (playing ? 0.07 : 0.09);
    if (Math.abs(vinylVel) < 0.12) vinylVel = 0;
    vinylAngle = (vinylAngle + vinylVel * dt) % 360;
    vinyl.style.transform = "rotate(" + vinylAngle.toFixed(2) + "deg)";
    if (ambientEl) {
      var target = playing ? 0.35 + energy * 0.65 : 0;
      ambientLvl += (target - ambientLvl) * 0.08;
      ambientEl.classList.toggle("lit", ambientLvl > 0.05);
      ambientEl.style.opacity = ambientLvl.toFixed(3);
    }
  }

  function loop(now) {
    if (!phActive) return;
    if (document.hidden) {
      raf = 0;
      return;
    }
    tickVinyl(now);
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

  playPauseBtn.addEventListener("click", function () {
    if (bgMusic.isPlaying()) bgMusic.pause();
    else bgMusic.play();
    syncPlayUi();
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
  // 进度条
  function fmtT(s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }
  function syncProgress() {
    var a = bgMusic.audio;
    if (!a) return;
    var d = a.duration, c = a.currentTime;
    var pct = d > 0 && isFinite(d) ? (c / d) * 100 : 0;
    if (barFill) barFill.style.width = pct + "%";
    if (barDot) barDot.style.left = pct + "%";
    var portrait =
      window.matchMedia &&
      window.matchMedia("(orientation: portrait)").matches;
    if (portrait) {
      if (curEl) curEl.textContent = Math.round(pct) + "%";
      if (durEl) durEl.textContent = "";
    } else {
      if (curEl) curEl.textContent = fmtT(c);
      if (durEl) durEl.textContent = fmtT(d);
    }
  }
  if (bgMusic.audio) {
    bgMusic.audio.addEventListener("timeupdate", syncProgress);
    bgMusic.audio.addEventListener("loadedmetadata", syncProgress);
  }
  function seekTo(clientX) {
    var a = bgMusic.audio, r = barEl.getBoundingClientRect();
    if (!a || !isFinite(a.duration) || a.duration <= 0) return;
    var pct = (clientX - r.left) / r.width;
    pct = Math.max(0, Math.min(1, pct));
    try { a.currentTime = pct * a.duration; } catch (e) {}
    syncProgress();
  }
  if (barEl) {
    barEl.addEventListener("pointerdown", function (e) {
      seekTo(e.clientX);
      var mv = function (ev) { seekTo(ev.clientX); };
      var up = function () {
        window.removeEventListener("pointermove", mv);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up);
    });
    barEl.addEventListener("keydown", function (e) {
      var a = bgMusic.audio;
      if (!a || !isFinite(a.duration)) return;
      if (e.key === "ArrowLeft") { a.currentTime = Math.max(0, a.currentTime - 5); e.preventDefault(); }
      if (e.key === "ArrowRight") { a.currentTime = Math.min(a.duration, a.currentTime + 5); e.preventDefault(); }
    });
  }
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
      setMsg("余额不足");
      return;
    }
    miniSpinning = true;
    spinBtn.disabled = true;
    bal -= bet;
    jackpotValue += Math.max(1, Math.round(bet * 0.05));
    writeSave(bal, bet, jackpotValue);
    syncWallet();
    setMsg("");

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
          setMsg("JACKPOT +" + win);
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

  function fitLandscapeLayout() {
    var root = document.documentElement;
    var isLandscape =
      window.matchMedia &&
      window.matchMedia("(orientation: landscape)").matches;
    if (!isLandscape) {
      root.style.removeProperty("--ph-shell-h");
      root.style.removeProperty("--ph-vinyl");
      root.style.removeProperty("--ph-stage");
      root.style.removeProperty("--ph-shell-pad");
      root.style.removeProperty("--ph-spec-h");
      root.style.removeProperty("--ph-arm-top");
      root.style.removeProperty("--ph-arm-right");
      return;
    }

    var page = document.getElementById("ph-page");
    var availH = page
      ? page.clientHeight
      : window.innerHeight || document.documentElement.clientHeight;
    var usable = Math.max(100, availH - 12);
    var shellH = Math.round(Math.min(240, Math.max(120, usable * 0.78)));
    var pad = Math.max(3, Math.min(8, Math.round(shellH * 0.035)));
    var vinyl = Math.round((shellH - pad * 2) * 0.88);
    vinyl = Math.max(80, Math.min(160, vinyl));
    var stage = Math.round(vinyl * 1.42);
    stage = Math.max(110, Math.min(220, stage));
    var specH = Math.round(Math.min(72, Math.max(40, vinyl * 0.42)));
    var armTop = vinyl < 120 ? "5%" : "7%";
    var armRight = vinyl < 120 ? "0%" : "1%";

    root.style.setProperty("--ph-shell-h", shellH + "px");
    root.style.setProperty("--ph-vinyl", vinyl + "px");
    root.style.setProperty("--ph-stage", stage + "px");
    root.style.setProperty("--ph-shell-pad", pad + "px");
    root.style.setProperty("--ph-spec-h", specH + "px");
    root.style.setProperty("--ph-arm-top", armTop);
    root.style.setProperty("--ph-arm-right", armRight);
  }

  var fitRaf = 0;
  var orientTimer = 0;
  var lastOrient =
    window.matchMedia && window.matchMedia("(orientation: landscape)").matches
      ? "landscape"
      : "portrait";

  function scheduleFit() {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitLandscapeLayout();
    });
  }

  function onOrientationSmooth() {
    var nowOrient =
      window.matchMedia && window.matchMedia("(orientation: landscape)").matches
        ? "landscape"
        : "portrait";
    var phRoot = document.querySelector(".ph-root");
    if (!phRoot) {
      scheduleFit();
      return;
    }
    if (nowOrient === lastOrient) {
      scheduleFit();
      return;
    }
    lastOrient = nowOrient;
    if (orientTimer) clearTimeout(orientTimer);

    var shell = phRoot.querySelector(".ph-shell");
    if (arm) {
      arm.classList.add("up");
      arm.classList.remove("down");
      lastPlaying = null;
    }
    phRoot.classList.add("ph-orienting");

    orientTimer = setTimeout(function () {
      fitLandscapeLayout();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          phRoot.classList.remove("ph-orienting");
          if (shell) {
            shell.classList.remove("ph-shell-flash");
            void shell.offsetWidth;
            shell.classList.add("ph-shell-flash");
          }
          setTimeout(function () {
            syncPlayUi();
            if (shell) shell.classList.remove("ph-shell-flash");
          }, 580);
        });
      });
      orientTimer = 0;
    }, 180);
  }

  fitLandscapeLayout();
  window.addEventListener("resize", onOrientationSmooth);
  window.addEventListener("orientationchange", function () {
    setTimeout(onOrientationSmooth, 60);
    setTimeout(onOrientationSmooth, 200);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onOrientationSmooth);
  }
  if (window.matchMedia) {
    try {
      window
        .matchMedia("(orientation: landscape)")
        .addEventListener("change", onOrientationSmooth);
    } catch (e) {
      try {
        window
          .matchMedia("(orientation: landscape)")
          .addListener(onOrientationSmooth);
      } catch (e2) {}
    }
  }

  startPh();
})();
