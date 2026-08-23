'use strict';

/* ====================================================================
 * state.js ― 状態、セーブデータ
 * 画像出現型ブロック崩し：DOM要素の取得・ゲーム状態変数・セーブ/ロード処理
 * 依存：config.js（定数を参照する箇所あり）
 * ==================================================================== */

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
  let ballShape = DEFAULT_BALL_SHAPE; // ボールの見た目（トランプスーツ4種から選択。localStorageに保存）
  let ballColor = DEFAULT_BALL_COLOR; // ボールの色（カラーピッカーで自由指定。localStorageに保存）

  let blocks = [];
  let blockAreaTop = 0, blockAreaLeft = 0, blockAreaWidth = 0, blockAreaHeight = 0;
  let totalBlocks = 0, brokenBlocks = 0;
  let currentPattern = null; // 現在のステージで選ばれているブロック配置パターン（(r,c,rows,cols)=>bool）。nullなら全面配置

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
      if (typeof data.ballShape === 'string' && BALL_SHAPES.includes(data.ballShape)) {
        ballShape = data.ballShape;
      }
      if (typeof data.ballColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.ballColor)) {
        ballColor = data.ballColor;
      }
    } catch (e) {
      console.warn('セーブデータの読み込みに失敗しました', e);
    }
  }

  function saveGame() {
    try {
      const data = { currentStage: stageIndex + 1, images, matImages, ballShape, ballColor };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('セーブデータの保存に失敗しました', e);
      return false;
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
