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
