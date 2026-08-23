'use strict';

/* ====================================================================
 * ui.js ― 情報パネル、画像差し替え、周辺装飾（マット）画像差し替え
 * 画像出現型ブロック崩し：情報パネルUI・画像アップロード関連の処理一式
 * 依存：config.js, state.js, game.js
 * ==================================================================== */

  /* ==================== 情報パネル ==================== */
  const menuBtn = document.getElementById('menuBtn');
  const panel = document.getElementById('panel');
  const panelOverlay = document.getElementById('panelOverlay');
  const panelStage = document.getElementById('panelStage');
  const panelScore = document.getElementById('panelScore');
  const panelLife = document.getElementById('panelLife');
  const panelCloseBtn = document.getElementById('panelCloseBtn');
  const resetStageBtn = document.getElementById('resetStageBtn');
  const resetToggleBtn = document.getElementById('resetToggleBtn');
  const resetExtra = document.getElementById('resetExtra');
  const resetImagesBtn = document.getElementById('resetImagesBtn');
  const imageInput = document.getElementById('imageInput');
  const stageImageList = document.getElementById('stageImageList');
  const resetMatImagesBtn = document.getElementById('resetMatImagesBtn');
  const matImageInput = document.getElementById('matImageInput');
  const matImageList = document.getElementById('matImageList');
  const ballShapeButtons = document.querySelectorAll('.ball-shape-btn');

  function updatePanel() {
    panelStage.textContent = String(stageIndex + 1);
    panelScore.textContent = String(score);
    panelLife.textContent = '●'.repeat(Math.max(0, life)) + '○'.repeat(Math.max(0, MAX_LIFE - life));
  }

  function collapseResetExtra() {
    resetExtra.classList.add('hidden');
    resetToggleBtn.setAttribute('aria-expanded', 'false');
  }

  /* ==================== ボールの見た目（トランプスーツ）選択 ==================== */
  function updateBallShapeButtons() {
    ballShapeButtons.forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.shape === ballShape);
    });
  }

  ballShapeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      ballShape = btn.dataset.shape;
      saveGame();
      updateBallShapeButtons();
    });
  });

  function openPanel() {
    updatePanel();
    renderStageImageList();
    renderMatImageList();
    updateBallShapeButtons();
    collapseResetExtra(); // パネルを開くたびに展開状態はリセットしておく
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

  /* ==================== リセットボタングループ（▼で画像系リセットを展開） ==================== */
  resetToggleBtn.addEventListener('click', () => {
    const expanded = resetToggleBtn.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      collapseResetExtra();
    } else {
      resetExtra.classList.remove('hidden');
      resetToggleBtn.setAttribute('aria-expanded', 'true');
    }
  });

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
    collapseResetExtra();
  });

  resetMatImagesBtn.addEventListener('click', () => {
    const ok = window.confirm('設定した周辺装飾（マット）画像をすべて削除します（ステージ進行はそのまま残ります）。よろしいですか？');
    if (!ok) return;
    resetAllMatImages();
    ensureMatImageLoaded(stageIndex);
    renderMatImageList();
    collapseResetExtra();
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
        const ok = saveGame();
        if (!ok) {
          alert('画像を保存できませんでした（端末の保存容量が上限に達している可能性があります）。使用していない画像を削除してから、もう一度お試しください。');
        }

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
        const ok = saveGame();
        if (!ok) {
          alert('画像を保存できませんでした（端末の保存容量が上限に達している可能性があります）。使用していない画像を削除してから、もう一度お試しください。');
        }

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
