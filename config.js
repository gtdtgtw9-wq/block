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

  // 強化ブロック（6〜10面、v0.27〜）：2回ボールを当てないと壊れないブロック
  const NORMAL_BLOCK_COLOR = 'rgba(244, 242, 236, 1)'; // 通常ブロックの色（強化ブロックが残り1回になった際もこの色に戻す）
  const REINFORCED_BLOCK_COLOR = '#f5c542'; // 強化ブロック（耐久2）の色（黄色）
  // 強化ブロックの出現率（ステージ配列インデックス基準）。6面(index5)〜10面(index9)で6%→10%へ1%刻みで上昇。
  // 1〜5面(index0〜4)は0%＝出現しない。10面クリア後は1面へループする仕様のため、
  // 6面に再突入した時点でこの配列を参照し直すだけで自動的に6%へ戻る（専用のリセット処理は不要）
  const REINFORCED_CHANCE_BY_STAGE = [0, 0, 0, 0, 0, 0.06, 0.07, 0.08, 0.09, 0.10];

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

  // ブロック配置パターン（Backlog「パターンのランダム化」対応）。
  // 各関数は (r, c, rows, cols) => true/false で、そのマス(行r・列c)にブロックを置くかどうかを返す。
  // rows/colsの数値自体は変えず、配置の欠けさせ方だけで見た目に特色を出す。
  //
  // 形状系パターン（diamond/hourglass/triangle）は、ブロックエリアの物理的な縦横比（IMAGE_ASPECT）を
  // 考慮して座標補正している。単純に行・列のインデックスだけで正規化すると、
  // ブロックエリアが縦長（列数が少なく行数が多い）なせいで形状が縦に潰れて見えてしまうため。
  const BLOCK_PATTERNS = {
    // 市松模様：1マスおきに配置
    checkerboard: (r, c) => (r + c) % 2 === 0,

    // ジグザグ：行ごとに配置する列の範囲を三角波状に左右へずらし、稲妻状のシルエットを作る
    zigzag: (r, c, rows, cols) => {
      const period = 16;
      const tri = period - Math.abs((r % period) - Math.floor(period / 2)) * 2;
      const offset = tri % cols;
      const width = Math.max(2, cols - 4);
      const start = offset % Math.max(1, cols - width + 1);
      return c >= start && c < start + width;
    },

    // 斜め階段：対角の帯（階段状）が繰り返し重なる形
    diagonalStaircase: (r, c) => {
      const stepRows = 2;   // 何行ごとに1段とするか
      const bandWidth = 2;  // 帯の太さ（列換算）
      const period = 6;     // 何列ぶんで1周期にするか
      const idx = Math.floor(r / stepRows) + c;
      return ((idx % period) + period) % period < bandWidth;
    },

    // 点在：縦・横ともに間引いた疎らな点状配置
    dotsSparse: (r, c) => r % 3 === 0 && c % 2 === 0,

    // 細い斜め線：1本の細い斜め線が繰り返し流れる
    thinDiagonal: (r, c) => {
      const idx = Math.floor(r / 2) + c;
      return (idx % 7) === 0;
    },

    // 外枠のみ：中央を空けた額縁状
    borderFrame: (r, c, rows, cols) => (r < 2 || r >= rows - 2 || c < 1 || c >= cols - 1),

    // 十字架：小さな十字架（縦棒が長め）がタイル状に繰り返し浮かぶ形
    manyCrosses: (r, c) => {
      const tileRows = 10, tileCols = 5; // タイルサイズ（十字架どうしの間隔）
      const centerRow = 4, centerCol = 2; // タイル内での十字架の中心位置
      const vArm = 3, hArm = 1; // 縦棒・横棒の長さ（縦棒を長めにして十字架らしくする）
      const lr = r % tileRows;
      const lc = c % tileCols;
      const vertical = (lc === centerCol) && Math.abs(lr - centerRow) <= vArm;
      const horizontal = (lr === centerRow) && Math.abs(lc - centerCol) <= hArm;
      return vertical || horizontal;
    },

    // シェブロン：V字模様が波状に縦へ積み重なる
    chevronStack: (r, c, rows, cols) => {
      const period = 12;    // 何行で1周期にするか
      const thickness = 2;  // 線の太さ
      const freq = 1.0;     // V字の開き具合
      const lr = r % period;
      const fx = Math.abs(c - (cols - 1) / 2);
      const centerRow = Math.round(fx * freq) % period;
      return Math.abs(lr - centerRow) < thickness ||
             Math.abs(lr - centerRow - period) < thickness ||
             Math.abs(lr - centerRow + period) < thickness;
    },

    // 砂時計：上下端が太く中央でくびれる形（IMAGE_ASPECTで縦横比を補正）
    hourglass: (r, c, rows, cols) => {
      const fx = ((c + 0.5) / cols - 0.5) * IMAGE_ASPECT;
      const fy = (r + 0.5) / rows - 0.5;
      const halfWidth = Math.abs(fy) * 0.9;
      return Math.abs(fx) <= halfWidth;
    },

    // 三角形：上端が尖り下端が広がる山形（IMAGE_ASPECTで縦横比を補正）
    triangle: (r, c, rows, cols) => {
      const fx = ((c + 0.5) / cols - 0.5) * IMAGE_ASPECT;
      const fy = (r + 0.5) / rows - 0.5;
      const ny = fy + 0.5; // 0(上)〜1(下)
      const halfWidth = ny * 0.45;
      return Math.abs(fx) <= halfWidth;
    },

    // 縦縞：細い縦のストライプ
    verticalStripes: (r, c) => c % 3 === 0,

    // 横縞：太めの横のストライプ（隙間は細め）
    horizontalStripes: (r) => (r % 4) < 3,

    // レンガ調：横帯を1行ごとに互い違いにずらし、隙間をレンガの目地状にする
    brickOffset: (r, c) => {
      const offset = Math.floor(r / 2) % 2;
      return !((c + offset) % 4 === 0);
    },

    // 中抜き改めメッシュ状：びっしり埋めた中に、規則的な小さな穴を無数に開ける
    meshHoles: (r, c) => {
      const hole = (r % 4 === 1) && (c % 3 === 1);
      return !hole;
    },

    // 大きめ市松：2x2マス単位で市松模様にし、粒の大きいテクスチャにする
    bigChecker: (r, c) => (Math.floor(r / 2) + Math.floor(c / 2)) % 2 === 0,
  };

  // ステージごとに使用するパターン候補。ステージ開始のたびにこの中からランダムに1つ選ぶ。
  // 未定義のステージは従来通り全面配置（フォールバック）。
  // 15パターンを充填率（ブロック密度）の低い順に3つずつ、ステージ1〜5へ割り振っている。
  // ステージ6〜10は、それぞれステージ1〜5と同じパターン配列をそのまま再利用する
  // （ステージ6＝ステージ1のパターン、ステージ7＝ステージ2のパターン…という対応）。
  // 各パターン関数はrows/colsを引数に取る汎用実装のため、ステージ6〜10自体の行×列サイズに
  // 合わせて自動的に配置が計算される（配列を複製しているだけで、パターン定義自体は1つ）
  // （diamond/crossPlus/hollowCenterは図柄がシンプルすぎるとの指摘によりchevronStack/manyCrosses/meshHolesへ差し替え）
  const STAGE_PATTERNS = {
    0: [BLOCK_PATTERNS.thinDiagonal, BLOCK_PATTERNS.dotsSparse, BLOCK_PATTERNS.chevronStack],       // ステージ1（充填率 約14〜28%）
    1: [BLOCK_PATTERNS.borderFrame, BLOCK_PATTERNS.diagonalStaircase, BLOCK_PATTERNS.verticalStripes], // ステージ2（約32〜38%）
    2: [BLOCK_PATTERNS.checkerboard, BLOCK_PATTERNS.zigzag, BLOCK_PATTERNS.bigChecker],             // ステージ3（約50%）
    3: [BLOCK_PATTERNS.manyCrosses, BLOCK_PATTERNS.hourglass, BLOCK_PATTERNS.triangle],             // ステージ4（約20〜67%）
    4: [BLOCK_PATTERNS.brickOffset, BLOCK_PATTERNS.horizontalStripes, BLOCK_PATTERNS.meshHoles],    // ステージ5（約75〜93%）
  };
  // ステージ6〜10 = ステージ1〜5と同じパターン配列を再利用
  STAGE_PATTERNS[5] = STAGE_PATTERNS[0]; // ステージ6 ＝ ステージ1と同じ
  STAGE_PATTERNS[6] = STAGE_PATTERNS[1]; // ステージ7 ＝ ステージ2と同じ
  STAGE_PATTERNS[7] = STAGE_PATTERNS[2]; // ステージ8 ＝ ステージ3と同じ
  STAGE_PATTERNS[8] = STAGE_PATTERNS[3]; // ステージ9 ＝ ステージ4と同じ
  STAGE_PATTERNS[9] = STAGE_PATTERNS[4]; // ステージ10 ＝ ステージ5と同じ


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
