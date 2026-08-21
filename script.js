(() => {
  'use strict';

  /* ==================== 設定 ==================== */
  const STORAGE_KEY = 'blockKuzushiSave_v1';
  const CLEAR_RATIO = 1.0;      // ステージクリアに必要なブロック破壊率
  const MAX_LIFE = 3;
  const BALL_SPEED = 4.6;
  const BALL_BASE_SPEED = Math.hypot(BALL_SPEED * 0.4, BALL_SPEED * 0.9); // 通常時の基準速度（大きさ）
  const SPEED_RATIO_BONUS_MAX = 0.6; // 破壊率100%到達時点で基準速度に対し最大+60%
  const SCORE_PER_BLOCK = 10;
  const ITEM_FALL_SPEED = 2.4;   // アイテムの落下速度(px/frame)
  const ITEM_SIZE = 26;          // アイテムの描画サイズ(直径)
  const PADDLE_BASE_W = 90;          // パドルの基本幅
  const PADDLE_EXPAND_MULT = 1.6;    // パドル拡大時の倍率
  const PADDLE_EXPAND_DURATION = 8000; // パドル拡大の持続時間(ms)
  const PIERCE_DURATION = 6000;      // 貫通ボールの持続時間(ms)
  const BALL_RADIUS = 7;
  const PADDLE_BOUNCE_MAX_ANGLE_DEG = 60; // パドル反射の最大角度(度)
  const PADDLE_BOUNCE_MAX_ANGLE = PADDLE_BOUNCE_MAX_ANGLE_DEG * Math.PI / 180;

  // アイテム種類ごとの出現確率・見た目（ブロック破壊時にこの順で判定）
  const ITEM_TYPES = {
    life:   { chance: 0.001, color: 'rgba(224, 90, 90, 0.95)',  label: '+1' },
    paddle: { chance: 0.03,  color: 'rgba(90, 150, 224, 0.95)', label: 'W+' },
    multi:  { chance: 0.04,  color: 'rgba(110, 200, 140, 0.95)', label: '2x' },
    pierce: { chance: 0.01,  color: 'rgba(224, 180, 90, 0.95)', label: '⚡' },
  };
  const IMAGE_ASPECT = 768 / 1280; // 差し込み画像の縦横比（幅/高さ）
  const MIN_PLAY_GAP = 140; // ブロックエリア下端からパドルまでの最低プレイスペース(px)
  const FRAME_SIDE_WIDTH = 14; // 反射壁(左右)の最低幅(px)。ブロックエリア上端の反射壁高さは blockAreaTop を流用
  const GAP_WIDTH = 28; // 反射壁の穴の幅(px)。ボール直径の2倍程度
  const MAX_GAPS_BY_STAGE = [4, 3, 3, 3, 2, 2, 2, 1, 1, 1]; // ステージごとの穴の最大数(辺ごと)。進むほど減少

  // ステージごとのブロック配置（行×列）。必要に応じて増やせる。
  const STAGES = [
    { rows: 42, cols: 8 },
    { rows: 48, cols: 8 },
    { rows: 48, cols: 9 },
    { rows: 54, cols: 9 },
    { rows: 60, cols: 10 },
    { rows: 60, cols: 11 },
    { rows: 66, cols: 11 },
    { rows: 66, cols: 12 },
    { rows: 72, cols: 12 },
    { rows: 72, cols: 13 },
  ];

  // カスタム画像が未設定のステージ用プレースホルダー配色
  const PLACEHOLDER_COLORS = [
    ['#3a3f5c', '#6a4c93'],
    ['#2f5d62', '#4c9a8e'],
    ['#5c3a3a', '#a45c5c'],
    ['#3a4a5c', '#5c86a4'],
    ['#4a3a5c', '#8a5ca4'],
    ['#3a5c56', '#4c9a86'],
    ['#5c4a2f', '#a4805c'],
    ['#2f3a5c', '#5c72a4'],
    ['#4a2f5c', '#8a5ca8'],
    ['#5c2f3a', '#a45c72'],
  ];

  /* ==================== 状態 ==================== */
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let W = 0, H = 0;

  let stageIndex = 0;          // 0-indexed
  let images = {};             // { stage1: dataURL, ... }
  let loadedImages = {};       // { stage1: HTMLImageElement }
  let matImages = {};          // { mat1: dataURL, ... } 周辺部（マット）用画像
  let loadedMatImages = {};    // { mat1: HTMLImageElement }

  let blocks = [];
  let blockAreaTop = 0, blockAreaLeft = 0, blockAreaWidth = 0, blockAreaHeight = 0;
  let totalBlocks = 0, brokenBlocks = 0;

  let paddle = { x: 0, y: 0, w: PADDLE_BASE_W, h: 14 };
  let balls = []; // 複数ボール対応 { x, y, r, vx, vy, slow }
  let paddleExpandUntil = 0; // performance.now()基準のタイムスタンプ
  let pierceUntil = 0;       // performance.now()基準のタイムスタンプ
  let topGaps = [], leftGaps = [], rightGaps = []; // 反射壁の穴 { start, end }（絶対座標）。ステージ開始時に再生成

  let life = MAX_LIFE;
  let score = 0;

  let items = []; // 落下中のアイテム { x, y, type }

  let running = false;         // ボールが動いているか
  let dragging = false;
  let activePointerId = null;

  /* ==================== セーブデータ ==================== */
  function loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.currentStage === 'number') {
        stageIndex = Math.max(0, Math.min(STAGES.length - 1, data.currentStage - 1));
      }
      if (data.images && typeof data.images === 'object') {
        images = data.images;
      }
      if (data.matImages && typeof data.matImages === 'object') {
        matImages = data.matImages;
      }
    } catch (e) {
      console.warn('セーブデータの読み込みに失敗しました', e);
    }
  }

  function saveGame() {
    try {
      const data = { currentStage: stageIndex + 1, images, matImages };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('セーブデータの保存に失敗しました', e);
    }
  }

  function resetStageProgress() {
    stageIndex = 0;
    saveGame();
  }

  function resetAllImages() {
    images = {};
    loadedImages = {};
    saveGame();
  }

  function resetAllMatImages() {
    matImages = {};
    loadedMatImages = {};
    saveGame();
  }

  function stageKey(idx) {
    return 'stage' + (idx + 1);
  }

  function matKey(idx) {
    return 'mat' + (idx + 1);
  }

  function ensureStageImageLoaded(idx) {
    const key = stageKey(idx);
    if (loadedImages[key]) return;
    const src = images[key];
    if (!src) return;
    const img = new Image();
    img.onload = () => { loadedImages[key] = img; };
    img.src = src;
  }

  function ensureMatImageLoaded(idx) {
    const key = matKey(idx);
    if (loadedMatImages[key]) return;
    const src = matImages[key];
    if (!src) return;
    const img = new Image();
    img.onload = () => { loadedMatImages[key] = img; };
    img.src = src;
  }

  /* ==================== レイアウト ==================== */
  function resize() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    blockAreaTop = 64;
    const maxAreaHeight = H - blockAreaTop - MIN_PLAY_GAP; // パドル/ボール用の最低余白を確保
    let areaWidth = W - FRAME_SIDE_WIDTH * 2; // 反射壁(左右)の最低幅を確保
    let areaHeight = areaWidth / IMAGE_ASPECT;
    if (areaHeight > maxAreaHeight) {
      areaHeight = maxAreaHeight;
      areaWidth = areaHeight * IMAGE_ASPECT;
    }
    blockAreaWidth = areaWidth;
    blockAreaHeight = areaHeight;
    blockAreaLeft = (W - areaWidth) / 2;

    paddle.y = H - 64;
    paddle.x = Math.min(Math.max(paddle.x, paddle.w / 2), W - paddle.w / 2) || W / 2;

    layoutBlocks();
  }

  function layoutBlocks() {
    const cfg = STAGES[stageIndex];
    const pad = 0; // ブロック間の隙間なし（検証用）
    const cols = cfg.cols, rows = cfg.rows;
    const bw = (blockAreaWidth - pad * (cols + 1)) / cols;
    const bh = (blockAreaHeight - pad * (rows + 1)) / rows;

    const newBlocks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        newBlocks.push({
          x: blockAreaLeft + pad + c * (bw + pad),
          y: blockAreaTop + pad + r * (bh + pad),
          w: bw,
          h: bh,
          alive: true,
        });
      }
    }
    blocks = newBlocks;
    totalBlocks = blocks.length;
    brokenBlocks = 0;
  }

  /* ==================== ステージ制御 ==================== */
  function generateGapsOnSegment(rangeStart, rangeEnd, count, gapWidth) {
    // [rangeStart, rangeEnd] を count 個のゾーンに分割し、各ゾーン内にランダムな位置で穴を1つ配置する（重なり防止）
    const length = rangeEnd - rangeStart;
    const zoneLen = length / count;
    const gaps = [];
    for (let i = 0; i < count; i++) {
      const zoneStart = rangeStart + i * zoneLen;
      const maxOffset = Math.max(0, zoneLen - gapWidth);
      const start = zoneStart + Math.random() * maxOffset;
      gaps.push({ start, end: Math.min(start + gapWidth, rangeEnd) });
    }
    return gaps;
  }

  function generateWallGaps() {
    const maxGaps = MAX_GAPS_BY_STAGE[Math.min(stageIndex, MAX_GAPS_BY_STAGE.length - 1)];
    const rand = (max) => 1 + Math.floor(Math.random() * max); // 1〜max のランダムな穴の数
    const rightX = blockAreaLeft + blockAreaWidth;
    const blockAreaBottom = blockAreaTop + blockAreaHeight;
    topGaps = generateGapsOnSegment(blockAreaLeft, rightX, rand(maxGaps), GAP_WIDTH);
    leftGaps = generateGapsOnSegment(blockAreaTop, blockAreaBottom, rand(maxGaps), GAP_WIDTH);
    rightGaps = generateGapsOnSegment(blockAreaTop, blockAreaBottom, rand(maxGaps), GAP_WIDTH);
  }

  function resetStage(fullReset) {
    layoutBlocks();
    if (fullReset) { life = MAX_LIFE; score = 0; }
    items = [];
    paddle.w = PADDLE_BASE_W;
    paddleExpandUntil = 0;
    pierceUntil = 0;
    generateWallGaps();
    ensureStageImageLoaded(stageIndex);
    ensureMatImageLoaded(stageIndex);
    paddle.x = W / 2;
    resetBall();
    running = false;
    showTapHint(true);
    updatePanel();
  }

  function createBall(x, y) {
    return { x, y, r: BALL_RADIUS, vx: 0, vy: 0, slow: false };
  }

  function resetBall() {
    balls = [createBall(paddle.x, paddle.y - paddle.h / 2 - BALL_RADIUS - 0.5)];
  }

  function launchBall() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    // 発射直後は速度半分。最初にパドルへ跳ね返るまで維持する
    const b = balls[0];
    b.vx = BALL_SPEED * 0.4 * dir * 0.5;
    b.vy = -BALL_SPEED * 0.9 * 0.5;
    b.slow = true;
  }

  function goToNextStage() {
    stageIndex = (stageIndex + 1) % STAGES.length;
    saveGame();
    resetStage(false);
    hideModal(clearModal);
  }

  function retryStage() {
    resetStage(true);
    hideModal(overModal);
  }

  /* ==================== 描画 ==================== */
  function computeCoverRect(img, w, h) {
    // object-fit: cover相当のsource矩形(sx, sy, sw, sh)を計算する
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale, sh = h / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) / 2;
    return { sx, sy, sw, sh };
  }

  function drawImageCover(img, x, y, w, h, alpha) {
    if (!img || !img.naturalWidth) return;
    const { sx, sy, sw, sh } = computeCoverRect(img, w, h);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }

  function drawPlaceholder(x, y, w, h, alpha, idx) {
    const [c1, c2] = PLACEHOLDER_COLORS[idx % PLACEHOLDER_COLORS.length];
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function drawItem(it) {
    const cfg = ITEM_TYPES[it.type] || ITEM_TYPES.life;
    const r = ITEM_SIZE / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(it.x, it.y, r, 0, Math.PI * 2);
    ctx.fillStyle = cfg.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(244, 242, 236, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#f4f2ec';
    ctx.font = 'bold 12px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cfg.label, it.x, it.y + 0.5);
    ctx.restore();
  }

  function complementSegments(rangeStart, rangeEnd, gaps) {
    // gapsで指定された区間を除いた「壁が存在する」区間のリストを返す
    const segments = [];
    let cursor = rangeStart;
    for (const g of gaps) {
      if (g.start > cursor) segments.push({ start: cursor, end: g.start });
      cursor = Math.max(cursor, g.end);
    }
    if (cursor < rangeEnd) segments.push({ start: cursor, end: rangeEnd });
    return segments;
  }

  const WALL_THICKNESS = 6; // 壁の当たり判定用の厚み（見た目のフレームとは別。境界線をまたぐ判定を安定させるため）
  const WALL_BOUNCE_MARGIN = 0.05; // 跳ね返り位置に持たせる微小な余白（浮動小数点誤差によるブロックとの誤衝突防止）
  const GAP_FADE_ALPHA = 0.35; // 反射壁の穴（開口部）の区間で、帯の背景（マット画像/単色）を描画する際の不透明度

  function collideVerticalWall(ball, wallX, segStart, segEnd) {
    // 左右の壁用：wallXを中心とした薄い壁に、ブロックと同様の単純な矩形衝突判定を行う
    const left = wallX - WALL_THICKNESS / 2;
    const right = wallX + WALL_THICKNESS / 2;
    if (ball.x + ball.r > left && ball.x - ball.r < right &&
        ball.y + ball.r > segStart && ball.y - ball.r < segEnd) {
      if (ball.x < wallX) {
        ball.x = left - ball.r - WALL_BOUNCE_MARGIN;
        ball.vx = -Math.abs(ball.vx);
      } else {
        ball.x = right + ball.r + WALL_BOUNCE_MARGIN;
        ball.vx = Math.abs(ball.vx);
      }
      return true;
    }
    return false;
  }

  function collideHorizontalWall(ball, wallY, segStart, segEnd) {
    // 上壁用：wallYを中心とした薄い壁に、ブロックと同様の単純な矩形衝突判定を行う
    const top = wallY - WALL_THICKNESS / 2;
    const bottom = wallY + WALL_THICKNESS / 2;
    if (ball.y + ball.r > top && ball.y - ball.r < bottom &&
        ball.x + ball.r > segStart && ball.x - ball.r < segEnd) {
      if (ball.y < wallY) {
        ball.y = top - ball.r - WALL_BOUNCE_MARGIN;
        ball.vy = -Math.abs(ball.vy);
      } else {
        ball.y = bottom + ball.r + WALL_BOUNCE_MARGIN;
        ball.vy = Math.abs(ball.vy);
      }
      return true;
    }
    return false;
  }


  function strokeVerticalLine(x, yStart, yEnd, gaps) {
    ctx.beginPath();
    for (const s of complementSegments(yStart, yEnd, gaps)) {
      ctx.moveTo(x, s.start);
      ctx.lineTo(x, s.end);
    }
    ctx.stroke();
  }

  function strokeHorizontalLine(y, xStart, xEnd, gaps) {
    ctx.beginPath();
    for (const s of complementSegments(xStart, xEnd, gaps)) {
      ctx.moveTo(s.start, y);
      ctx.lineTo(s.end, y);
    }
    ctx.stroke();
  }

  function drawFrame() {
    const rightX = blockAreaLeft + blockAreaWidth;
    const bottomY = blockAreaTop + blockAreaHeight;
    const matImg = loadedMatImages[matKey(stageIndex)];

    ctx.save();

    // 帯（フレーム）の背景：マット画像は帯ごとに個別クロップせず、
    // 「下敷き」として画像1枚をフレーム全体の外接矩形(0,0,W,bottomY)に対して1回だけcover計算し、
    // 上・左・右の帯はその同じ絵を覗く窓として描画する。
    // 左右の帯は画面上端(y=0)から、上の帯は画面幅いっぱい(x=0〜W)から描画し、
    // 左上・右上のコーナー（上帯と左右帯の交差部分）も画像/単色で覆う（重なりはPath2D上で問題なし）
    //
    // 穴の区間（開口部）だけは不透明度を下げて描画し、下地の暗い背景を透かせることで
    // 「そこだけ薄い＝通過できる」ことを視覚的に示す（案D）
    const coverImg = (matImg && matImg.naturalWidth) ? matImg : null;
    const cover = coverImg ? computeCoverRect(coverImg, W, bottomY) : null;

    // 隣接する区間の境界をわずかに重ねることで、Path2Dの矩形境界のアンチエイリアシングによる
    // 継ぎ目（下地の暗い背景色が線状に透けて見える現象）を防ぐ
    const SEG_OVERLAP = 0.75;
    const pad = s => ({ start: s.start - SEG_OVERLAP, end: s.end + SEG_OVERLAP });

    function fillBandRects(rects, alpha) {
      if (rects.length === 0) return;
      const path = new Path2D();
      for (const r of rects) path.rect(r[0], r[1], r[2], r[3]);
      ctx.save();
      ctx.clip(path);
      ctx.globalAlpha = alpha;
      if (coverImg) {
        ctx.drawImage(coverImg, cover.sx, cover.sy, cover.sw, cover.sh, 0, 0, W, bottomY);
      } else {
        ctx.fillStyle = '#1b1e29';
        ctx.fillRect(0, 0, W, bottomY);
      }
      ctx.restore();
    }

    // 左帯：コーナー(y:0〜blockAreaTop)は常に不透明。ブロックエリア高さ範囲は穴を除いた区間のみ不透明、穴の区間は薄く
    if (blockAreaLeft > 0) {
      const opaqueSegs = [{ start: 0, end: blockAreaTop }].concat(complementSegments(blockAreaTop, bottomY, leftGaps));
      fillBandRects(opaqueSegs.map(pad).map(s => [0, s.start, blockAreaLeft, s.end - s.start]), 1);
      fillBandRects(leftGaps.map(pad).map(s => [0, s.start, blockAreaLeft, s.end - s.start]), GAP_FADE_ALPHA);
    }
    // 右帯：左帯と同様
    if (rightX < W) {
      const opaqueSegs = [{ start: 0, end: blockAreaTop }].concat(complementSegments(blockAreaTop, bottomY, rightGaps));
      fillBandRects(opaqueSegs.map(pad).map(s => [rightX, s.start, W - rightX, s.end - s.start]), 1);
      fillBandRects(rightGaps.map(pad).map(s => [rightX, s.start, W - rightX, s.end - s.start]), GAP_FADE_ALPHA);
    }
    // 上帯：左右コーナー(x:0〜blockAreaLeft、rightX〜W)は常に不透明。ブロックエリア幅範囲は穴を除いた区間のみ不透明、穴の区間は薄く
    if (blockAreaTop > 0) {
      const opaqueSegs = [{ start: 0, end: blockAreaLeft }]
        .concat(complementSegments(blockAreaLeft, rightX, topGaps))
        .concat([{ start: rightX, end: W }]);
      fillBandRects(opaqueSegs.map(pad).map(s => [s.start, 0, s.end - s.start, blockAreaTop]), 1);
      fillBandRects(topGaps.map(pad).map(s => [s.start, 0, s.end - s.start, blockAreaTop]), GAP_FADE_ALPHA);
    }

    // 反射境界線（内側の縁を強調。こちらは従来通り、穴の位置で線を途切れさせる＝壁の実体位置の視覚的な手がかりとして維持）
    ctx.strokeStyle = 'rgba(217, 119, 87, 0.65)';
    ctx.lineWidth = 2;
    strokeVerticalLine(blockAreaLeft, blockAreaTop, bottomY, leftGaps);
    strokeVerticalLine(rightX, blockAreaTop, bottomY, rightGaps);
    strokeHorizontalLine(blockAreaTop, blockAreaLeft, rightX, topGaps);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0e14';
    ctx.fillRect(0, 0, W, H);

    drawFrame();

    const ratio = totalBlocks ? brokenBlocks / totalBlocks : 0;
    const key = stageKey(stageIndex);
    const img = loadedImages[key];

    if (ratio > 0) {
      if (img) {
        drawImageCover(img, blockAreaLeft, blockAreaTop, blockAreaWidth, blockAreaHeight, ratio);
      } else {
        drawPlaceholder(blockAreaLeft, blockAreaTop, blockAreaWidth, blockAreaHeight, ratio, stageIndex);
      }
    }

    // ブロック
    for (const b of blocks) {
      if (!b.alive) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(244, 242, 236, 1)';
      ctx.strokeStyle = 'rgba(12, 14, 20, 0.5)';
      ctx.lineWidth = 1;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }

    // アイテム
    for (const it of items) {
      drawItem(it);
    }

    // パドル
    ctx.save();
    ctx.fillStyle = '#d97757';
    roundRect(paddle.x - paddle.w / 2, paddle.y - paddle.h / 2, paddle.w, paddle.h, 7);
    ctx.fill();
    ctx.restore();

    // ボール
    ctx.save();
    ctx.fillStyle = '#f4f2ec';
    for (const b of balls) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ==================== 物理更新 ==================== */
  function rollItemType() {
    let r = Math.random();
    for (const type in ITEM_TYPES) {
      const chance = ITEM_TYPES[type].chance;
      if (r < chance) return type;
      r -= chance;
    }
    return null;
  }

  function spawnExtraBall() {
    if (balls.length === 0) return;
    const src = balls[0];
    const speed = Math.hypot(src.vx, src.vy) || BALL_BASE_SPEED;
    const angle = Math.atan2(src.vy, src.vx) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 6);
    balls.push({
      x: src.x,
      y: src.y,
      r: BALL_RADIUS,
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
      slow: false,
    });
  }

  function update() {
    if (!running) return;
    const now = performance.now();

    // パドル拡大：時間切れなら基本幅に戻す
    paddle.w = (now < paddleExpandUntil) ? PADDLE_BASE_W * PADDLE_EXPAND_MULT : PADDLE_BASE_W;
    const piercing = now < pierceUntil;

    for (let i = balls.length - 1; i >= 0; i--) {
      const ball = balls[i];
      ball.x += ball.vx;
      ball.y += ball.vy;

      // 壁反射（反射壁：ブロックと同じ「実体のある物体」として、穴のない区間にだけ当たり判定を持つ。
      // 内側/外側の状態は持たず、毎フレームの位置だけで単純に当たったら跳ね返る）
      const rightX = blockAreaLeft + blockAreaWidth;
      const blockAreaBottom = blockAreaTop + blockAreaHeight;

      for (const seg of complementSegments(blockAreaLeft, rightX, topGaps)) {
        if (collideHorizontalWall(ball, blockAreaTop, seg.start, seg.end)) break;
      }
      for (const seg of complementSegments(blockAreaTop, blockAreaBottom, leftGaps)) {
        if (collideVerticalWall(ball, blockAreaLeft, seg.start, seg.end)) break;
      }
      for (const seg of complementSegments(blockAreaTop, blockAreaBottom, rightGaps)) {
        if (collideVerticalWall(ball, rightX, seg.start, seg.end)) break;
      }

      // 画面の真の端（キャンバス端）は壁の有無に関わらず常に有効
      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -1; }
      if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx *= -1; }
      if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= -1; }

      // パドル反射
      if (ball.vy > 0 &&
          ball.y + ball.r >= paddle.y - paddle.h / 2 &&
          ball.y - ball.r <= paddle.y + paddle.h / 2 &&
          ball.x >= paddle.x - paddle.w / 2 - ball.r &&
          ball.x <= paddle.x + paddle.w / 2 + ball.r) {
        const offset = (ball.x - paddle.x) / (paddle.w / 2); // -1 〜 1
        let speed = Math.hypot(ball.vx, ball.vy);
        if (ball.slow) {
          // 最初のパドル反射で速度を通常に戻す
          speed *= 2;
          ball.slow = false;
        }
        const angle = offset * PADDLE_BOUNCE_MAX_ANGLE;
        ball.vx = speed * Math.sin(angle);
        ball.vy = -Math.abs(speed * Math.cos(angle));
        ball.y = paddle.y - paddle.h / 2 - ball.r - 0.5;
      }

      // ブロック衝突
      for (const b of blocks) {
          if (!b.alive) continue;
          if (ball.x + ball.r > b.x && ball.x - ball.r < b.x + b.w &&
              ball.y + ball.r > b.y && ball.y - ball.r < b.y + b.h) {
            b.alive = false;
            brokenBlocks++;
            score += SCORE_PER_BLOCK;
            if (!piercing) {
              ball.vy *= -1; // 貫通中は跳ね返さずそのまま直進
            }

            // アイテム抽選（種類ごとの確率で1つだけ判定）
            const dropType = rollItemType();
            if (dropType) {
              items.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, type: dropType });
            }

            // 破壊率に応じてボール速度を段階的に上昇させる
            const ratioNow = brokenBlocks / totalBlocks;
            const targetSpeed = BALL_BASE_SPEED * (1 + SPEED_RATIO_BONUS_MAX * ratioNow) * (ball.slow ? 0.5 : 1);
            const curSpeed = Math.hypot(ball.vx, ball.vy);
            if (curSpeed > 0) {
              const scale = targetSpeed / curSpeed;
              ball.vx *= scale;
              ball.vy *= scale;
            }

            updatePanel();

            if (brokenBlocks / totalBlocks >= CLEAR_RATIO) {
              onStageClear();
            }
            break;
          }
        }

      // 落下判定（このボールだけ配列から除去。他のボールが残っていればライフは減らさない）
      if (ball.y - ball.r > H) {
        balls.splice(i, 1);
      }
    }

    // 全ボールが画面外に落ちた場合のみライフを減らす
    if (balls.length === 0) {
      life--;
      updatePanel();
      if (life <= 0) {
        onGameOver();
      } else {
        running = false;
        resetBall();
        showTapHint(true);
      }
    }

    // アイテムの落下・キャッチ・画面外消失
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      it.y += ITEM_FALL_SPEED;

      const half = ITEM_SIZE / 2;
      const caught =
        it.y + half >= paddle.y - paddle.h / 2 &&
        it.y - half <= paddle.y + paddle.h / 2 &&
        it.x >= paddle.x - paddle.w / 2 - half &&
        it.x <= paddle.x + paddle.w / 2 + half;

      if (caught) {
        applyItemEffect(it.type);
        items.splice(i, 1);
        continue;
      }

      if (it.y - half > H) {
        items.splice(i, 1); // キャッチできず画面外へ落下、何も起きない
      }
    }
  }

  function applyItemEffect(type) {
    if (type === 'life') {
      if (life < MAX_LIFE) {
        life++;
        updatePanel();
      }
    } else if (type === 'paddle') {
      paddleExpandUntil = performance.now() + PADDLE_EXPAND_DURATION;
    } else if (type === 'multi') {
      spawnExtraBall();
    } else if (type === 'pierce') {
      pierceUntil = performance.now() + PIERCE_DURATION;
    }
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  /* ==================== イベント：ステージクリア/オーバー ==================== */
  const clearModal = document.getElementById('clearModal');
  const overModal = document.getElementById('overModal');
  const clearStageLabel = document.getElementById('clearStageLabel');
  const overScoreLabel = document.getElementById('overScoreLabel');

  function onStageClear() {
    running = false;
    clearStageLabel.textContent = `ステージ ${stageIndex + 1} を突破しました`;
    showModal(clearModal);
    showTapHint(false);
  }

  function onGameOver() {
    running = false;
    overScoreLabel.textContent = `スコア: ${score}`;
    showModal(overModal);
    showTapHint(false);
  }

  function showModal(el) { el.classList.remove('hidden'); }
  function hideModal(el) { el.classList.add('hidden'); }

  document.getElementById('nextStageBtn').addEventListener('click', goToNextStage);
  document.getElementById('retryBtn').addEventListener('click', retryStage);

  /* ==================== タップ案内 ==================== */
  const tapHint = document.getElementById('tapHint');
  function showTapHint(show) {
    tapHint.classList.toggle('hidden', !show);
  }

  /* ==================== パドル操作 ==================== */
  function pointerXToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!clearModal.classList.contains('hidden') || !overModal.classList.contains('hidden')) return;
    if (!panel.classList.contains('hidden')) return;
    dragging = true;
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const x = pointerXToCanvas(e);
    paddle.x = clampPaddleX(x);
    if (!running) {
      resetBall();      // タップした位置にパドルが移動した直後、ボールをその中心に揃える
      launchBall();      // その状態から発射
      running = true;
      showTapHint(false);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== activePointerId) return;
    const x = pointerXToCanvas(e);
    paddle.x = clampPaddleX(x);
  });

  function endDrag(e) {
    if (e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function clampPaddleX(x) {
    return Math.min(Math.max(x, paddle.w / 2), W - paddle.w / 2);
  }

  /* ==================== 情報パネル ==================== */
  const menuBtn = document.getElementById('menuBtn');
  const panel = document.getElementById('panel');
  const panelOverlay = document.getElementById('panelOverlay');
  const panelStage = document.getElementById('panelStage');
  const panelScore = document.getElementById('panelScore');
  const panelLife = document.getElementById('panelLife');
  const panelCloseBtn = document.getElementById('panelCloseBtn');
  const resetStageBtn = document.getElementById('resetStageBtn');
  const resetImagesBtn = document.getElementById('resetImagesBtn');
  const imageInput = document.getElementById('imageInput');
  const stageImageList = document.getElementById('stageImageList');
  const resetMatImagesBtn = document.getElementById('resetMatImagesBtn');
  const matImageInput = document.getElementById('matImageInput');
  const matImageList = document.getElementById('matImageList');

  function updatePanel() {
    panelStage.textContent = String(stageIndex + 1);
    panelScore.textContent = String(score);
    panelLife.textContent = '●'.repeat(Math.max(0, life)) + '○'.repeat(Math.max(0, MAX_LIFE - life));
  }

  function openPanel() {
    updatePanel();
    renderStageImageList();
    renderMatImageList();
    panel.classList.remove('hidden');
    panelOverlay.classList.remove('hidden');
    running = false;
  }
  function closePanel() {
    panel.classList.add('hidden');
    panelOverlay.classList.add('hidden');
  }

  menuBtn.addEventListener('click', openPanel);
  panelCloseBtn.addEventListener('click', closePanel);
  panelOverlay.addEventListener('click', closePanel);

  resetStageBtn.addEventListener('click', () => {
    const ok = window.confirm('ステージ進行を1面目にリセットします（設定した画像はそのまま残ります）。よろしいですか？');
    if (!ok) return;
    resetStageProgress();
    closePanel();
    resetStage(true);
  });

  resetImagesBtn.addEventListener('click', () => {
    const ok = window.confirm('設定した画像をすべて削除します（ステージ進行はそのまま残ります）。よろしいですか？');
    if (!ok) return;
    resetAllImages();
    ensureStageImageLoaded(stageIndex);
    renderStageImageList();
  });

  resetMatImagesBtn.addEventListener('click', () => {
    const ok = window.confirm('設定した周辺装飾（マット）画像をすべて削除します（ステージ進行はそのまま残ります）。よろしいですか？');
    if (!ok) return;
    resetAllMatImages();
    ensureMatImageLoaded(stageIndex);
    renderMatImageList();
  });

  /* ==================== 画像差し替え(全ステージ分) ==================== */
  let uploadTargetStage = 0;

  function renderStageImageList() {
    stageImageList.innerHTML = '';
    STAGES.forEach((_, idx) => {
      const key = stageKey(idx);
      const row = document.createElement('div');
      row.className = 'stage-image-row';

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (images[key]) {
        thumb.style.backgroundImage = `url("${images[key]}")`;
      } else {
        const [c1, c2] = PLACEHOLDER_COLORS[idx % PLACEHOLDER_COLORS.length];
        thumb.style.backgroundImage = `linear-gradient(135deg, ${c1}, ${c2})`;
      }

      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.innerHTML = `ステージ ${idx + 1}<span class="thumb-sub">${images[key] ? '画像設定済み' : '未設定（プレースホルダー表示）'}</span>`;

      const btn = document.createElement('button');
      btn.className = 'change-btn';
      btn.type = 'button';
      btn.textContent = '変更';
      btn.addEventListener('click', () => {
        uploadTargetStage = idx;
        imageInput.click();
      });

      row.appendChild(thumb);
      row.appendChild(label);
      row.appendChild(btn);
      stageImageList.appendChild(row);
    });
  }

  imageInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const targetIdx = uploadTargetStage;

    const reader = new FileReader();
    reader.onload = () => {
      const rawImg = new Image();
      rawImg.onload = () => {
        const dataUrl = compressImage(rawImg, 800, 0.8);
        const key = stageKey(targetIdx);
        images[key] = dataUrl;
        saveGame();

        const finalImg = new Image();
        finalImg.onload = () => { loadedImages[key] = finalImg; };
        finalImg.src = dataUrl;

        renderStageImageList();
      };
      rawImg.src = reader.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
  });

  /* ==================== 周辺装飾（マット）画像差し替え(全ステージ分) ==================== */
  let uploadTargetMatStage = 0;

  function renderMatImageList() {
    matImageList.innerHTML = '';
    STAGES.forEach((_, idx) => {
      const key = matKey(idx);
      const row = document.createElement('div');
      row.className = 'stage-image-row';

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (matImages[key]) {
        thumb.style.backgroundImage = `url("${matImages[key]}")`;
      } else {
        thumb.style.backgroundImage = 'none';
        thumb.style.backgroundColor = 'rgba(255,255,255,0.08)';
      }

      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.innerHTML = `ステージ ${idx + 1}<span class="thumb-sub">${matImages[key] ? '画像設定済み' : '未設定（単色表示）'}</span>`;

      const btn = document.createElement('button');
      btn.className = 'change-btn';
      btn.type = 'button';
      btn.textContent = '変更';
      btn.addEventListener('click', () => {
        uploadTargetMatStage = idx;
        matImageInput.click();
      });

      row.appendChild(thumb);
      row.appendChild(label);
      row.appendChild(btn);
      matImageList.appendChild(row);
    });
  }

  matImageInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const targetIdx = uploadTargetMatStage;

    const reader = new FileReader();
    reader.onload = () => {
      const rawImg = new Image();
      rawImg.onload = () => {
        const dataUrl = compressImage(rawImg, 900, 0.8);
        const key = matKey(targetIdx);
        matImages[key] = dataUrl;
        saveGame();

        const finalImg = new Image();
        finalImg.onload = () => { loadedMatImages[key] = finalImg; };
        finalImg.src = dataUrl;

        renderMatImageList();
      };
      rawImg.src = reader.result;
    };
    reader.readAsDataURL(file);
    matImageInput.value = '';
  });

  function compressImage(img, maxDim, quality) {
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, w, h);
    return off.toDataURL('image/jpeg', quality);
  }

  /* ==================== 初期化 ==================== */
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 50));

  function init() {
    loadGame();
    resize();
    ensureStageImageLoaded(stageIndex);
    ensureMatImageLoaded(stageIndex);
    resetStage(true);
    // safe-area等の反映が1フレーム遅れる端末があるため、次フレームで再計測して位置を確定させる
    requestAnimationFrame(() => {
      resize();
      resetStage(true);
      requestAnimationFrame(loop);
    });
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
