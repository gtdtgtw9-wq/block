'use strict';

/* ====================================================================
 * config.js ― 設定
 * 画像出現型ブロック崩し：定数・設定値の定義
 * 依存：なし（他ファイルより先に読み込むこと）
 * ==================================================================== */

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

