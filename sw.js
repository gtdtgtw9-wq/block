'use strict';

/* ====================================================================
 * sw.js ― Service Worker
 * 画像出現型ブロック崩し：PWA化（オフラインキャッシュ）対応
 *
 * キャッシュ更新の運用ルール：
 * ゲーム本体のファイル（index.html/style.css/config.js/state.js/game.js/ui.js/main.js等）を
 * 更新した際は、下記 CACHE_NAME のバージョン番号を必ずインクリメントすること。
 * これを忘れると、PWAとしてホーム画面に追加したユーザーの端末に古いキャッシュが
 * 残り続け、新しいコードが反映されない（activate時に古いキャッシュを破棄する仕組みのため、
 * バージョンを変えない限り新しいキャッシュが作られず更新が検知されない）。
 * ==================================================================== */

const CACHE_NAME = 'block-kuzushi-v1'; // 更新時は数字をインクリメントすること
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './state.js',
  './game.js',
  './ui.js',
  './main.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // 起動画面（splash/以下）はファイルサイズが大きく、オフライン起動の必須要件でもないため
  // 事前キャッシュ対象からは外している（初回表示時にfetchイベント側で通常通りキャッシュされる）
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); // 新しいService Workerをすぐに有効化する
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME) // 古いバージョンのキャッシュを破棄
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// キャッシュ優先（オフライン最優先）。キャッシュになければネットワーク取得し、
// 取得できたレスポンスは以後のオフライン利用のためにキャッシュへ追加保存する。
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
