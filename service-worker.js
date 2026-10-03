/* 问答知识库 · Service Worker（网络优先版）
 *
 * 为什么要改：
 *   旧版是「缓存优先」—— install 时把 index.html 存进 cache，
 *   之后每次打开都直接返回缓存里的那份。结果是：你更新了网页，
 *   自己却永远看到旧版（Ctrl+F5 也没用，因为 SW 在更前面拦截）。
 *   而且旧版还缓存了早已不用的 Font Awesome CDN 文件。
 *
 * 本版策略：
 *   1. 只接管「同源」请求；api.github.com / raw.githubusercontent.com 等
 *      跨域请求一律不拦截，云同步不受影响。
 *   2. 页面导航（HTML）走「网络优先」—— 永远先拿最新的，断网才回落到缓存。
 *   3. 静态资源（图标等）走「缓存优先 + 后台更新」，省流量。
 *   4. 版本号变了就清掉所有旧缓存。
 *
 * 改了文件内容后，把 CACHE_VERSION 加一（v2 → v3），否则老用户可能还吃旧缓存。
 */
const CACHE_VERSION = 'qa-notebook-v2';
const CORE_ASSETS = ['./', './index.html', './manifest.json'];

/* ---------- 安装：预缓存核心文件 ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // 用 addAll 会因为某个文件 404 而整体失败，这里逐个加、失败不影响其它
      return Promise.all(
        CORE_ASSETS.map(function (url) {
          return cache.add(url).catch(function () { /* 忽略单个失败 */ });
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

/* ---------- 激活：清掉旧版本缓存并立即接管 ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.map(function (n) { return n === CACHE_VERSION ? null : caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

/* ---------- 拦截规则 ---------- */
self.addEventListener('fetch', function (event) {
  const req = event.request;

  // 只处理 GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ★ 关键：跨域（GitHub API、raw 内容、任何第三方）一律放行，不缓存
  if (url.origin !== self.location.origin) return;

  // 页面导航 → 网络优先，断网回落缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 其它同源静态资源 → 缓存优先 + 后台更新
  event.respondWith(
    caches.match(req).then(function (hit) {
      const fetching = fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fetching;
    })
  );
});
