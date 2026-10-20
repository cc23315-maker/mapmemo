// 自分のファイルを更新したら、この番号を上げると古いキャッシュが破棄されます
const CACHE_NAME = 'map-memo-offline-v11';

// オフライン動作に必須のファイル（1つでも取得できないとインストール失敗にして気づけるようにする）
const REQUIRED_ASSETS = [
    './',
    './index.html',
    './main.js',
    './manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/dexie@3.2.4/dist/dexie.js'
];

// あれば保存する程度のファイル（取得に失敗してもインストールは続行）
const OPTIONAL_ASSETS = [
    './icon-192.png',
    './icon-512.png',
    // Leaflet のピン画像・レイヤーアイコン（無いとオフラインでピンが表示されない）
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/layers.png',
    'https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png',
    // ピンのまとめ表示（無くても通常のピン表示に切り替わるため「あれば保存」の扱い。初回に開いたときにも自動で保存される）
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await cache.addAll(REQUIRED_ASSETS);
            await Promise.allSettled(OPTIONAL_ASSETS.map((url) => cache.add(url)));
        })
        // ここで skipWaiting() は呼ばない。新しい版は「待機」状態になり、利用者が画面の
        // 「更新する」を押したとき（下の message）に切り替わる。作業中に突然入れ替わるのを防ぐため。
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

// 自分のファイル: ネットワーク優先（更新がすぐ反映される）。圏外・遅い回線ではキャッシュを使う
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timer);
        if (response && response.status === 200) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
            const fallback = await cache.match('./index.html');
            if (fallback) return fallback;
        }
        return Response.error();
    }
}

// 外部ライブラリ（unpkg）: キャッシュ優先
async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response && (response.status === 200 || response.type === 'opaque')) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (e) {
        return Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // 地図タイル（OSM・国土地理院）は main.js が IndexedDB に保存するため、ここでは扱わない
    // （二重保存による容量の浪費を防ぐ）。検索・施設情報の API も対象外。
    if (url.hostname.endsWith('tile.openstreetmap.org') ||
        url.hostname.endsWith('cyberjapandata.gsi.go.jp') || // 国土地理院タイルも main.js が保存する
        url.hostname.includes('overpass') ||
        url.hostname.includes('nominatim')) {
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request));
    } else if (url.hostname === 'unpkg.com') {
        event.respondWith(cacheFirst(request));
    }
});