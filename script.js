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
    } catch (e) {
      console.warn('セーブデータの読み込みに失敗しました', e);
    }
  }

  function saveGame() {
    try {
      const data = { currentStage: stageIndex + 1, images };
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

  function stageKey(idx) {
    return 'stage' + (idx + 1);
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

  function inGap(gaps, pos) {
    for (const g of gaps) {
      if (pos >= g.start && pos <= g.end) return true;
    }
    return false;
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
    paddle.x = W / 2;
    resetBall();
    running = false;
    showTapHint(true);
    updatePanel();
  }

  function createBall(x, y) {
    return { x, y, r: BALL_RADIUS, vx: 0, vy: 0, slow: false, outsideLeft: false, outsideRight: false, outsideTop: false };
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
  function drawImageCover(img, x, y, w, h, alpha) {
    if (!img || !img.naturalWidth) return;
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale, sh = h / scale;
    const sx = (img.naturalWidth - sw) / 2;
    const sy = (img.naturalHeight - sh) / 2;
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

  function drawVerticalBand(x, width, yStart, yEnd, gaps) {
    for (const s of complementSegments(yStart, yEnd, gaps)) {
      ctx.fillRect(x, s.start, width, s.end - s.start);
    }
  }

  function drawHorizontalBand(y, height, xStart, xEnd, gaps) {
    for (const s of complementSegments(xStart, xEnd, gaps)) {
      ctx.fillRect(s.start, y, s.end - s.start, height);
    }
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
    ctx.save();
    ctx.fillStyle = '#1b1e29';
    // 左右の帯はブロックエリアの高さ範囲のみ（穴の位置は塗らずに開ける）
    if (blockAreaLeft > 0) drawVerticalBand(0, blockAreaLeft, blockAreaTop, bottomY, leftGaps);
    if (rightX < W) drawVerticalBand(rightX, W - rightX, blockAreaTop, bottomY, rightGaps);
    // 上端の帯（画面上端からブロックエリア上端まで。穴の位置は塗らずに開ける）
    if (blockAreaTop > 0) drawHorizontalBand(0, blockAreaTop, blockAreaLeft, rightX, topGaps);

    // 反射境界線（内側の縁を強調。穴の位置は線を途切れさせる）
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
      outsideLeft: false,
      outsideRight: false,
      outsideTop: false,
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

      // 壁反射（反射壁：ブロックエリアの上端・左右で反射。穴を通過した後は、
      // 実際の画面端に当たるまで内側の壁を再度押し付けない＝一度外に出たボールを引き戻さない）
      const rightX = blockAreaLeft + blockAreaWidth;
      const blockAreaBottom = blockAreaTop + blockAreaHeight;
      const inBlockHeight = ball.y < blockAreaBottom;

      // 上壁
      if (!ball.outsideTop) {
        if (ball.y - ball.r < blockAreaTop) {
          if (inGap(topGaps, ball.x)) {
            ball.outsideTop = true; // 穴を通過。以後は画面端(y=0)でのみ止める
          } else {
            ball.y = blockAreaTop + ball.r;
            ball.vy *= -1;
          }
        }
      } else {
        if (ball.y - ball.r < 0) { ball.y = ball.r; ball.vy *= -1; }
        if (ball.y >= blockAreaTop) { ball.outsideTop = false; } // 自然に戻ってきたら内側状態へ復帰
      }

      // 左壁（ブロックエリアの高さ範囲内でのみ有効）
      if (inBlockHeight) {
        if (!ball.outsideLeft) {
          if (ball.x - ball.r < blockAreaLeft) {
            if (inGap(leftGaps, ball.y)) {
              ball.outsideLeft = true; // 穴を通過。以後は画面端(x=0)でのみ止める
            } else {
              ball.x = blockAreaLeft + ball.r;
              ball.vx *= -1;
            }
          }
        } else {
          if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -1; }
          if (ball.x >= blockAreaLeft) { ball.outsideLeft = false; } // 自然に戻ってきたら内側状態へ復帰
        }
      } else {
        // パドルゾーンでは壁は無効。ただし「外に出ていた」状態は実際のx座標に応じて維持する
        if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -1; }
        ball.outsideLeft = ball.x < blockAreaLeft;
      }

      // 右壁（左壁と対称のロジック）
      if (inBlockHeight) {
        if (!ball.outsideRight) {
          if (ball.x + ball.r > rightX) {
            if (inGap(rightGaps, ball.y)) {
              ball.outsideRight = true;
            } else {
              ball.x = rightX - ball.r;
              ball.vx *= -1;
            }
          }
        } else {
          if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx *= -1; }
          if (ball.x <= rightX) { ball.outsideRight = false; }
        }
      } else {
        // パドルゾーンでは壁は無効。ただし「外に出ていた」状態は実際のx座標に応じて維持する
        if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx *= -1; }
        ball.outsideRight = ball.x > rightX;
      }

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
        const angle = offset * (Math.PI / 3); // 最大60度
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

  function updatePanel() {
    panelStage.textContent = String(stageIndex + 1);
    panelScore.textContent = String(score);
    panelLife.textContent = '●'.repeat(Math.max(0, life)) + '○'.repeat(Math.max(0, MAX_LIFE - life));
  }

  function openPanel() {
    updatePanel();
    renderStageImageList();
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
