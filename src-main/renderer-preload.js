'use strict';
/**
 * 渲染进程 preload —— 在每个页面（含 token 认证 303 跳转后的新文档）的页面脚本之前、
 * 于主世界执行（webPreferences: nodeIntegration + contextIsolation:false）。
 *
 * 两项主世界引导都必须在 dsh 客户端插件 apply() 之前就位，而 apply() 在 index.html
 * 模块脚本加载链中同步求值；dom-ready + executeJavaScript 的注入与之竞争且偏晚，
 * 无法保证先于 apply()，故统一放到 preload（Electron 保证 preload 先于页面脚本）。
 */

// 1) crypto.randomUUID polyfill：鸿蒙 Chromium 的 Web Crypto 可能缺 randomUUID，
//    用 getRandomValues 兜底生成 UUID v4。
try {
  if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID !== 'function') {
    if (typeof globalThis.crypto === 'undefined') {
      globalThis.crypto = {};
    }
    globalThis.crypto.randomUUID = function randomUUID() {
      try {
        var b = globalThis.crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        var h = '';
        for (var i = 0; i < 16; i++) h += b[i].toString(16).padStart(2, '0');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
      } catch (e) {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          var v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
    };
  }
} catch (e) { /* 主世界注入失败时忽略 */ }

// 2) 传输归属声明：宣告“本渲染器即 Host 所有者”。
//    鸿蒙 NEXT 隔离渲染进程访问 127.0.0.1（loopback 网络隔离），webserver 绑定 0.0.0.0，
//    渲染器经局域网 IP 加载页面。dsh 浏览器侧仅凭页面 URL hostname 判定 isLoopback，
//    局域网 IP 被判为非 loopback，settings/credentials/ui-theme 等 Host 持久化 scope 即
//       在浏览器侧置为 unavailable（“设置→模型：加载提供方目录失败: settings are unavailable
//    in this browser”）。本壳 Host 跑在同机 Electron 主进程，且 onBeforeSendHeaders 已把
//    Host/Origin 改写为 127.0.0.1，服务端围栏本就按 loopback 放行。dsh 为“自行组装传输的
//    壳”预留了官方逃生舱 globalThis.__DSH_TRANSPORT__.ownsHost=true（worker 预览页即用此标志），
//    置位后 isLoopback 恒为 true。只设 ownsHost，不提供 fetch/openStream/loadBundle，
//    RPC 与 bundle 仍走默认 HTTP/WebSocket，数据面不变。
try {
  var t = globalThis.__DSH_TRANSPORT__ || (globalThis.__DSH_TRANSPORT__ = {});
  t.ownsHost = true;
} catch (e) { /* 主世界注入失败时忽略，浏览器侧退回非 loopback 判定 */ }

// 3) 强制“在线”状态：鸿蒙 Electron 运行时未给 Chromium 的 NetworkChangeNotifier 喂网络
//    可达信号，navigator.onLine 恒为 false。dsh 客户端连接层（watchBrowserNetwork）启动时
//    读 window.navigator.onLine，false 即令 ConnectionController 挂起，永不打开
//    /api/remote.mux WebSocket，侧栏常驻“连接异常”。本应用数据面是同机进程内 loopback，
//    浏览器“是否能上互联网”的信号在此无意义，故在主世界把 onLine 钉为 true，并屏蔽 offline
//    事件、立即补发一次 online，使连接层正常建链。
try {
  var navProto = Object.getPrototypeOf(globalThis.navigator) || globalThis.Navigator.prototype;
  var onlineDesc = { configurable: true, enumerable: true, get: function () { return true; } };
  if (typeof globalThis.navigator === 'object') {
    Object.defineProperty(globalThis.navigator, 'onLine', onlineDesc);
  }
  if (navProto) {
    var origAdd = globalThis.EventTarget.prototype.addEventListener;
    var origRemove = globalThis.EventTarget.prototype.removeEventListener;
    globalThis.EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type === 'offline') return;
      var ret = origAdd.call(this, type, listener, options);
      if (type === 'online' && typeof listener === 'function') {
        try { listener.call(this, new Event('online')); } catch (e) { /* 立即派发失败时忽略 */ }
      }
      return ret;
    };
    globalThis.EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (type === 'offline') return;
      return origRemove.call(this, type, listener, options);
    };
  }
} catch (e) { /* 主世界注入失败时忽略，连接层退回离线判定 */ }
