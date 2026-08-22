'use strict';

/* ====================================================================
 * main.js ― 初期化
 * 画像出現型ブロック崩し：起動処理（最後に読み込むこと）
 * 依存：config.js, state.js, game.js, ui.js
 * ==================================================================== */

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
