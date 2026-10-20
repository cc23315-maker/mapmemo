// ==========================================
// 共通ユーティリティ
// ==========================================
const APP_VERSION = '1.1.0';

// ユーザー入力や外部データを innerHTML に入れる前に必ず通す（XSS・表示崩れ対策）
const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

// localStorage は無効な環境（プライベートモード等）でも例外で止まらないようにする
function lsGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動作に影響なし */ }
}

// カテゴリの色（ピン・グラフ共通）。色はカテゴリごとに保存し、カテゴリ管理で変更できる
const PIN_PALETTE = ['#d93025', '#f29900', '#188038', '#1a73e8', '#9334e6', '#e8710a', '#129eaf', '#b31412'];
const UNCATEGORIZED_COLOR = '#5f6368';
let categoryColors = new Map(); // カテゴリ名 → 色

function safeColor(c) { return /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : ''; }
function categoryColorOf(cat) { return safeColor(cat.color) || PIN_PALETTE[(cat.id - 1 + PIN_PALETTE.length) % PIN_PALETTE.length]; }
function categoryColor(name) { return categoryColors.get(name) || UNCATEGORIZED_COLOR; }
// カテゴリ名の先頭が絵文字なら、ピンの中に表示する（例: 「🍴 食事・カフェ」→ 🍴）
function categoryGlyph(name) {
    const m = String(name || '').match(/^\p{Extended_Pictographic}️?/u);
    return m ? m[0] : '';
}
async function refreshCategoryColors() {
    const cats = await db.categories.toArray();
    categoryColors = new Map(cats.map((c) => [c.name, categoryColorOf(c)]));
}

// 日付（<input type="date"> との変換）。メモの「日付」は、手動で変えた日 → 最初に保存した日 → 更新日 の順で使う
function pad2(n) { return String(n).padStart(2, '0'); }
function dateToInput(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
// 'YYYY-MM-DD' → その日の正午（時差で日付がずれにくい）のミリ秒。不正な入力は null
function inputToNoon(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function memoDate(m) { return new Date(m.visitedAt || m.createdAt || m.timestamp || 0); }
const fmtDate = (d) => d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
const DAY_MS = 86400000;

function clampRating(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}
function starsText(n) { n = clampRating(n); return '★'.repeat(n) + '☆'.repeat(5 - n); }

// ==========================================
// 通知（トースト）。alert() の代わりに使う。操作ボタン（元に戻す等）つき
// ==========================================
// 画面の読み上げ（aria-live）にも対応。type: 'info' | 'ok' | 'error' | 'warn'
function toast(message, opts = {}) {
    const area = $('toast-area');
    if (!area) { console.log('[toast]', message); return { dismiss() {} }; }
    const { type = 'info', action = null, duration = 4500 } = opts;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    el.appendChild(text);

    let timer = null;
    const dismiss = () => {
        clearTimeout(timer);
        if (el.parentNode) el.parentNode.removeChild(el);
    };
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => { dismiss(); action.onClick(); });
        el.appendChild(btn);
    }
    if (opts.closable || duration === 0) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'toast-close';
        x.setAttribute('aria-label', '通知を閉じる');
        x.textContent = '✕';
        x.addEventListener('click', dismiss);
        el.appendChild(x);
    }
    area.appendChild(el);
    while (area.children.length > 4) area.removeChild(area.firstChild); // たまりすぎない
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return { dismiss, el };
}

// ==========================================
// モーダル（カテゴリ管理・設定）。Esc で閉じる／Tab が外へ出ない／閉じたら元の場所へフォーカスを戻す
// ==========================================
const modalState = { current: null, returnFocus: null, onClose: null };

function openModal(el, onClose) {
    if (modalState.current) closeModal();
    modalState.current = el;
    modalState.onClose = onClose || null;
    modalState.returnFocus = document.activeElement;
    $('modal-overlay').hidden = false;
    el.hidden = false;
    const first = el.querySelector('input, select, button, [tabindex]');
    if (first) first.focus();
}
function closeModal() {
    const el = modalState.current;
    if (!el) return;
    el.hidden = true;
    $('modal-overlay').hidden = true;
    const cb = modalState.onClose, back = modalState.returnFocus;
    modalState.current = null; modalState.onClose = null; modalState.returnFocus = null;
    if (back && back.focus) back.focus();
    if (cb) cb();
}
document.addEventListener('keydown', (e) => {
    const el = modalState.current;
    if (!el) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') {
        const items = [...el.querySelectorAll('input:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], textarea:not([disabled])')]
            .filter((x) => x.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
});

// ==========================================
// テーマ（ライト / ダーク / 端末に合わせる）
// ==========================================
const THEME_KEY = 'mapMemo.theme';
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let themeSetting = ['auto', 'light', 'dark'].includes(lsGet(THEME_KEY)) ? lsGet(THEME_KEY) : 'auto';

function isDarkTheme() {
    return themeSetting === 'dark' || (themeSetting === 'auto' && !!(darkQuery && darkQuery.matches));
}
function applyTheme() {
    const root = document.documentElement;
    if (themeSetting === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', themeSetting);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDarkTheme() ? '#202124' : '#1a73e8');
    if (window.__mapReady) updateTileDarkClass(); // 地図の作成前は呼ばない
}
function setTheme(value) {
    themeSetting = ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
    lsSet(THEME_KEY, themeSetting);
    applyTheme();
}
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
applyTheme();

// ==========================================
// 容量不足などの保存エラー
// ==========================================
function isQuotaError(e) {
    if (!e) return false;
    const names = [e.name, e.inner && e.inner.name].filter(Boolean);
    return names.includes('QuotaExceededError') || /quota|storage.*full|disk.*full/i.test(String(e.message || ''));
}
// 保存・削除などの失敗をわかりやすく利用者へ伝える
function reportDbError(e, what) {
    console.error(`${what}に失敗:`, e);
    if (isQuotaError(e)) {
        toast('端末の保存容量が足りないため保存できませんでした。保存した地図データを削除すると空きができます。', {
            type: 'error', duration: 10000,
            action: { label: '設定を開く', onClick: () => openSettings() }
        });
    } else {
        toast(`${what}に失敗しました（${e && e.message ? e.message : '原因不明'}）`, { type: 'error', duration: 8000 });
    }
}

// ==========================================
// 0. サービスワーカー（オフライン動作・更新のお知らせ）& ストレージの永続化
// ==========================================
let swReg = null;
const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
let reloadingForUpdate = false;

function promptUpdate(worker) {
    toast('新しいバージョンがあります。', {
        duration: 0,
        action: { label: '更新する', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) }
    });
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
            swReg = reg;
            console.log('サービスワーカーの登録に成功しました', reg.scope);
            // 前回から待機中の新バージョンがある
            if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
                });
            });
            // 長く開いたままでも更新に気づけるよう、定期的・再表示時に確認する
            setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') reg.update().catch(() => {});
            });
        }).catch((err) => console.error('サービスワーカーの登録に失敗しました', err));
    });
    // 新しい版が有効になったら読み込み直す（初回インストール時は不要なので除く）
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloadingForUpdate) return;
        reloadingForUpdate = true;
        location.reload();
    });
}
// 端末の容量不足時に IndexedDB（メモ・写真・地図タイル）が自動削除されにくくする
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
}

// ---- アプリのインストール案内 ----
let installPrompt = null;
function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // 自動表示は抑え、設定画面のボタンから出す
    installPrompt = e;
    if (typeof refreshInstallUi === 'function') refreshInstallUi();
});
window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('ホーム画面に追加しました。', { type: 'ok' });
    if (typeof refreshInstallUi === 'function') refreshInstallUi();
});

// ==========================================
// 1. データベース（IndexedDB）
// ==========================================
// 検索に使う項目だけをインデックスにする。写真(Blob)・コメント・お気に入り・評価・日付は索引不要
// （項目を足すだけならバージョン番号を上げる必要はない）
const db = new Dexie('MapMemoDatabase');
db.version(5).stores({
    memos: '++id, category, timestamp',
    categories: '++id, &name',
    tiles: 'key, timestamp'
});

db.on('ready', () => {
    return db.categories.count().then((count) => {
        if (count === 0) {
            return db.categories.bulkAdd([
                { name: '⭐ お気に入り', color: '#f29900' },
                { name: '🍴 食事・カフェ', color: '#d93025' },
                { name: '📸 観光・景色', color: '#188038' },
                { name: '📍 その他', color: '#9334e6' }
            ]);
        }
    });
});

let tempMarker = null;        // 新規メモ用の仮ピン
let activeMarkers = [];       // 保存済みメモのピン
let currentFormMarker = null; // いまフォームを開いているピン
let moveState = null;         // ピンの位置を直しているとき: { marker, id, from, toast }

let userLatLng = null;        // 現在地（取得できるまで null）
let userMarker = null;        // 現在地の青い点
let openPopupRef = null;      // いま開いているポップアップ（距離の更新用）
let visibleMemos = [];        // いま地図に出しているメモ（絞り込み後）
let listSort = 'distance';    // 一覧の並び順: 'distance' | 'recent' | 'rating'
let listReverse = false;      // 並びの向きを、その並び順の標準から逆にするか（昇順 ⇄ 降順の切り替え）
let memoIndex = null;         // 検索用の軽量インデックス（写真を含まない）
let searchMarker = null;      // 場所検索の結果ピン
const memoById = new Map();   // id → メモ（ポップアップの表示用）

// ==========================================
// 1b. 写真（Blob 保存・サムネイル）
// ==========================================
// 以前は写真を文字列（dataURL）で保存していた。Blob で保存すると容量が約25%減り、読み込みも軽くなる。
// 一覧用に小さなサムネイルも別に持つ。
const PHOTO_MAX = 1280, PHOTO_QUALITY = 0.75, THUMB_MAX = 160, THUMB_QUALITY = 0.7;

function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality);
    });
}
// 画像（File / Blob）を読み込み、最大辺 max に収めた JPEG の Blob を返す
function resizeToBlob(source, max, quality) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(source);
        const img = new Image();
        img.onload = async () => {
            URL.revokeObjectURL(url);
            try {
                const scale = Math.min(1, max / img.width, max / img.height);
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(await canvasToBlob(canvas, quality));
            } catch (e) { reject(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
        img.src = url;
    });
}
async function makePhotoBlobs(file) {
    const photoBlob = await resizeToBlob(file, PHOTO_MAX, PHOTO_QUALITY);
    const thumbBlob = await resizeToBlob(photoBlob, THUMB_MAX, THUMB_QUALITY);
    return { photoBlob, thumbBlob };
}

function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) throw new Error('写真データの形式が不正です');
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('写真を読み込めませんでした'));
        r.readAsDataURL(blob);
    });
}

// Blob → 表示用 URL。同じ Blob には同じ URL を返し、メモを読み直すときにまとめて解放する
const blobUrls = new Map(); // key → url
function photoUrl(memo, kind) {
    const blob = kind === 'thumb' ? (memo.thumbBlob || memo.photoBlob) : memo.photoBlob;
    if (blob) {
        const key = `${memo.id}:${kind}`;
        let url = blobUrls.get(key);
        if (!url) { url = URL.createObjectURL(blob); blobUrls.set(key, url); }
        return url;
    }
    return memo.photo || ''; // 変換前の古いデータ（dataURL）
}
function hasPhoto(memo) { return !!(memo.photoBlob || memo.thumbBlob || memo.photo); }
function releasePhotoUrls() {
    blobUrls.forEach((u) => URL.revokeObjectURL(u));
    blobUrls.clear();
}

// 旧形式（dataURL）の写真を Blob に変換する。キャンバス処理は IndexedDB の更新処理の中では
// 行えないため、起動後にバックグラウンドで 1 件ずつ実行する。失敗したメモは旧形式のまま残す（表示は可能）。
async function migrateLegacyPhotos() {
    let converted = 0;
    const legacy = await db.memos.filter((m) => !!m.photo && !m.photoBlob).primaryKeys();
    for (const id of legacy) {
        try {
            const memo = await db.memos.get(id);
            if (!memo || !memo.photo || memo.photoBlob) continue;
            const original = dataUrlToBlob(memo.photo);
            const photoBlob = original;
            const thumbBlob = await resizeToBlob(original, THUMB_MAX, THUMB_QUALITY);
            const next = { ...memo, photoBlob, thumbBlob };
            delete next.photo;
            await db.memos.put(next);
            converted++;
        } catch (e) {
            console.warn('写真の変換をスキップ:', id, e);
        }
    }
    return converted;
}

// ==========================================
// 2. 地図 & オフライン対応タイルレイヤー（地図の種類を切り替え可能）
// ==========================================
// 地図の種類。国土地理院タイルは出典の表示が必要（attribution に記載）。
// tileKey: IndexedDB に保存するときのキー。OSM だけは旧バージョンとの互換のため接頭辞なし。
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a>';
const BASE_LAYERS = {
    osm: {
        label: '標準（OpenStreetMap）', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        minZoom: 3, maxNative: 19, downloadMax: 18, photo: false,
        attribution: '© OpenStreetMap contributors'
    },
    'gsi-pale': {
        label: '淡色地図（国土地理院）', url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
        minZoom: 3, maxNative: 18, downloadMax: 18, photo: false,
        attribution: GSI_ATTR + '（淡色地図）'
    },
    'gsi-photo': {
        label: '航空写真（国土地理院）', url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
        minZoom: 14, maxNative: 18, downloadMax: 18, photo: true,
        attribution: GSI_ATTR + '（シームレス空中写真）'
    }
};
const LAYER_KEY = 'mapMemo.baseLayer';

function tileKeyFor(layerId, z, x, y) {
    return layerId === 'osm' ? `${z}-${x}-${y}` : `${layerId}:${z}-${x}-${y}`;
}
function tileUrlFor(layerId, z, x, y) {
    return BASE_LAYERS[layerId].url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

const map = L.map('map', { minZoom: 3, maxZoom: 19 }).setView([35.6812, 139.7671], 13);
window.__mapReady = true;
const poiLayerGroup = L.layerGroup().addTo(map);
// 保存したメモのピン。ピンが多いときは数字つきの丸にまとめる（ライブラリを読み込めないときは通常表示）
const memoLayer = (L.markerClusterGroup
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 18 })
    : L.layerGroup()
).addTo(map);

// アニメーション低減の設定（OS の「視差効果を減らす」）に従う
function flyTo(latlng, zoom) {
    if (reduceMotionQuery && reduceMotionQuery.matches) map.setView(latlng, zoom, { animate: false });
    else map.flyTo(latlng, zoom, { animate: true, duration: 0.8 });
}

const OfflineTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
        const tile = document.createElement('img');
        tile.alt = '';
        tile.setAttribute('role', 'presentation');
        const layerId = this.options.layerId;
        const tileKey = tileKeyFor(layerId, coords.z, coords.x, coords.y);
        const onlineUrl = this.getTileUrl(coords);

        // Blob を画像として表示。読み込み完了後に URL を解放してメモリリークを防ぐ
        const showBlob = (blob) => {
            const objectUrl = URL.createObjectURL(blob);
            tile.onload = () => { URL.revokeObjectURL(objectUrl); done(null, tile); };
            tile.onerror = () => { URL.revokeObjectURL(objectUrl); done(new Error('タイル画像の表示に失敗'), tile); };
            tile.src = objectUrl;
        };
        // 取得（fetch）できないサーバーでも画像としては表示できることがあるため、保存せず直接表示する
        const showDirect = () => {
            tile.onload = () => done(null, tile);
            tile.onerror = () => done(new Error('タイル画像の取得に失敗'), tile);
            tile.src = onlineUrl;
        };

        db.tiles.get(tileKey)
            .then((cached) => {
                if (cached && cached.blob) {
                    showBlob(cached.blob);
                    return;
                }
                // navigator.onLine は不安定なので判定に使わず、実際に取得を試す
                return fetch(onlineUrl)
                    .then((res) => {
                        if (!res.ok) throw new Error('ネットワークエラー');
                        return res.blob();
                    })
                    .then((blob) => {
                        db.tiles.put({ key: tileKey, blob, timestamp: Date.now() }).catch(() => {});
                        showBlob(blob);
                    })
                    .catch(showDirect);
            })
            .catch(showDirect);

        return tile;
    }
});

let baseLayer = null;
let baseLayerId = 'osm';

function updateTileDarkClass() {
    // ダークモードでは地図の色を反転して目に優しくする（航空写真はそのまま）
    const dark = isDarkTheme() && !(BASE_LAYERS[baseLayerId] && BASE_LAYERS[baseLayerId].photo);
    map.getContainer().classList.toggle('dark-tiles', dark);
}

function setBaseLayer(id, { announce = false } = {}) {
    if (!BASE_LAYERS[id]) id = 'osm';
    const def = BASE_LAYERS[id];
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayerId = id;
    // {s} サブドメインは廃止されているため使わない
    baseLayer = new OfflineTileLayer(def.url, {
        layerId: id, attribution: def.attribution, minZoom: def.minZoom, maxZoom: 19, maxNativeZoom: def.maxNative
    }).addTo(map);
    if (baseLayer.bringToBack) baseLayer.bringToBack();
    lsSet(LAYER_KEY, id);
    updateTileDarkClass();
    if (announce && def.minZoom > map.getZoom()) {
        toast(`${def.label}はズーム${def.minZoom}以上で表示されます。地図を拡大してください。`, { type: 'warn', duration: 6000 });
    }
}
setBaseLayer(BASE_LAYERS[lsGet(LAYER_KEY)] ? lsGet(LAYER_KEY) : 'osm');

// ==========================================
// 3. 表示範囲の地図タイルを事前ダウンロード
// ==========================================
// ※ 地図サーバーは大量の一括ダウンロードを推奨していません。
//   研究・個人利用の範囲に収まるよう、枚数上限・同時接続2本・待機時間を設けています。
const TILE_LIMIT = 1500;
const DOWNLOAD_LABEL = '🗺️ 地図を保存';
let isDownloading = false;
let downloadBtnEl = null;

function planTileDownload(minZ, maxZ, limit) {
    const b = map.getBounds();
    const plan = [];
    let total = 0;
    for (let z = minZ; z <= maxZ; z++) {
        const nw = map.project(b.getNorthWest(), z).divideBy(256).floor();
        const se = map.project(b.getSouthEast(), z).divideBy(256).floor();
        const last = Math.pow(2, z) - 1;
        const x1 = Math.max(0, nw.x), x2 = Math.min(last, se.x);
        const y1 = Math.max(0, nw.y), y2 = Math.min(last, se.y);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        if (count <= 0) continue;
        if (total + count > limit) break;
        plan.push({ z, x1, x2, y1, y2 });
        total += count;
    }
    return { plan, total };
}

async function downloadCurrentViewTiles() {
    if (isDownloading) return;
    if (!navigator.onLine) {
        toast('地図のダウンロードにはインターネット接続が必要です。', { type: 'warn' });
        return;
    }
    const layerId = baseLayerId;
    const def = BASE_LAYERS[layerId];

    const minZ = Math.max(def.minZoom, Math.floor(map.getZoom()) - 2);
    const { plan, total } = planTileDownload(minZ, def.downloadMax, TILE_LIMIT);
    if (plan.length === 0) {
        toast('表示範囲が広すぎます。地図を拡大してからもう一度お試しください。', { type: 'warn' });
        return;
    }
    const maxReached = plan[plan.length - 1].z;
    const mb = Math.max(1, Math.round(total * (def.photo ? 0.04 : 0.02))); // 1枚 約20KB（航空写真は約40KB）の目安
    if (!confirm(`「${def.label}」の表示範囲 ${total} 枚（ズーム ${plan[0].z}〜${maxReached}、約${mb}MB）を保存します。\nよろしいですか？`)) return;

    const queue = [];
    plan.forEach((p) => {
        for (let x = p.x1; x <= p.x2; x++) {
            for (let y = p.y1; y <= p.y2; y++) queue.push([p.z, x, y]);
        }
    });

    isDownloading = true;
    let done = 0, saved = 0, skipped = 0, failed = 0, quotaHit = false;
    const setLabel = (t) => { if (downloadBtnEl) downloadBtnEl.textContent = t; };

    const worker = async () => {
        while (queue.length > 0 && !quotaHit) {
            const [z, x, y] = queue.shift();
            const key = tileKeyFor(layerId, z, x, y);
            try {
                // 保存済みならスキップ（Blob を読み込まず件数だけ確認）
                if (await db.tiles.where('key').equals(key).count() > 0) {
                    skipped++;
                } else {
                    const res = await fetch(tileUrlFor(layerId, z, x, y));
                    if (res.ok) {
                        await db.tiles.put({ key, blob: await res.blob(), timestamp: Date.now() });
                        saved++;
                    } else {
                        failed++;
                    }
                    await sleep(100);
                }
            } catch (e) {
                if (isQuotaError(e)) quotaHit = true; else failed++;
            }
            done++;
            setLabel(`保存中 ${done}/${total}`);
        }
    };

    await Promise.all([worker(), worker()]); // 同時接続は2本まで
    isDownloading = false;
    setLabel(DOWNLOAD_LABEL);
    if (quotaHit) {
        reportDbError(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }), '地図の保存');
    } else if (failed > 0 && saved + skipped === 0) {
        toast('地図を保存できませんでした。この地図サーバーが保存に対応していない可能性があります（表示だけは可能です）。', { type: 'error', duration: 9000 });
    } else {
        toast(`地図の保存が完了しました。新規 ${saved} 枚 / 保存済み ${skipped} 枚 / 失敗 ${failed} 枚`, { type: 'ok', duration: 7000 });
    }
}

// 地図上のボタンとステータス表示
const DownloadControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        const btn = L.DomUtil.create('button', 'map-ctrl-btn');
        btn.type = 'button';
        btn.textContent = DOWNLOAD_LABEL;
        btn.title = '表示している範囲の地図をオフライン用に保存';
        btn.setAttribute('aria-label', '表示している範囲の地図をオフライン用に保存');
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', downloadCurrentViewTiles);
        downloadBtnEl = btn;
        return btn;
    }
});
new DownloadControl().addTo(map);

let statusEl = null;
const StatusControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
        statusEl = L.DomUtil.create('div', 'map-status');
        statusEl.setAttribute('role', 'status');
        updateOnlineStatus();
        return statusEl;
    }
});
function updateOnlineStatus() {
    if (!statusEl) return;
    const online = navigator.onLine;
    statusEl.textContent = online ? '🟢 オンライン' : '🟠 オフライン（保存済みの地図とメモを表示中）';
    statusEl.classList.toggle('offline', !online);
}
new StatusControl().addTo(map);
window.addEventListener('online', () => { updateOnlineStatus(); schedulePOILoad(); });
window.addEventListener('offline', updateOnlineStatus);

// ==========================================
// 4. 起動時に現在地へ移動（ピンは追加しない）
// ==========================================
// 距離表示のため、現在地を継続的に追跡する（初回の取得時だけ地図を移動）
startWatchingPosition();

// ==========================================
// 5. 周辺施設（POI）表示 & 施設名検索
// ==========================================
let poiFetchTimer = null;
let poiAbort = null;
const isAutoPOIEnabled = true;
const poiMarkers = new Map(); // 取得済みPOI（重複表示と、ポップアップが消える問題を防ぐ）

function clearPOI() {
    poiLayerGroup.clearLayers();
    poiMarkers.clear();
}

function buildPoiPopup(name, icon, lat, lng) {
    return `
        <div class="poi-popup">
            <strong>${icon} ${escapeHtml(name)}</strong>
            <div class="memo-distance"></div>
            <div class="poi-actions">
                <button type="button" class="add-poi-memo-btn" data-lat="${lat}" data-lng="${lng}">この場所にメモを作成</button>
                ${navLink(lat, lng)}
            </div>
        </div>`;
}

function poiIconFor(tags) {
    if (tags.amenity === 'public_bath' || tags.natural === 'hot_spring') return '♨️';
    if (tags.amenity === 'cafe') return '☕';
    if (tags.amenity === 'restaurant' || tags.amenity === 'fast_food') return '🍴';
    if (tags.shop === 'convenience' || tags.shop === 'supermarket') return '🏪';
    if (tags.tourism) return '📸';
    if (tags.railway === 'station') return '🚉';
    return '📍';
}

async function loadPOIOnMap() {
    if (!isAutoPOIEnabled || !navigator.onLine || map.getZoom() < 13) {
        clearPOI();
        return;
    }

    const b = map.getBounds();
    const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
    const query = `
        [out:json][timeout:15];
        (
          node["amenity"~"public_bath|cafe|restaurant|fast_food"](${bbox});
          node["natural"="hot_spring"](${bbox});
          node["shop"~"convenience|supermarket"](${bbox});
          node["tourism"~"attraction|hotel|museum"](${bbox});
        );
        out 50;`;
    const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

    if (poiAbort) poiAbort.abort(); // 古い検索は取り消す
    poiAbort = new AbortController();

    try {
        const res = await fetch(url, { signal: poiAbort.signal });
        if (!res.ok) return;
        const data = await res.json();
        const seen = new Set();

        (data.elements || []).forEach((item) => {
            const lat = item.lat, lon = item.lon;
            if (lat == null || lon == null) return;
            const id = `${item.type}/${item.id}`;
            seen.add(id);
            if (poiMarkers.has(id)) return;

            const tags = item.tags || {};
            const icon = poiIconFor(tags);
            const marker = L.marker([lat, lon], {
                title: tags.name || '周辺施設',
                icon: L.divIcon({ className: 'poi-icon', html: icon, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] })
            });
            marker.bindPopup(buildPoiPopup(tags.name || '周辺施設', icon, lat, lon));
            poiLayerGroup.addLayer(marker);
            poiMarkers.set(id, marker);
        });

        // 範囲外になったPOIを削除（ポップアップを開いているものは残す）
        for (const [id, marker] of poiMarkers) {
            if (!seen.has(id) && !marker.isPopupOpen()) {
                poiLayerGroup.removeLayer(marker);
                poiMarkers.delete(id);
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') console.warn('POIの取得に失敗:', e.message);
    }
}

function schedulePOILoad() {
    clearTimeout(poiFetchTimer);
    poiFetchTimer = setTimeout(loadPOIOnMap, 700);
}
map.on('moveend', schedulePOILoad); // ← 元のコードでは呼び出されていなかった
schedulePOILoad();

// ==========================================
// 6. メモの読み込み・フィルタリング
// ==========================================
let loadToken = 0;

function clearAllMarkers() {
    memoLayer.clearLayers();
    activeMarkers = [];
}

function loadSavedMemos() {
    const token = ++loadToken; // 連続呼び出しでピンが二重表示されるのを防ぐ
    memoIndex = null;          // メモが変わった可能性があるので検索インデックスを作り直す
    const filterEl = $('category-filter');
    const selected = filterEl ? filterEl.value : 'all';
    const favOnly = !!($('fav-only') && $('fav-only').checked);
    const query = selected === 'all'
        ? db.memos.toArray()
        : db.memos.where('category').equals(selected).toArray();

    return Promise.all([query, refreshCategoryColors()]).then(([memos]) => {
        if (token !== loadToken) return;
        if (favOnly) memos = memos.filter((m) => m.favorite);
        releasePhotoUrls();    // 前回までの写真用 URL をまとめて解放（メモリリーク防止）
        clearAllMarkers();
        memoById.clear();
        visibleMemos = memos;
        memos.forEach((m) => { memoById.set(m.id, m); addMemoMarker(m); });
        renderMemoList();
    }).catch((error) => {
        console.error('データの読み込みに失敗しました:', error);
        toast('保存したメモを読み込めませんでした。', { type: 'error' });
    });
}

// カテゴリの色のピン（絵文字があれば中に表示。お気に入りは右上に★）
function pinIcon(color, glyph, fav) {
    const inner = glyph ? '' : `<circle cx="16" cy="15" r="4.5" fill="${color}"/>`;
    return L.divIcon({
        className: 'memo-pin',
        html: `<div class="memo-pin-wrap"><svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
            <path d="M16 1C8 1 2 7 2 15c0 10 14 26 14 26s14-16 14-26C30 7 24 1 16 1z" fill="${color}" stroke="#fff" stroke-width="2"/>
            <circle cx="16" cy="15" r="9" fill="#fff"/>${inner}</svg>${glyph ? `<span class="pin-glyph">${glyph}</span>` : ''}${fav ? '<span class="pin-fav" aria-hidden="true">★</span>' : ''}</div>`,
        iconSize: [32, 42], iconAnchor: [16, 41], popupAnchor: [0, -36]
    });
}

// ポップアップが上部メニューや画面下のキーボードに隠れないよう、自動で地図をずらす余白を決める
const isNarrow = () => window.innerWidth <= 600;
function popupOptions(isForm) {
    const bar = $('top-bar');
    const top = bar ? Math.ceil(bar.getBoundingClientRect().bottom) + 8 : 60;
    return {
        minWidth: 220, maxWidth: Math.min(270, window.innerWidth - 60), keepInView: true,
        autoPanPaddingTopLeft: [10, top],
        // 入力フォームは、スマホのキーボードが出ても見える位置（画面の上半分）に寄せる
        autoPanPaddingBottomRight: [10, isForm && isNarrow() ? Math.round(window.innerHeight * 0.45) : 70]
    };
}

// 外部の地図アプリで道案内を開く（iPhone/iPad は「マップ」、それ以外は Google マップ）
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function navUrl(lat, lng) {
    const la = Number(lat), ln = Number(lng);
    return isIOS()
        ? `https://maps.apple.com/?daddr=${la},${ln}`
        : `https://www.google.com/maps/dir/?api=1&destination=${la},${ln}`;
}
function navLink(lat, lng) {
    return `<a class="nav-link" href="${navUrl(lat, lng)}" target="_blank" rel="noopener noreferrer" title="地図アプリで道案内を開く（通信が必要な場合があります）">🧭 道案内</a>`;
}

function memoPopupHtml(memo) {
    if (!memo) return '<div class="popup-loading">このメモは見つかりません。</div>';
    const badge = memo.category ? `<span class="memo-badge">${escapeHtml(memo.category)}</span>` : '';
    const src = hasPhoto(memo) ? photoUrl(memo, 'full') : '';
    const photo = src ? `<img class="memo-photo" src="${src}" alt="添付写真">` : '';
    const r = clampRating(memo.rating);
    const meta = [
        memo.favorite ? '<span class="fav-tag">⭐ お気に入り</span>' : '',
        r ? `<span class="rating" role="img" aria-label="評価 ${r}（5段階）">${starsText(r)}</span>` : '',
        `<span class="memo-date">${escapeHtml(fmtDate(memoDate(memo)))}</span>`
    ].filter(Boolean).join('');
    return `
        <div class="memo-popup">
            <div class="memo-head"><strong>保存されたメモ</strong>${badge}</div>
            <div class="memo-meta">${meta}</div>
            <div class="memo-distance"></div>
            <p class="memo-text">${escapeHtml(memo.comment)}</p>
            ${photo}
            <div class="memo-actions">
                <button type="button" class="edit-memo-btn" data-id="${memo.id}">編集</button>
                <button type="button" class="move-memo-btn" data-id="${memo.id}">位置を直す</button>
                ${navLink(memo.lat, memo.lng)}
                <button type="button" class="delete-memo-btn" data-id="${memo.id}">削除</button>
            </div>
        </div>`;
}

function addMemoMarker(memo) {
    const marker = L.marker([memo.lat, memo.lng], {
        icon: pinIcon(categoryColor(memo.category), categoryGlyph(memo.category), !!memo.favorite),
        title: `${memo.category ? memo.category + ' ' : ''}${String(memo.comment || '').slice(0, 30)}`,
        alt: 'メモのピン'
    });
    marker.databaseId = memo.id;
    // 開いた時点で最新の内容を作る（写真の URL を必要なときだけ作るため）
    marker.bindPopup(() => memoPopupHtml(memoById.get(memo.id)), popupOptions(false));
    memoLayer.addLayer(marker);
    activeMarkers.push(marker);
}

function updateFilterDropdown() {
    return db.categories.toArray().then((categories) => {
        const select = $('category-filter');
        if (!select) return;
        const current = select.value || 'all';
        select.innerHTML = '<option value="all">すべてのカテゴリ</option>';
        categories.forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat.name;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });
        select.value = [...select.options].some((o) => o.value === current) ? current : 'all';
    });
}

const categoryFilter = $('category-filter');
if (categoryFilter) categoryFilter.addEventListener('change', loadSavedMemos);
if ($('fav-only')) $('fav-only').addEventListener('change', loadSavedMemos);

updateFilterDropdown().then(loadSavedMemos).then(async () => {
    // 旧形式の写真があれば、バックグラウンドで Blob に変換する
    try {
        const n = await migrateLegacyPhotos();
        if (n > 0) { await loadSavedMemos(); console.log(`写真 ${n} 件を新しい保存形式に変換しました`); }
    } catch (e) { console.warn('写真の変換に失敗:', e); }
    checkStorageWarning();
});

// ==========================================
// 8. 入力フォーム & ボタン処理
// ==========================================
// 仮ピンのドラッグで入力フォームが一度閉じても、入力した内容が消えないようにする（写真の選択だけは引き継げない）
function saveFormDraft(marker) {
    const c = $('comment-text');
    if (!c) return;
    marker._draft = {
        comment: c.value,
        category: $('category-select') ? $('category-select').value : '',
        date: $('visited-date') ? $('visited-date').value : '',
        favorite: $('fav-check') ? $('fav-check').checked : false,
        rating: $('rating-select') ? $('rating-select').value : '0'
    };
}
function restoreFormDraft(marker) {
    const d = marker._draft;
    marker._draft = null;
    if (!d || !$('comment-text')) return;
    $('comment-text').value = d.comment;
    if ($('category-select') && d.category) $('category-select').value = d.category;
    if ($('visited-date') && d.date) $('visited-date').value = d.date;
    if ($('fav-check')) $('fav-check').checked = d.favorite;
    if ($('rating-select')) $('rating-select').value = d.rating;
}

function removeTempMarker() {
    if (!tempMarker) return;
    const m = tempMarker;
    tempMarker = null;
    map.removeLayer(m);
}

async function openInputForm(lat, lng, editMemo = null, targetMarker = null) {
    let marker;
    if (editMemo && targetMarker) {
        marker = targetMarker;
    } else {
        removeTempMarker();
        // ドラッグで位置を微調整できる仮ピン
        tempMarker = L.marker([lat, lng], { draggable: true, title: '新しいメモの位置（ドラッグで動かせます）' }).addTo(map);
        marker = tempMarker;
        // ドラッグを始めると Leaflet が吹き出しを閉じる。閉じただけでピンを消さず、ドラッグが終わったらフォームを開き直す
        const dragged = tempMarker;
        dragged.on('dragstart', () => { dragged._dragging = true; });
        dragged.on('dragend', () => {
            dragged._dragging = false;
            dragged._dragEndAt = Date.now();
            if (tempMarker !== dragged) return;
            dragged.openPopup();
            restoreFormDraft(dragged);
        });
    }
    currentFormMarker = marker;

    // 狭い画面では、入力の邪魔にならないよう上部メニューをたたむ（保存済みの設定は変えない）
    if (isNarrow()) setBarCollapsed(true, false);
    marker.unbindPopup()
        .bindPopup('<div class="popup-loading">読み込み中...</div>', popupOptions(true))
        .openPopup();
    marker.isEditing = !!editMemo;

    try {
        const categories = await db.categories.toArray();
        const selectedCat = editMemo ? editMemo.category : '';
        const options = categories.map((c) =>
            `<option value="${escapeHtml(c.name)}" ${c.name === selectedCat ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
        ).join('');
        const hasCurrent = editMemo && hasPhoto(editMemo);
        const currentPhoto = hasCurrent
            ? `<div class="form-photo"><img src="${photoUrl(editMemo, 'thumb')}" alt="現在の写真"><span>新しい写真を選ぶと差し替わります</span>
               <label class="inline-check"><input type="checkbox" id="remove-photo"> 写真を削除する</label></div>`
            : '';
        const dateValue = dateToInput(editMemo ? memoDate(editMemo) : new Date());
        const rating = clampRating(editMemo && editMemo.rating);
        const ratingOptions = [0, 1, 2, 3, 4, 5].map((n) =>
            `<option value="${n}" ${n === rating ? 'selected' : ''}>${n === 0 ? '評価なし' : starsText(n)}</option>`).join('');

        marker.setPopupContent(`
            <div class="popup-form">
                <h3>${editMemo ? 'メモを編集する' : 'ここにメモを残す'}</h3>
                ${editMemo ? '' : '<p class="form-hint">ピンはドラッグして位置を調整できます。</p>'}
                <label for="category-select">カテゴリ</label>
                <select id="category-select">${options}</select>
                <label for="photo-file">写真</label>
                ${currentPhoto}
                <input type="file" id="photo-file" accept="image/*">
                <label for="comment-text">コメント</label>
                <textarea id="comment-text" placeholder="ここにメモを入力...">${escapeHtml(editMemo ? editMemo.comment : '')}</textarea>
                <label for="visited-date">日付（行った日・撮った日）</label>
                <input type="date" id="visited-date" value="${dateValue}">
                <div class="form-row">
                    <label class="inline-check"><input type="checkbox" id="fav-check" ${editMemo && editMemo.favorite ? 'checked' : ''}> ⭐ お気に入り</label>
                    <select id="rating-select" aria-label="評価">${ratingOptions}</select>
                </div>
                <button type="button" id="save-btn">ローカルに保存</button>
            </div>`);
    } catch (err) {
        console.error('カテゴリ取得エラー:', err);
        marker.setPopupContent('<div class="popup-loading">フォームを表示できませんでした。</div>');
    }
}

map.on('click', (e) => {
    if (moveState) { commitMove(e.latlng); return; } // 位置を直しているときは、タップした場所へ移動
    // 仮ピンをドラッグし終えた直後の指・マウスの離しを「地図のクリック」と取り違えて、フォームを作り直さない
    if (tempMarker && tempMarker._dragEndAt && Date.now() - tempMarker._dragEndAt < 500) return;
    openInputForm(e.latlng.lat, e.latlng.lng);
});

// ポップアップを閉じたときの後始末
map.on('popupclose', (e) => {
    const src = e.popup && e.popup._source;
    if (!src) return;
    if (src === tempMarker) {
        saveFormDraft(src);             // ドラッグで一時的に閉じた場合に備えて、入力中の内容を控える
        // 保存せず閉じた仮ピンは消す。ただしドラッグ中（dragstart は直後に発生する）は消さない
        setTimeout(() => { if (tempMarker === src && !src._dragging) removeTempMarker(); }, 0);
    } else if (src.isEditing) {
        src.isEditing = false;
        loadSavedMemos();               // 編集をやめたら表示用ポップアップに戻す
    }
});

// 日付欄の入力 → 保存する visitedAt を決める。
//  ・日付を変えていなければ、今ある値をそのまま残す（新規なら未設定＝保存した日時が日付になる）
//  ・変えたら、その日の正午を保存する
function resolveVisitedAt(dateStr, existing, now = Date.now()) {
    const noon = inputToNoon(dateStr);
    if (noon === null) return existing ? existing.visitedAt : undefined;
    const base = existing ? memoDate(existing) : new Date(now);
    if (dateToInput(base) === dateStr) return existing ? existing.visitedAt : undefined;
    return noon;
}

async function insertToDatabase(f) {
    const now = Date.now();
    const memo = {
        lat: Number(f.lat), lng: Number(f.lng), comment: f.comment, category: f.category,
        timestamp: now, createdAt: now,
        favorite: !!f.favorite, rating: clampRating(f.rating)
    };
    const visitedAt = resolveVisitedAt(f.dateStr, null, now);
    if (visitedAt !== undefined) memo.visitedAt = visitedAt;
    if (f.blobs) { memo.photoBlob = f.blobs.photoBlob; memo.thumbBlob = f.blobs.thumbBlob; }
    return db.memos.add(memo);
}

async function updateDatabase(id, f) {
    const old = await db.memos.get(id);
    if (!old) throw new Error('対象のメモが見つかりません。');
    const next = { ...old, comment: f.comment, category: f.category, timestamp: Date.now(), favorite: !!f.favorite, rating: clampRating(f.rating) };
    if (!old.createdAt) next.createdAt = old.timestamp; // 編集しても最初の保存日（思い出の日付）は変えない
    const visitedAt = resolveVisitedAt(f.dateStr, old);
    if (visitedAt === undefined) delete next.visitedAt; else next.visitedAt = visitedAt;
    if (f.blobs) {
        next.photoBlob = f.blobs.photoBlob; next.thumbBlob = f.blobs.thumbBlob; delete next.photo;
    } else if (f.removePhoto) {
        delete next.photoBlob; delete next.thumbBlob; delete next.photo;
    } // どちらでもなければ既存の写真を維持
    await db.memos.put(next);
}

async function handleSave(btn) {
    const marker = currentFormMarker;
    if (!marker) return;

    const commentEl = $('comment-text');
    const comment = commentEl.value.trim();
    if (!comment) {
        toast('コメントを入力してください。', { type: 'warn' });
        commentEl.focus();
        return;
    }
    const fields = {
        comment,
        category: $('category-select').value,
        dateStr: $('visited-date').value,
        favorite: $('fav-check').checked,
        rating: $('rating-select').value,
        removePhoto: !!($('remove-photo') && $('remove-photo').checked),
        blobs: null
    };
    const file = $('photo-file').files[0];

    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        if (file) {
            try {
                fields.blobs = await makePhotoBlobs(file);
            } catch (e) {
                console.warn('画像の処理に失敗:', e);
                toast('写真を処理できなかったため、写真はそのままにして保存します。', { type: 'warn' });
            }
        }

        if (marker.databaseId) {
            await updateDatabase(marker.databaseId, fields);
            marker.isEditing = false;
            map.closePopup();
        } else {
            const { lat, lng } = marker.getLatLng();
            await insertToDatabase({ ...fields, lat, lng });
            map.closePopup();       // 入力フォームの吹き出しを先に確実に閉じる（スマホ画面で残ることがあったため）
            removeTempMarker();
        }
        toast('保存しました。', { type: 'ok', duration: 2500 });
        await loadSavedMemos();
    } catch (error) {
        reportDbError(error, '保存');
        btn.disabled = false;
        btn.textContent = 'ローカルに保存';
    }
}

// ---- 削除（元に戻せる）----
async function deleteMemoWithUndo(id) {
    let memo;
    try {
        memo = await db.memos.get(id);
        if (!memo) return;
        await db.memos.delete(id);
    } catch (error) {
        reportDbError(error, '削除');
        return;
    }
    map.closePopup();
    await loadSavedMemos();
    // 削除したメモ（写真を含む）はこの画面の中に保持しておき、元に戻すときに同じ ID で書き戻す
    toast('メモを削除しました。', {
        duration: 8000,
        action: {
            label: '元に戻す',
            onClick: async () => {
                try {
                    await db.memos.put(memo);
                    await loadSavedMemos();
                    toast('元に戻しました。', { type: 'ok', duration: 2500 });
                } catch (error) { reportDbError(error, '元に戻す'); }
            }
        }
    });
}

// ---- ピンの位置を直す ----
function onMoveDragEnd(e) { commitMove(e.target.getLatLng()); }

function startMoveMode(id) {
    const marker = activeMarkers.find((m) => m.databaseId === id);
    if (!marker) return;
    cancelMoveMode();
    map.closePopup();
    const from = marker.getLatLng();
    memoLayer.removeLayer(marker);   // まとめ表示から外し、単独のピンとして動かせるようにする
    marker.addTo(map);
    if (marker.dragging) marker.dragging.enable();
    marker.on('dragend', onMoveDragEnd);
    const t = toast('ピンをドラッグするか、地図をタップして新しい位置を指定してください。', {
        duration: 0, action: { label: 'キャンセル', onClick: () => cancelMoveMode() }
    });
    moveState = { marker, id, from, toast: t };
}

function endMoveMode() {
    const st = moveState;
    if (!st) return null;
    moveState = null;
    st.marker.off('dragend', onMoveDragEnd);
    if (st.marker.dragging) st.marker.dragging.disable();
    map.removeLayer(st.marker);
    st.toast.dismiss();
    return st;
}

async function cancelMoveMode() {
    if (!endMoveMode()) return;
    await loadSavedMemos(); // ピンを元の位置・まとめ表示に戻す
}

async function commitMove(latlng) {
    const st = endMoveMode();
    if (!st) return;
    try {
        await db.memos.update(st.id, { lat: latlng.lat, lng: latlng.lng });
        await loadSavedMemos();
        toast('位置を直しました。', {
            duration: 8000,
            action: {
                label: '元に戻す',
                onClick: async () => {
                    try {
                        await db.memos.update(st.id, { lat: st.from.lat, lng: st.from.lng });
                        await loadSavedMemos();
                    } catch (error) { reportDbError(error, '元に戻す'); }
                }
            }
        });
    } catch (error) {
        reportDbError(error, '位置の修正');
        await loadSavedMemos();
    }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && moveState) cancelMoveMode(); });

// ポップアップ内のボタンは「イベント委譲」で処理する
// （ポップアップの中身は開くたびに作り直されるため、個別に登録すると動かなくなる）
document.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    const poiBtn = t.closest('.add-poi-memo-btn');
    if (poiBtn) {
        const lat = parseFloat(poiBtn.dataset.lat);
        const lng = parseFloat(poiBtn.dataset.lng);
        map.closePopup();
        openInputForm(lat, lng);
        return;
    }

    const saveBtn = t.closest('#save-btn');
    if (saveBtn) { handleSave(saveBtn); return; }

    const editBtn = t.closest('.edit-memo-btn');
    if (editBtn) {
        const id = Number(editBtn.dataset.id);
        const memo = await db.memos.get(id);
        const marker = activeMarkers.find((m) => m.databaseId === id);
        if (memo && marker) openInputForm(memo.lat, memo.lng, memo, marker);
        return;
    }

    const moveBtn = t.closest('.move-memo-btn');
    if (moveBtn) { startMoveMode(Number(moveBtn.dataset.id)); return; }

    const delBtn = t.closest('.delete-memo-btn');
    if (delBtn) { deleteMemoWithUndo(Number(delBtn.dataset.id)); }
});

// ==========================================
// 9. カテゴリ管理
// ==========================================
const catModal = $('category-modal');
const catMgmtBtn = $('category-mgmt-btn');
const closeSubBtn = $('close-modal-btn');
const addCatBtn = $('add-category-btn');
const newCatInput = $('new-category-input');
const catListContainer = $('category-list-container');

function openCategoryModal() {
    renderCategoryList();
    openModal(catModal, () => updateFilterDropdown().then(loadSavedMemos));
}
if (catMgmtBtn) catMgmtBtn.addEventListener('click', openCategoryModal);
if (closeSubBtn) closeSubBtn.addEventListener('click', closeModal);
if ($('modal-overlay')) $('modal-overlay').addEventListener('click', closeModal);

function renderCategoryList() {
    if (!catListContainer) return;
    return db.categories.toArray().then((categories) => {
        catListContainer.innerHTML = categories.map((cat) => `
            <div class="category-item">
                <input type="color" class="category-color-input" data-id="${cat.id}" value="${categoryColorOf(cat)}" aria-label="ピンの色">
                <input type="text" class="category-edit-input" data-id="${cat.id}" value="${escapeHtml(cat.name)}" aria-label="カテゴリ名">
                <button type="button" class="update-cat-btn" data-id="${cat.id}">更新</button>
                <button type="button" class="delete-cat-btn" data-id="${cat.id}">削除</button>
            </div>`).join('');
    });
}

if (catListContainer) {
    catListContainer.addEventListener('click', async (ev) => {
        const t = ev.target;
        if (!(t instanceof Element)) return;

        const updateBtn = t.closest('.update-cat-btn');
        if (updateBtn) {
            const id = Number(updateBtn.dataset.id);
            const input = catListContainer.querySelector(`.category-edit-input[data-id="${id}"]`);
            const newName = input.value.trim();
            const colorInput = catListContainer.querySelector(`.category-color-input[data-id="${id}"]`);
            const newColor = safeColor(colorInput && colorInput.value);
            if (!newName) { toast('カテゴリ名を空にすることはできません。', { type: 'warn' }); return; }
            try {
                const old = await db.categories.get(id);
                if (!old || (old.name === newName && categoryColorOf(old) === newColor)) return;
                await db.transaction('rw', db.categories, db.memos, async () => {
                    await db.categories.update(id, { name: newName, color: newColor || categoryColorOf(old) });
                    if (old.name !== newName) {
                        await db.memos.where('category').equals(old.name).modify({ category: newName });
                    }
                });
                toast('カテゴリを更新しました。', { type: 'ok', duration: 2500 });
                renderCategoryList();
            } catch (error) {
                console.error(error);
                toast('変更に失敗しました。同じ名前のカテゴリが既にある可能性があります。', { type: 'error' });
            }
            return;
        }

        const deleteBtn = t.closest('.delete-cat-btn');
        if (deleteBtn) {
            if (!confirm('このカテゴリを削除しますか？（このカテゴリのメモは「カテゴリなし」になります）')) return;
            try {
                const id = Number(deleteBtn.dataset.id);
                const target = await db.categories.get(id);
                await db.transaction('rw', db.categories, db.memos, async () => {
                    if (target) await db.memos.where('category').equals(target.name).modify({ category: '' });
                    await db.categories.delete(id);
                });
                renderCategoryList();
            } catch (error) {
                reportDbError(error, 'カテゴリの削除');
            }
        }
    });
}

if (addCatBtn && newCatInput) {
    addCatBtn.addEventListener('click', async () => {
        const name = newCatInput.value.trim();
        if (!name) return;
        const color = PIN_PALETTE[(await db.categories.count()) % PIN_PALETTE.length]; // 順番に色を割り当てる
        db.categories.add({ name, color })
            .then(() => { newCatInput.value = ''; renderCategoryList(); })
            .catch(() => toast('同名のカテゴリが存在するか、追加に失敗しました。', { type: 'error' }));
    });
}

// ==========================================
// 10. 現在地にメモを作成
// ==========================================
const gpsBtn = $('gps-btn');
if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
        if (!('geolocation' in navigator)) {
            toast('この端末では位置情報を利用できません。', { type: 'error' });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords;
                flyTo([lat, lng], 16);
                openInputForm(lat, lng);
            },
            (err) => {
                console.warn('現在地の取得失敗:', err.message);
                toast('現在地を取得できませんでした。位置情報の設定を確認してください。', { type: 'error' });
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

// ==========================================
// 11. 現在地の追跡 & 距離表示
// ==========================================
function startWatchingPosition() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.watchPosition(
        onPosition,
        (err) => console.warn('位置情報の取得に失敗:', err.message),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
}

function onPosition(pos) {
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    const isFirst = !userLatLng;
    const moved = isFirst || userLatLng.distanceTo(ll) > 10; // 10m未満の揺れは無視
    userLatLng = ll;

    if (!userMarker) {
        // interactive:false … この点の上をタップしても、地図のクリック（メモ作成）が効く
        userMarker = L.circleMarker(ll, {
            radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false
        }).addTo(map);
    } else {
        userMarker.setLatLng(ll);
    }

    if (isFirst) flyTo(ll, 15);
    if (moved) {
        scheduleListRefresh();
        if (openPopupRef) updatePopupDistance(openPopupRef);
    }
}

function distanceTo(lat, lng) {
    return userLatLng ? userLatLng.distanceTo([lat, lng]) : null;
}

function formatDistance(m) {
    if (m == null) return '―';
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function updatePopupDistance(popup) {
    const root = popup && popup.getElement && popup.getElement();
    if (!root) return;
    const el = root.querySelector('.memo-distance');
    const src = popup._source;
    if (!el || !src || !src.getLatLng) return;
    const ll = src.getLatLng();
    el.textContent = userLatLng
        ? `現在地から ${formatDistance(distanceTo(ll.lat, ll.lng))}`
        : '現在地を取得中...';
}
map.on('popupopen', (e) => { openPopupRef = e.popup; updatePopupDistance(e.popup); });
map.on('popupclose', () => { openPopupRef = null; });

// 地図を移動し、移動が終わってから処理を実行（すでにその位置なら即実行）
function flyThen(latlng, zoom, callback) {
    const target = L.latLng(latlng);
    if (map.getCenter().distanceTo(target) < 2 && map.getZoom() === zoom) { callback(); return; }
    map.once('moveend', callback);
    flyTo(target, zoom);
}

async function focusMemo(id) {
    let marker = activeMarkers.find((m) => m.databaseId === id);
    if (!marker) {
        // 絞り込み中のカテゴリ外のメモなら、「すべて」に戻して表示する
        if (categoryFilter) categoryFilter.value = 'all';
        if ($('fav-only')) $('fav-only').checked = false;
        await loadSavedMemos();
        marker = activeMarkers.find((m) => m.databaseId === id);
    }
    if (!marker) return;
    flyThen(marker.getLatLng(), Math.max(map.getZoom(), 16), () => {
        // まとめ表示の中に隠れているピンも、ほどいて表示してから開く
        if (memoLayer.zoomToShowLayer) memoLayer.zoomToShowLayer(marker, () => marker.openPopup());
        else marker.openPopup();
    });
}

// ==========================================
// 12. カテゴリ別メモ一覧（現在地に近い順 / 新しい順 / 評価順）
// ==========================================
const listPanel = $('memo-list-panel');
const listBody = $('memo-list-body');
const listTitle = $('memo-list-title');
const listSortSelect = $('memo-list-sort');
let listRefreshTimer = null;

function setListOpen(open) {
    if (!listPanel) return;
    listPanel.hidden = !open;
    const btn = $('memo-list-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    map.invalidateSize(); // パネルの開閉で地図の高さが変わるため
    if (open) renderMemoList();
}

function scheduleListRefresh() {
    clearTimeout(listRefreshTimer);
    listRefreshTimer = setTimeout(renderMemoList, 500);
}

// 一覧の並べ替え（表示用に切り出し）
// 標準の向き: 近い順（距離の昇順）・新しい順（日時の降順）・評価の高い順（評価の降順）。reverse が true なら逆向き
function effectiveSortMode(mode, hasLocation) {
    return mode === 'distance' && !hasLocation ? 'recent' : mode; // 現在地が分からないときは新しい順
}
function isAscending(mode, hasLocation, reverse) {
    const baseAsc = effectiveSortMode(mode, hasLocation) === 'distance'; // 距離だけは標準が昇順
    return baseAsc !== !!reverse;
}
function sortMemoItems(items, mode, hasLocation, reverse = false) {
    const arr = items.slice();
    const eff = effectiveSortMode(mode, hasLocation);
    if (eff === 'rating') {
        arr.sort((a, b) => (clampRating(b.memo.rating) - clampRating(a.memo.rating))
            || ((b.memo.favorite ? 1 : 0) - (a.memo.favorite ? 1 : 0))
            || (b.memo.timestamp - a.memo.timestamp));
    } else if (eff === 'distance') {
        arr.sort((a, b) => a.dist - b.dist);
    } else {
        arr.sort((a, b) => b.memo.timestamp - a.memo.timestamp);
    }
    if (reverse) arr.reverse();
    return arr;
}

// 並びの向きのボタン（昇順 / 降順）の表示を更新する
const ORDER_WORDS = {
    distance: { asc: '近い順', desc: '遠い順' },
    recent: { asc: '古い順', desc: '新しい順' },
    rating: { asc: '評価の低い順', desc: '評価の高い順' }
};
function updateOrderButton() {
    const btn = $('memo-list-order');
    if (!btn) return;
    const eff = effectiveSortMode(listSort, !!userLatLng);
    const asc = isAscending(listSort, !!userLatLng, listReverse);
    btn.textContent = asc ? '昇順 ↑' : '降順 ↓';
    const now = ORDER_WORDS[eff][asc ? 'asc' : 'desc'];
    const next = asc ? '降順' : '昇順';
    btn.title = `いまは${asc ? '昇順' : '降順'}（${now}）。押すと${next}に切り替わります`;
    btn.setAttribute('aria-label', `並びの向き: ${asc ? '昇順' : '降順'}（${now}）。押すと${next}に切り替え`);
}

function renderMemoList() {
    if (!listPanel || listPanel.hidden) return; // 開いているときだけ描画（写真が多いと重いため）

    const filter = categoryFilter && categoryFilter.value !== 'all' ? categoryFilter.value : 'すべてのカテゴリ';
    const favOnly = !!($('fav-only') && $('fav-only').checked);
    const items = sortMemoItems(
        visibleMemos.map((memo) => ({ memo, dist: distanceTo(memo.lat, memo.lng) })),
        listSort, !!userLatLng, listReverse
    );
    updateOrderButton();

    listTitle.textContent = `${filter}${favOnly ? '・お気に入り' : ''}（${items.length}件）`;

    let html = '';
    if (listSort === 'distance' && !userLatLng) {
        html += '<li class="list-note">現在地を取得できていないため、新しい順で表示しています。</li>';
    }
    if (items.length === 0) {
        html += '<li class="list-note">条件に合うメモはまだありません。</li>';
    }
    html += items.map(({ memo, dist }) => {
        const thumb = hasPhoto(memo)
            ? `<img class="thumb" loading="lazy" src="${photoUrl(memo, 'thumb')}" alt="">`
            : '<span class="thumb none" aria-hidden="true">📝</span>';
        const badge = memo.category ? `<span class="memo-badge">${escapeHtml(memo.category)}</span>` : '';
        const r = clampRating(memo.rating);
        const extra = `${memo.favorite ? '<span class="fav-tag">⭐</span>' : ''}${r ? `<span class="rating" aria-label="評価 ${r}">${starsText(r)}</span>` : ''}`;
        return `
            <li><button type="button" class="memo-list-item" data-id="${memo.id}">
                ${thumb}
                <span class="item-main"><span class="item-text">${escapeHtml(memo.comment)}</span><span class="item-meta">${badge}${extra}</span></span>
                <span class="item-dist">${formatDistance(dist)}</span>
            </button></li>`;
    }).join('');
    listBody.innerHTML = html;
}

const listBtn = $('memo-list-btn');
const listCloseBtn = $('memo-list-close');
if (listBtn) listBtn.addEventListener('click', () => setListOpen(listPanel.hidden));
if (listCloseBtn) listCloseBtn.addEventListener('click', () => { setListOpen(false); if (listBtn) listBtn.focus(); });
if (listSortSelect) listSortSelect.addEventListener('change', () => { listSort = listSortSelect.value; listReverse = false; renderMemoList(); });
const listOrderBtn = $('memo-list-order');
if (listOrderBtn) listOrderBtn.addEventListener('click', () => { listReverse = !listReverse; renderMemoList(); });
if (listBody) {
    listBody.addEventListener('click', (ev) => {
        const btn = ev.target instanceof Element && ev.target.closest('.memo-list-item');
        if (btn) focusMemo(Number(btn.dataset.id));
    });
}

// ==========================================
// 13. 強化した検索（保存メモ / 場所・施設 / 座標）
// ==========================================
// ・保存メモ … 入力中にすぐ検索（オフラインでも可）
// ・場所・施設 … 「検索」ボタンか Enter で実行（Nominatim の利用規約上、入力のたびの自動検索はしない）
// ・座標 … 「35.6812, 139.7671」のように入力すると、その地点へ移動
const SEARCH_COUNTRY = 'jp'; // 場所検索の対象国。世界中を対象にするなら '' にする
const searchArea = $('search-area');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchBounded = document.getElementById('search-bounded');
const searchResults = document.getElementById('search-results');

let memoHits = [];
let poiHits = [];            // 表示中の周辺施設からの検索結果
let placeMoreLoading = false; // 部分一致の追加検索中
let lastCoord = null;
let lastPlaces = [];
let placeState = 'idle'; // idle | loading | done | empty | offline | error
let placeAbort = null;
let searchInputTimer = null;

// 全角/半角・大文字小文字・カタカナ/ひらがなの違いを吸収して検索できるようにする
function normalizeText(s) {
    return String(s ?? '').normalize('NFKC').toLowerCase()
        .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

async function getMemoIndex() {
    if (!memoIndex) {
        const list = [];
        await db.memos.each((m) => list.push({
            id: m.id, lat: m.lat, lng: m.lng, comment: m.comment, category: m.category,
            timestamp: m.timestamp, hasPhoto: hasPhoto(m),
            hay: normalizeText(`${m.comment} ${m.category}`)
        }));
        memoIndex = list;
    }
    return memoIndex;
}

// ---- 部分一致の仕組み ----
// 検索語を「単語」と「2文字の連続（2-gram）」に分け、どれか1つでも含まれていれば一致とする。
// 日本語は単語の区切りがないため、2文字ずつに分けると「熊本城公園」で「熊本城」も拾える。
function queryTerms(q) {
    const words = normalizeText(q).split(/\s+/).filter(Boolean);
    const grams = new Set();
    words.forEach((w) => {
        const chars = [...w];
        if (chars.length === 1) grams.add(w);
        else for (let i = 0; i < chars.length - 1; i++) grams.add(chars[i] + chars[i + 1]);
    });
    return { words, grams: [...grams], whole: words.join('') };
}

// 一致の強さ: 0=不一致 / 1=一部一致 / 2=すべての単語を含む / 3=検索語がそのまま含まれる
function matchTier(hay, t) {
    if (t.words.length === 0) return 0;
    if (t.whole && hay.replace(/\s+/g, '').includes(t.whole)) return 3;
    if (t.words.every((w) => hay.includes(w))) return 2;
    return t.grams.some((g) => hay.includes(g)) ? 1 : 0;
}
function matchScore(hay, t) {
    return t.grams.reduce((n, g) => n + (hay.includes(g) ? 1 : 0), 0);
}
// 強い一致 → 弱い一致の順。同じ強さなら（一部一致は重なりの多い順、その後）近い順
function compareHits(a, b) {
    if (b.tier !== a.tier) return b.tier - a.tier;
    if (a.tier === 1 && b.score !== a.score) return b.score - a.score;
    if (userLatLng && a.dist != null && b.dist != null) return a.dist - b.dist;
    return (b.timestamp || 0) - (a.timestamp || 0);
}

async function searchMemos(q) {
    const t = queryTerms(q);
    if (t.words.length === 0) return [];
    const index = await getMemoIndex();
    const hits = [];
    index.forEach((m) => {
        const tier = matchTier(m.hay, t);
        if (tier) hits.push({ ...m, tier, score: matchScore(m.hay, t), dist: distanceTo(m.lat, m.lng) });
    });
    return hits.sort(compareHits);
}

// いま地図に読み込まれている周辺施設（名前つき）から探す。通信なしで即座に結果が出る
function searchLoadedPOI(q) {
    const t = queryTerms(q);
    if (t.words.length === 0) return [];
    const hits = [];
    for (const [id, marker] of poiMarkers) {
        const name = marker.options.title;
        if (!name || name === '周辺施設') continue; // 名前のない施設は対象外
        const hay = normalizeText(name);
        const tier = matchTier(hay, t);
        if (!tier) continue;
        const ll = marker.getLatLng();
        hits.push({ id, name, lat: ll.lat, lng: ll.lng, tier, score: matchScore(hay, t), dist: distanceTo(ll.lat, ll.lng) });
    }
    return hits.sort(compareHits);
}

function parseCoordinates(q) {
    const m = normalizeText(q).match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s、]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]); // 緯度, 経度 の順
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

// 場所・施設の結果を並べ替える（完全な一致 → 一部一致、同じ強さなら近い順。
// 現在地が未取得のときは地図の中心からの距離）
function sortPlacesByDistance() {
    const origin = userLatLng || map.getCenter();
    lastPlaces.forEach((p) => { p.dist = origin.distanceTo([p.lat, p.lng]); });
    lastPlaces.sort((x, y) => (x.partial - y.partial) || (x.dist - y.dist));
}

// 元の検索語で見つからないとき用の、短くした検索語（Nominatim は語の一部では探せないため）
//  ・空白区切りなら、それぞれの単語
//  ・1語なら、前方・後方の約6割（例: 熊本城公園 → 熊本城 / 本城公園）
function fallbackQueries(q) {
    const words = q.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
    const out = [];
    if (words.length > 1) {
        words.forEach((w) => out.push(w));
    } else if (words.length === 1) {
        const chars = [...words[0]];
        if (chars.length >= 3) {
            const n = Math.max(2, Math.ceil(chars.length * 0.6));
            out.push(chars.slice(0, n).join(''), chars.slice(-n).join(''));
        }
    }
    return [...new Set(out)].filter((x) => x !== q.trim()).slice(0, 3);
}

async function fetchPlaces(q, signal) {
    const b = map.getBounds();
    const params = new URLSearchParams({
        q, format: 'jsonv2', 'accept-language': 'ja', limit: '15',
        viewbox: `${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}` // 表示範囲を優先
    });
    if (SEARCH_COUNTRY) params.set('countrycodes', SEARCH_COUNTRY);
    if (searchBounded && searchBounded.checked) params.set('bounded', '1'); // 表示範囲内だけに限定

    const res = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), { signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.map((r) => ({
        id: `${r.osm_type}/${r.osm_id}`,
        name: r.name || String(r.display_name).split(',')[0].trim(),
        address: r.display_name,
        lat: parseFloat(r.lat), lng: parseFloat(r.lon)
    }));
}

// ---- Overpass API: 施設名の部分一致検索 ----
// OpenStreetMap のデータを「名前に検索語の一部が含まれるか」で探す。
// Nominatim が苦手な部分一致（例: 「熊本」で名前に熊本を含む施設すべて）を補う。
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_RADIUS = 10000; // 表示範囲に限定しないときの検索半径（地図の中心から、メートル）
const OVERPASS_MAX = 100;      // 1回の検索で受け取る最大件数

const toKatakana = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// 検索語から正規表現を作る。OSM の名前は表記ゆれがあるため、ひらがな・カタカナの両方を候補に入れる。
// 正規表現や Overpass QL を壊す記号は、あらかじめ取り除く（検索語による注入を防ぐ）
function overpassRegex(q) {
    const clean = (x) => x.replace(/[.*+?^${}()|[\]\\"'`<>]/g, '');
    const words = q.normalize('NFKC').trim().split(/\s+/).map(clean).filter(Boolean);
    const pieces = [...words, ...fallbackQueries(q).map(clean)];
    const variants = new Set();
    pieces.forEach((w) => {
        if (!w) return;
        variants.add(w); variants.add(toKatakana(w)); variants.add(toHiragana(w));
    });
    return [...variants].join('|');
}

// 検索する範囲: 「表示範囲内だけ」にチェックがあれば画面の範囲、なければ地図の中心から半径10km。
// 範囲が広すぎる（縮尺が小さい）ときは、負荷を避けるため半径10kmに切り替える
function overpassArea() {
    const b = map.getBounds();
    const small = (b.getNorth() - b.getSouth()) <= 0.6 && (b.getEast() - b.getWest()) <= 0.6;
    if (searchBounded && searchBounded.checked && small) {
        return `(${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()})`;
    }
    const c = map.getCenter();
    return `(around:${OVERPASS_RADIUS},${c.lat},${c.lng})`;
}

const KIND_LABELS = {
    cafe: 'カフェ', restaurant: 'レストラン', fast_food: 'ファストフード', bar: 'バー', pub: 'パブ',
    public_bath: '公衆浴場', hot_spring: '温泉', convenience: 'コンビニ', supermarket: 'スーパー',
    attraction: '観光地', hotel: 'ホテル', museum: '博物館', station: '駅', park: '公園',
    hospital: '病院', pharmacy: '薬局', bank: '銀行', library: '図書館', school: '学校',
    place_of_worship: '寺社・教会', parking: '駐車場', toilets: 'トイレ', castle: '城'
};
function placeKind(tags) {
    const v = tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.historic || tags.railway || tags.natural || '';
    return KIND_LABELS[v] || v;
}

async function fetchOverpassNames(q, signal) {
    const re = overpassRegex(q);
    if (!re) return [];
    const area = overpassArea();
    const selectors = ['["amenity"]', '["shop"]', '["tourism"]', '["leisure"]', '["historic"]', '["railway"="station"]', '["natural"="hot_spring"]'];
    const query = `[out:json][timeout:25];(${selectors.map((x) => `nwr["name"~"${re}",i]${x}${area};`).join('')});out center ${OVERPASS_MAX};`;

    const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    return (data.elements || []).map((el) => {
        const tags = el.tags || {};
        const lat = el.lat ?? (el.center && el.center.lat);
        const lng = el.lon ?? (el.center && el.center.lon);
        if (!tags.name || lat == null || lng == null) return null;
        const area2 = tags['addr:city'] || tags['addr:suburb'] || '';
        return {
            id: `${el.type}/${el.id}`, // Nominatim の id と同じ形式なので、重複を判定できる
            name: tags.name,
            address: [placeKind(tags), area2].filter(Boolean).join(' ／ ') || 'OpenStreetMap',
            lat, lng, icon: poiIconFor(tags)
        };
    }).filter(Boolean);
}

async function searchPlaces(q) {
    if (placeAbort) placeAbort.abort();
    if (!navigator.onLine) { placeState = 'offline'; renderSearchResults(); return; }

    placeAbort = new AbortController();
    const signal = placeAbort.signal;
    placeState = 'loading';
    placeMoreLoading = false;
    lastPlaces = [];
    renderSearchResults();

    const t = queryTerms(q);
    const found = new Map(); // 同じ場所の重複を除く
    // mode: 'main' = 元の検索語 / 'name' = 施設名の部分一致 / 'fallback' = 短くした検索語
    const add = (list, mode) => list.forEach((p) => {
        if (found.has(p.id)) return;
        let partial = 0;
        if (mode === 'fallback') partial = 1;
        else if (mode === 'name') partial = matchTier(normalizeText(p.name), t) >= 2 ? 0 : 1;
        found.set(p.id, { ...p, partial });
    });
    const publish = () => {
        lastPlaces = [...found.values()];
        sortPlacesByDistance();
        placeState = lastPlaces.length ? 'done' : 'empty';
    };

    // Nominatim と Overpass は別のサーバーなので、同時に検索を始める
    const nameP = fetchOverpassNames(q, signal).catch((e) => {
        if (e.name !== 'AbortError') console.warn('施設名の検索に失敗:', e.message);
        return [];
    });

    let nomError = null;
    try {
        add(await fetchPlaces(q, signal), 'main');
    } catch (e) {
        if (e.name === 'AbortError') return;
        nomError = e;
        console.warn('場所の検索に失敗:', e.message);
    }
    if (signal.aborted) return;
    if (found.size) publish(); // 先に届いた結果を表示

    placeMoreLoading = true;
    renderSearchResults();
    add(await nameP, 'name');
    if (signal.aborted) return;
    publish();
    renderSearchResults();

    // それでも少なければ、検索語を短くして Nominatim で補う
    // （利用規約に合わせて、リクエストは1秒以上あけて最大3回まで）
    if (found.size < 5 && !nomError) {
        for (const fq of fallbackQueries(q)) {
            await sleep(1100);
            if (signal.aborted) return;
            try {
                add(await fetchPlaces(fq, signal), 'fallback');
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.warn('部分一致の追加検索に失敗:', e.message);
            }
            if (signal.aborted) return;
            publish();
            renderSearchResults();
            if (found.size >= 15) break;
        }
    }

    if (signal.aborted) return;
    if (nomError && found.size === 0) placeState = 'error';
    placeMoreLoading = false;
    renderSearchResults();
}

function searchItemHtml(kind, key, icon, title, sub, dist) {
    return `
        <li><button type="button" class="sr-item" data-kind="${kind}" data-key="${key}">
            <span class="sr-icon">${icon}</span>
            <span class="sr-main"><span class="sr-title">${escapeHtml(title)}</span>${sub ? `<span class="sr-sub">${escapeHtml(sub)}</span>` : ''}</span>
            <span class="sr-dist">${dist == null ? '' : formatDistance(dist)}</span>
        </button></li>`;
}

function renderSearchResults() {
    if (!searchResults) return;
    const q = searchInput.value.trim();
    if (!q) { searchResults.hidden = true; return; }

    let html = '';

    if (lastCoord) {
        html += '<div class="sr-section">座標</div><ul>' + searchItemHtml(
            'coord', '0', '📌', `${lastCoord.lat}, ${lastCoord.lng}`, 'この地点へ移動', distanceTo(lastCoord.lat, lastCoord.lng)
        ) + '</ul>';
    }

    if (memoHits.length) {
        html += `<div class="sr-section">保存したメモ（${memoHits.length}件）</div><ul>`
            + memoHits.slice(0, 20).map((m) =>
                searchItemHtml('memo', m.id, m.hasPhoto ? '🖼️' : '📝', m.comment.replace(/\s+/g, ' '), [m.category, m.tier === 1 ? '一部一致' : ''].filter(Boolean).join(' ／ '), m.dist)
            ).join('') + '</ul>';
    }

    if (poiHits.length) {
        html += `<div class="sr-section">表示中の周辺施設（${poiHits.length}件）</div><ul>`
            + poiHits.slice(0, 15).map((h) =>
                searchItemHtml('poi', h.id, '📍', h.name, h.tier === 1 ? '一部一致' : '', h.dist)
            ).join('') + '</ul>';
    }

    const hasPartial = lastPlaces.some((p) => p.partial);
    html += `<div class="sr-section">場所・施設（${userLatLng ? '現在地' : '地図の中心'}から近い順${hasPartial ? '・一部一致は後ろ' : ''}）</div>`;
    if (placeState === 'idle') html += '<div class="sr-note">Enter キーで場所・施設を検索します（オンライン時。施設名は語の一部だけでも、地図の中心から約10km以内で探します）</div>';
    else if (placeState === 'loading') html += '<div class="sr-note">検索中...</div>';
    else if (placeState === 'offline') html += '<div class="sr-note">オフラインのため、場所の検索はできません（保存したメモは検索できます）</div>';
    else if (placeState === 'error') html += '<div class="sr-note">検索に失敗しました。時間をおいて再度お試しください。</div>';
    else if (placeState === 'empty') html += '<div class="sr-note">該当する場所が見つかりませんでした。</div>';
    else {
        sortPlacesByDistance();
        html += '<ul>' + lastPlaces.map((p, i) =>
            searchItemHtml('place', i, p.icon || '📍', p.name, (p.partial ? '一部一致 ／ ' : '') + p.address, distanceTo(p.lat, p.lng))
        ).join('') + '</ul>';
    }
    if (placeMoreLoading && placeState !== 'loading') html += '<div class="sr-note">施設名・検索語の一部でも探しています...</div>';

    searchResults.innerHTML = html;
    searchResults.hidden = false;
}

function showPlace(name, lat, lng) {
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lng], {
        icon: L.divIcon({ className: 'poi-icon', html: '🔎', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] })
    }).addTo(map).bindPopup(buildPoiPopup(name, '🔎', lat, lng));
    const marker = searchMarker;
    flyThen([lat, lng], Math.max(map.getZoom(), 16), () => marker.openPopup());
}

async function refreshMemoResults() {
    const q = searchInput.value.trim();
    memoHits = q ? await searchMemos(q) : [];
    poiHits = q ? searchLoadedPOI(q) : [];
    lastCoord = parseCoordinates(q);
    renderSearchResults();
}

if (searchInput && searchForm && searchResults) {
    // 入力中: 保存メモをすぐ検索（場所検索の結果は一旦リセット）
    searchInput.addEventListener('input', () => {
        placeState = 'idle';
        placeMoreLoading = false;
        lastPlaces = [];
        if (placeAbort) placeAbort.abort();
        clearTimeout(searchInputTimer);
        searchInputTimer = setTimeout(refreshMemoResults, 150);
    });

    // Enter / 検索ボタン: 場所・施設も検索
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = searchInput.value.trim();
        if (!q) return;
        await refreshMemoResults();
        if (!lastCoord) await searchPlaces(q);
    });

    searchInput.addEventListener('focus', renderSearchResults);
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') searchResults.hidden = true; });
    document.addEventListener('click', (e) => {
        if (searchArea && !searchArea.contains(e.target)) searchResults.hidden = true;
    });

    searchResults.addEventListener('click', (ev) => {
        const btn = ev.target instanceof Element && ev.target.closest('.sr-item');
        if (!btn) return;
        const { kind, key } = btn.dataset;
        searchResults.hidden = true;
        if (kind === 'memo') {
            focusMemo(Number(key));
        } else if (kind === 'poi') {
            const marker = poiMarkers.get(key);
            if (marker) flyThen(marker.getLatLng(), Math.max(map.getZoom(), 16), () => marker.openPopup());
        } else if (kind === 'place') {
            const p = lastPlaces[Number(key)];
            if (p) showPlace(p.name, p.lat, p.lng);
        } else if (kind === 'coord' && lastCoord) {
            showPlace(`座標 ${lastCoord.lat}, ${lastCoord.lng}`, lastCoord.lat, lastCoord.lng);
        }
    });
}


// ==========================================
// 14. 上部バー（カテゴリ・検索）の折りたたみ
// ==========================================
const topBar = document.getElementById('top-bar');
const topBarToggle = document.getElementById('top-bar-toggle');
const BAR_KEY = 'mapMemo.topBarCollapsed';

function setBarCollapsed(collapsed, persist = true) {
    if (!topBar || !topBarToggle) return;
    topBar.classList.toggle('collapsed', collapsed);
    topBarToggle.setAttribute('aria-expanded', String(!collapsed));
    topBarToggle.setAttribute('aria-label', collapsed ? 'メニューを開く' : 'メニューをたたむ');
    topBarToggle.textContent = collapsed ? '☰ 検索・メニュー' : '▲';
    if (collapsed && searchResults) searchResults.hidden = true;
    if (persist) lsSet(BAR_KEY, collapsed ? '1' : '0');
}

if (topBar && topBarToggle) {
    topBarToggle.addEventListener('click', () => setBarCollapsed(!topBar.classList.contains('collapsed')));
    // 前回の状態を引き継ぐ。初めて開いたときは、狭い画面（スマホ）では地図を広く使うためたたんでおく
    const saved = lsGet(BAR_KEY);
    setBarCollapsed(saved === null ? isNarrow() : saved === '1', false);
}

// ==========================================
// 15. 思い出ビュー（統計・過去の今日・月別タイムライン）
// ==========================================
const memPanel = $('memories-panel');
const memBody = $('memories-body');
const memBtn = $('memories-btn');
const memClose = $('memories-close');

function memoryRow(m, d, label) {
    const thumb = hasPhoto(m)
        ? `<img class="thumb" loading="lazy" decoding="async" src="${photoUrl(m, 'thumb')}" alt="">`
        : '<span class="thumb none" aria-hidden="true">📝</span>';
    const cat = m.category || 'カテゴリなし';
    const r = clampRating(m.rating);
    const extra = `${m.favorite ? ' ／ ⭐' : ''}${r ? ` ／ <span aria-label="評価 ${r}">${starsText(r)}</span>` : ''}`;
    return `
        <li><button type="button" class="memory-item" data-id="${m.id}">
            ${thumb}
            <span class="item-main">
                <span class="item-text">${escapeHtml(m.comment)}</span>
                <span class="item-meta"><span class="cat-dot" style="background:${categoryColor(m.category)}"></span>${escapeHtml(cat)} ／ ${label || escapeHtml(fmtDate(d))}${extra}</span>
            </span>
        </button></li>`;
}

async function renderMemories() {
    if (!memBody) return;
    await refreshCategoryColors();
    const memos = await db.memos.toArray();
    if (memos.length === 0) {
        memBody.innerHTML = '<p class="mem-empty">まだメモがありません。地図をタップして、最初の思い出を残しましょう。</p>';
        return;
    }

    const items = memos.map((m) => ({ m, d: memoDate(m) })).sort((a, b) => b.d - a.d); // 新しい順
    const total = items.length;
    const withPhoto = items.filter((x) => hasPhoto(x.m)).length;
    const favCount = items.filter((x) => x.m.favorite).length;
    const counts = new Map();
    items.forEach(({ m }) => counts.set(m.category || '', (counts.get(m.category || '') || 0) + 1));
    const maxCount = Math.max(...counts.values());

    // 過去の年の「今日」（前後3日）
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const throwback = items.filter(({ d }) => {
        if (d.getFullYear() >= now.getFullYear()) return false;
        const sameDay = new Date(now.getFullYear(), d.getMonth(), d.getDate());
        return Math.abs(sameDay - today) <= 3 * DAY_MS;
    });

    // 月ごとにまとめる
    const groups = [];
    items.forEach((it) => {
        const key = `${it.d.getFullYear()}年${it.d.getMonth() + 1}月`;
        const last = groups[groups.length - 1];
        if (last && last.key === key) last.list.push(it); else groups.push({ key, list: [it] });
    });

    const stat = (n, label) => `<div class="mem-stat"><b>${n}</b><span>${label}</span></div>`;
    let html = `
        <div class="mem-stats">
            ${stat(total, 'メモ')}
            ${stat(withPhoto, '写真つき')}
            ${stat(favCount, '⭐ お気に入り')}
            ${stat([...counts.keys()].filter(Boolean).length, 'カテゴリ')}
            ${stat(escapeHtml(fmtDate(items[total - 1].d)), '最初の記録')}
        </div>

        <h3 class="mem-h">カテゴリ別（タップで地図を絞り込み）</h3>
        <div class="cat-bars">
            ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `
                <button type="button" class="cat-bar" data-cat="${escapeHtml(name)}" ${name ? '' : 'disabled'}>
                    <span class="cat-bar-label">${escapeHtml(name || 'カテゴリなし')}</span>
                    <span class="cat-bar-track"><span class="cat-bar-fill" style="width:${Math.max(4, Math.round(n / maxCount * 100))}%;background:${categoryColor(name)}"></span></span>
                    <span class="cat-bar-n">${n}</span>
                </button>`).join('')}
        </div>`;

    if (throwback.length) {
        html += `<h3 class="mem-h">🕰️ 過去の今日（前後3日）</h3><ul class="mem-list">`
            + throwback.map(({ m, d }) => memoryRow(m, d, `${now.getFullYear() - d.getFullYear()}年前 ・ ${escapeHtml(fmtDate(d))}`)).join('')
            + '</ul>';
    }

    html += '<h3 class="mem-h">タイムライン</h3>'
        + groups.map((g) => `<div class="mem-month">${g.key}（${g.list.length}件）</div><ul class="mem-list">`
            + g.list.map(({ m, d }) => memoryRow(m, d)).join('') + '</ul>').join('');

    memBody.innerHTML = html;
}

function setMemoriesOpen(open) {
    if (!memPanel) return;
    memPanel.hidden = !open;
    if (open) { memBody.scrollTop = 0; renderMemories(); if (memClose) memClose.focus(); }
    else if (memBtn) { memBtn.focus(); }
}

if (memBtn) memBtn.addEventListener('click', () => setMemoriesOpen(true));
if (memClose) memClose.addEventListener('click', () => setMemoriesOpen(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && memPanel && !memPanel.hidden) setMemoriesOpen(false); });
if (memBody) {
    memBody.addEventListener('click', (ev) => {
        const t = ev.target instanceof Element ? ev.target : null;
        if (!t) return;
        const item = t.closest('.memory-item');
        if (item) { setMemoriesOpen(false); focusMemo(Number(item.dataset.id)); return; }

        const bar = t.closest('.cat-bar');
        if (bar && bar.dataset.cat && categoryFilter && [...categoryFilter.options].some((o) => o.value === bar.dataset.cat)) {
            categoryFilter.value = bar.dataset.cat;
            setMemoriesOpen(false);
            loadSavedMemos();
        }
    });
}

// ==========================================
// 16. バックアップ（書き出し・読み込み）と他形式への書き出し
// ==========================================
// バックアップ形式（JSON）:
//   { format:'map-memo-backup', version:1, exportedAt, categories:[{name,color}],
//     memos:[{lat,lng,comment,category,timestamp,createdAt,visitedAt,favorite,rating,photo(dataURL|null)}] }
const BACKUP_FORMAT = 'map-memo-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_MEMOS = 100000;
const PHOTO_DATAURL_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function memoKey(m) { return `${m.createdAt || m.timestamp}|${m.lat}|${m.lng}|${m.comment}`; }

async function buildBackup() {
    const [cats, memos] = await Promise.all([db.categories.toArray(), db.memos.toArray()]);
    const out = [];
    for (const m of memos) {
        let photo = null;
        if (m.photoBlob) photo = await blobToDataUrl(m.photoBlob);
        else if (m.photo) photo = m.photo;
        out.push({
            lat: m.lat, lng: m.lng, comment: m.comment, category: m.category || '',
            timestamp: m.timestamp, createdAt: m.createdAt || m.timestamp,
            visitedAt: m.visitedAt || null, favorite: !!m.favorite, rating: clampRating(m.rating), photo
        });
    }
    return {
        format: BACKUP_FORMAT, version: BACKUP_VERSION, app: '地図メモ', exportedAt: new Date().toISOString(),
        categories: cats.map((c) => ({ name: c.name, color: categoryColorOf(c) })),
        memos: out
    };
}

// 読み込むファイルの検査と整形。外部から来たデータは信用せず、型・範囲・形式を確かめてから使う
function validateBackup(obj) {
    if (!obj || typeof obj !== 'object' || obj.format !== BACKUP_FORMAT) {
        return { ok: false, error: 'このアプリのバックアップファイルではありません。' };
    }
    if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
        return { ok: false, error: 'より新しいバージョンのバックアップです。アプリを更新してから読み込んでください。' };
    }
    if (!Array.isArray(obj.memos)) return { ok: false, error: 'メモのデータが見つかりません。' };
    if (obj.memos.length > MAX_BACKUP_MEMOS) return { ok: false, error: 'メモの件数が多すぎます。' };

    const finite = (v) => typeof v === 'number' && Number.isFinite(v);
    const categories = [];
    (Array.isArray(obj.categories) ? obj.categories : []).forEach((c) => {
        if (c && typeof c.name === 'string' && c.name.trim()) {
            categories.push({ name: c.name.trim().slice(0, 100), color: safeColor(c.color) });
        }
    });

    const memos = [];
    let skipped = 0, photoDropped = 0;
    obj.memos.forEach((m) => {
        if (!m || !finite(m.lat) || !finite(m.lng) || Math.abs(m.lat) > 90 || Math.abs(m.lng) > 180) { skipped++; return; }
        const now = Date.now();
        const createdAt = finite(m.createdAt) ? m.createdAt : (finite(m.timestamp) ? m.timestamp : now);
        const rec = {
            lat: m.lat, lng: m.lng,
            comment: String(m.comment ?? '').slice(0, 5000),
            category: String(m.category ?? '').slice(0, 100),
            timestamp: finite(m.timestamp) ? m.timestamp : createdAt,
            createdAt,
            favorite: m.favorite === true,
            rating: clampRating(m.rating),
            photo: null
        };
        if (finite(m.visitedAt)) rec.visitedAt = m.visitedAt;
        if (typeof m.photo === 'string' && m.photo) {
            if (PHOTO_DATAURL_RE.test(m.photo)) rec.photo = m.photo; else photoDropped++;
        }
        memos.push(rec);
    });
    return { ok: true, categories, memos, skipped, photoDropped };
}

// 検査済みのバックアップをデータベースへ統合する（同じメモは重複させない）
async function mergeBackup(v) {
    const existingCats = new Set((await db.categories.toArray()).map((c) => c.name));
    let catAdded = 0;
    for (const c of v.categories) {
        if (existingCats.has(c.name)) continue;
        try {
            await db.categories.add({ name: c.name, color: c.color || PIN_PALETTE[(existingCats.size) % PIN_PALETTE.length] });
            existingCats.add(c.name); catAdded++;
        } catch (e) { /* 同名がすでにある場合は無視 */ }
    }
    const keys = new Set();
    await db.memos.each((m) => keys.add(memoKey(m)));

    let added = 0, duplicates = 0, photoFailed = 0;
    for (const rec of v.memos) {
        const k = memoKey(rec);
        if (keys.has(k)) { duplicates++; continue; }
        keys.add(k);
        const { photo, ...base } = rec;
        const memo = { ...base };
        if (photo) {
            try {
                const photoBlob = dataUrlToBlob(photo);
                memo.photoBlob = photoBlob;
                try { memo.thumbBlob = await resizeToBlob(photoBlob, THUMB_MAX, THUMB_QUALITY); } catch (e) { /* サムネイルなしでも表示可能 */ }
            } catch (e) { photoFailed++; }
        }
        await db.memos.add(memo);
        added++;
    }
    return { added, duplicates, skipped: v.skipped, photoDropped: v.photoDropped + photoFailed, catAdded };
}

async function importBackupFile(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (e) {
        toast('ファイルを読み込めませんでした（JSON 形式ではありません）。', { type: 'error' });
        return;
    }
    const v = validateBackup(data);
    if (!v.ok) { toast(v.error, { type: 'error', duration: 8000 }); return; }
    try {
        const r = await mergeBackup(v);
        await updateFilterDropdown();
        await loadSavedMemos();
        const extra = [r.skipped ? `不正 ${r.skipped}件` : '', r.photoDropped ? `写真なしで取込 ${r.photoDropped}件` : ''].filter(Boolean).join(' / ');
        toast(`読み込み完了: 追加 ${r.added}件 / 重複のためスキップ ${r.duplicates}件${extra ? ' / ' + extra : ''}`, { type: 'ok', duration: 9000 });
        refreshSettingsUi();
    } catch (e) {
        reportDbError(e, 'バックアップの読み込み');
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const stamp = () => dateToInput(new Date());

// ---- 他のアプリで使える形式（写真は含まない）----
function xmlEscape(s) {
    return String(s ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '') // XML で使えない制御文字
        .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function isoOf(m) {
    const d = memoDate(m);
    return (Number.isNaN(d.getTime()) ? new Date(0) : d).toISOString();
}
function shortName(m) { return String(m.comment || '').replace(/\s+/g, ' ').slice(0, 40) || 'メモ'; }

function buildGeoJSON(memos) {
    return {
        type: 'FeatureCollection',
        features: memos.map((m) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [Number(m.lng), Number(m.lat)] }, // GeoJSON は 経度, 緯度 の順
            properties: {
                name: shortName(m), comment: m.comment, category: m.category || '',
                date: isoOf(m), favorite: !!m.favorite, rating: clampRating(m.rating)
            }
        }))
    };
}
function buildGPX(memos) {
    const wpts = memos.map((m) => `  <wpt lat="${Number(m.lat)}" lon="${Number(m.lng)}">
    <time>${isoOf(m)}</time>
    <name>${xmlEscape(shortName(m))}</name>
    <desc>${xmlEscape(m.comment)}${m.category ? xmlEscape(`（${m.category}）`) : ''}</desc>
  </wpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="地図メモ" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n</gpx>\n`;
}
function buildKML(memos) {
    const pms = memos.map((m) => `    <Placemark>
      <name>${xmlEscape(shortName(m))}</name>
      <description>${xmlEscape(m.comment)}${m.category ? xmlEscape(`（${m.category}）`) : ''}</description>
      <TimeStamp><when>${isoOf(m)}</when></TimeStamp>
      <Point><coordinates>${Number(m.lng)},${Number(m.lat)},0</coordinates></Point>
    </Placemark>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>地図メモ</name>\n${pms}\n  </Document>\n</kml>\n`;
}

async function exportAs(kind) {
    try {
        if (kind === 'json') {
            const backup = await buildBackup();
            downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `map-memo-backup-${stamp()}.json`);
            toast(`バックアップを書き出しました（${backup.memos.length}件）。`, { type: 'ok' });
            return;
        }
        const memos = await db.memos.toArray();
        if (memos.length === 0) { toast('書き出すメモがありません。', { type: 'warn' }); return; }
        if (kind === 'geojson') downloadBlob(new Blob([JSON.stringify(buildGeoJSON(memos), null, 2)], { type: 'application/geo+json' }), `map-memo-${stamp()}.geojson`);
        else if (kind === 'gpx') downloadBlob(new Blob([buildGPX(memos)], { type: 'application/gpx+xml' }), `map-memo-${stamp()}.gpx`);
        else if (kind === 'kml') downloadBlob(new Blob([buildKML(memos)], { type: 'application/vnd.google-earth.kml+xml' }), `map-memo-${stamp()}.kml`);
        toast(`${kind.toUpperCase()} を書き出しました（写真は含まれません）。`, { type: 'ok' });
    } catch (e) {
        console.error(e);
        toast('書き出しに失敗しました: ' + e.message, { type: 'error' });
    }
}

// ==========================================
// 17. 設定画面（容量・バックアップ・表示・アプリ）
// ==========================================
const settingsModal = $('settings-modal');

function formatBytes(n) {
    if (!Number.isFinite(n)) return '―';
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function refreshStorageInfo() {
    const el = $('storage-info'), bar = $('storage-bar');
    if (!el) return;
    let line = '';
    try {
        const [memoCount, tileCount] = await Promise.all([db.memos.count(), db.tiles.count()]);
        line = `メモ ${memoCount}件 ／ 保存済みの地図 ${tileCount}枚`;
        if (navigator.storage && navigator.storage.estimate) {
            const { usage, quota } = await navigator.storage.estimate();
            if (quota) {
                const ratio = usage / quota;
                line += `<br>使用中: ${formatBytes(usage)} ／ 利用可能の目安: ${formatBytes(quota)}（${(ratio * 100).toFixed(1)}%）`;
                if (bar) { bar.value = Math.min(1, ratio); bar.hidden = false; }
            }
        }
        if (navigator.storage && navigator.storage.persisted) {
            const p = await navigator.storage.persisted();
            line += `<br>自動削除からの保護: ${p ? 'あり' : 'なし（容量が不足すると、ブラウザがデータを消す場合があります）'}`;
        }
    } catch (e) { line = '容量を取得できませんでした。'; }
    el.innerHTML = line;
}

async function checkStorageWarning() {
    try {
        if (!(navigator.storage && navigator.storage.estimate)) return;
        const { usage, quota } = await navigator.storage.estimate();
        if (quota && usage / quota > 0.8) {
            toast('保存容量が残り少なくなっています。設定から不要な地図データを削除できます。', {
                type: 'warn', duration: 10000, action: { label: '設定を開く', onClick: () => openSettings() }
            });
        }
    } catch (e) { /* 取得できなければ何もしない */ }
}

function refreshInstallUi() {
    const btn = $('install-btn'), note = $('install-note');
    if (!btn || !note) return;
    btn.hidden = true;
    if (isStandalone()) {
        note.textContent = 'ホーム画面のアプリとして起動しています。';
    } else if (installPrompt) {
        note.textContent = 'ホーム画面に追加すると、アプリのように起動できます。';
        btn.hidden = false;
    } else if (isIOS()) {
        note.textContent = 'iPhone / iPad では、Safari の共有ボタン（□に↑）→「ホーム画面に追加」を選んでください。';
    } else {
        note.textContent = 'ブラウザのメニューの「アプリをインストール」または「ホーム画面に追加」から追加できます（対応ブラウザのみ）。';
    }
}

function refreshSettingsUi() {
    refreshStorageInfo();
    refreshInstallUi();
    if ($('theme-select')) $('theme-select').value = themeSetting;
    if ($('layer-select')) $('layer-select').value = baseLayerId;
    if ($('app-version')) $('app-version').textContent = `バージョン ${APP_VERSION}`;
}

function openSettings() {
    if (!settingsModal) return;
    refreshSettingsUi();
    openModal(settingsModal);
}

async function checkForUpdate() {
    if (!swReg) { toast('オフライン機能（サービスワーカー）が有効でないため、確認できません。', { type: 'warn' }); return; }
    try {
        await swReg.update();
        await sleep(1500);
        if (!(swReg.waiting || swReg.installing)) toast('最新のバージョンです。', { type: 'ok' });
    } catch (e) {
        toast('更新を確認できませんでした（オフラインの可能性があります）。', { type: 'warn' });
    }
}

if ($('settings-btn')) $('settings-btn').addEventListener('click', openSettings);
if (settingsModal) {
    $('settings-close').addEventListener('click', closeModal);
    $('theme-select').addEventListener('change', (e) => setTheme(e.target.value));
    $('layer-select').addEventListener('change', (e) => setBaseLayer(e.target.value, { announce: true }));
    $('export-json-btn').addEventListener('click', () => exportAs('json'));
    $('export-geojson-btn').addEventListener('click', () => exportAs('geojson'));
    $('export-gpx-btn').addEventListener('click', () => exportAs('gpx'));
    $('export-kml-btn').addEventListener('click', () => exportAs('kml'));
    $('import-btn').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) await importBackupFile(file);
    });
    $('clear-tiles-btn').addEventListener('click', async () => {
        if (!confirm('保存した地図（オフライン用）をすべて削除します。メモと写真は削除されません。よろしいですか？')) return;
        try {
            await db.tiles.clear();
            toast('保存した地図を削除しました。', { type: 'ok' });
            refreshStorageInfo();
        } catch (e) { reportDbError(e, '地図の削除'); }
    });
    $('install-btn').addEventListener('click', async () => {
        if (!installPrompt) return;
        const p = installPrompt;
        installPrompt = null;
        try { p.prompt(); await p.userChoice; } catch (e) { /* 無視 */ }
        refreshInstallUi();
    });
    $('update-check-btn').addEventListener('click', checkForUpdate);
}