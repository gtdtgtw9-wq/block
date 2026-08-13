(() => {
  'use strict';

  /* ==================== 設定 ==================== */
  const STORAGE_KEY = 'blockKuzushiSave_v1';
  const CLEAR_RATIO = 0.95;     // ステージクリアに必要なブロック破壊率
  const MAX_LIFE = 3;
  const BALL_SPEED = 4.6;
  const SCORE_PER_BLOCK = 10;
  const IMAGE_ASPECT = 768 / 1280; // 差し込み画像の縦横比（幅/高さ）
  const MIN_PLAY_GAP = 140; // ブロックエリア下端からパドルまでの最低プレイスペース(px)

  // ステージごとのブロック配置（行×列）。必要に応じて増やせる。
  const STAGES = [
    { rows: 14, cols: 8 },
    { rows: 16, cols: 8 },
    { rows: 16, cols: 9 },
    { rows: 18, cols: 9 },
    { rows: 20, cols: 10 },
  ];

  // カスタム画像が未設定のステージ用プレースホルダー配色
  const PLACEHOLDER_COLORS = [
    ['#3a3f5c', '#6a4c93'],
    ['#2f5d62', '#4c9a8e'],
    ['#5c3a3a', '#a45c5c'],
    ['#3a4a5c', '#5c86a4'],
    ['#4a3a5c', '#8a5ca4'],
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

  let paddle = { x: 0, y: 0, w: 90, h: 14 };
  let ball = { x: 0, y: 0, r: 7, vx: 0, vy: 0 };

  let life = MAX_LIFE;
  let score = 0;

  let running = false;         // ボールが動いているか
  let dragging = false;
  let activePointerId = null;
  let stageClearedOverride = false; // クリア演出中、画像を全開示するフラグ

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
    let areaWidth = W;
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
    const pad = 1.5;
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
  function resetStage(fullReset) {
    layoutBlocks();
    if (fullReset) { life = MAX_LIFE; score = 0; }
    stageClearedOverride = false;
    ensureStageImageLoaded(stageIndex);
    paddle.x = W / 2;
    resetBall();
    running = false;
    showTapHint(true);
    updatePanel();
  }

  function resetBall() {
    ball.x = paddle.x;
    ball.y = paddle.y - paddle.h / 2 - ball.r - 0.5;
    ball.vx = 0;
    ball.vy = 0;
  }

  function launchBall() {
    const dir = Math.random() < 0.5 ? -1 : 1;
    ball.vx = BALL_SPEED * 0.4 * dir;
    ball.vy = -BALL_SPEED * 0.9;
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

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0e14';
    ctx.fillRect(0, 0, W, H);

    const ratio = stageClearedOverride ? 1 : (totalBlocks ? brokenBlocks / totalBlocks : 0);
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
      ctx.fillStyle = 'rgba(244, 242, 236, 0.92)';
      ctx.strokeStyle = 'rgba(12, 14, 20, 0.5)';
      ctx.lineWidth = 1;
      roundRect(b.x, b.y, b.w, b.h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
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
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
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
  function update() {
    if (!running) return;

    ball.x += ball.vx;
    ball.y += ball.vy;

    // 壁反射
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
      const speed = Math.hypot(ball.vx, ball.vy);
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
        ball.vy *= -1;
        updatePanel();

        if (brokenBlocks / totalBlocks >= CLEAR_RATIO) {
          onStageClear();
        }
        break;
      }
    }

    // 落下判定
    if (ball.y - ball.r > H) {
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
    stageClearedOverride = true;
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

  loadGame();
  resize();
  ensureStageImageLoaded(stageIndex);
  resetStage(true);
  requestAnimationFrame(loop);
})();
