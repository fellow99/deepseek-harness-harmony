// tray-scan.js -- drive the tray bridge through a parameter matrix and report
// what the framework actually saw.
//
// WHY THIS EXISTS
//   The tray wiring is proven reachable (addToStatusBar reports success and the
//   menu registers) but no icon renders, and the framework logs
//   "The size of the pixelmap exceeds the limit." plus `writeEndEvent error`
//   (an IPC parcel write failure). Dimensions (4x4..200x200), pixel format,
//   quickOperation.abilityName and quickOperation.moduleName have all been ruled
//   out by hand. TrayAdapter is parameterised for exactly these knobs, so the
//   remaining sweep needs no rebuild -- only this driver.
//
//   It also reads back the PixelMap the adapter actually handed over
//   (iconWidth / iconHeight / iconBytes from TrayAdapter.Status), which is the
//   cheapest way to catch a pixelmap whose real size differs from the requested
//   one.
//
// USAGE
//   hdc fport tcp:19229 tcp:9229
//   node scripts/probes/tray-scan.js "$(curl -s http://127.0.0.1:19229/json/list | ... ws url ...)"
//   # or, with the helper used elsewhere in this project:
//   node scripts/probes/tray-scan.js "$(node -e "const h=require('node:http');h.get('http://127.0.0.1:19229/json/list',r=>{let s='';r.on('data',d=>s+=d);r.on('end',()=>console.log(JSON.parse(s)[0].webSocketDebuggerUrl))})")"
//
// After each variant, check the device log for the framework's own verdict:
//   hdc shell "hilog -x" | Select-String 'pixelmap exceeds|addToStatusBar|writeEndEvent'
// and take a screenshot to see whether an icon appeared.

'use strict';

const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error('usage: node tray-scan.js <ws-url>');
  process.exit(2);
}

// Runs INSIDE the Electron main process (full Node + require('electron')).
const expression = `
(async () => {
  const { systemPreferences } = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');

  const call = async (name, args) => {
    const r = await systemPreferences.callArkTSFunction(name, 'string', args);
    return r && typeof r === 'object' && 'value' in r ? r.value : JSON.stringify(r);
  };

  // Solid white BGRA_8888; 255 in every byte keeps alpha opaque.
  const rawBgra = (w, h) => Buffer.alloc(w * h * 4, 255).toString('base64');

  const base = {
    title: 'DSH scan',
    tooltips: 'DSH scan',
    quickOperationHeight: 300,
    iconRawBase64: rawBgra(16, 16),
    iconWidth: 16,
    iconHeight: 16,
    menu: [{ commandId: 1, label: 'Show' }, { commandId: 2, label: 'Quit' }],
  };

  let pngBase64 = null;
  try {
    pngBase64 = fs.readFileSync(path.join(process.resourcesPath, 'app', 'electron_white.png')).toString('base64');
  } catch (e) { /* reported below */ }

  const variants = [
    ['baseline 16x16 BGRA_8888', base],
    ['abilityName = StatusBarEntryAbility', Object.assign({}, base, { quickOperationAbilityName: 'StatusBarEntryAbility' })],
    ['moduleName = electron', Object.assign({}, base, { quickOperationModuleName: 'electron' })],
    ['pixelFormat = RGBA_8888(3)', Object.assign({}, base, { iconPixelFormat: 3 })],
    ['pixelFormat = RGB_565(2)', Object.assign({}, base, { iconPixelFormat: 2 })],
    ['icon 24x24', Object.assign({}, base, { iconRawBase64: rawBgra(24, 24), iconWidth: 24, iconHeight: 24 })],
    ['icon 48x48', Object.assign({}, base, { iconRawBase64: rawBgra(48, 48), iconWidth: 48, iconHeight: 48 })],
    ['icon 200x200', Object.assign({}, base, { iconRawBase64: rawBgra(200, 200), iconWidth: 200, iconHeight: 200 })],
    ['no menu', Object.assign({}, base, { menu: [] })],
    ['no tooltips', Object.assign({}, base, { tooltips: undefined })],
  ];
  if (pngBase64) {
    variants.push(['PNG decode path (bundled 200x200)', Object.assign({}, base, {
      iconRawBase64: undefined, iconBase64: pngBase64,
    })]);
  }

  const results = [];
  for (const pair of variants) {
    const name = pair[0];
    const request = pair[1];
    await call('HarmonyTray.Remove', []);
    const setup = await call('HarmonyTray.Setup', [JSON.stringify(request)]);
    const status = await call('HarmonyTray.Status', []);
    // Only the readback fields matter here; keep the payload small.
    let parsed = null;
    try { parsed = JSON.parse(status); } catch (e) { /* leave null */ }
    results.push({
      variant: name,
      setupOk: (() => { try { return JSON.parse(setup).ok; } catch (e) { return setup; } })(),
      iconReadback: parsed ? (parsed.iconWidth + 'x' + parsed.iconHeight + ' bytes=' + parsed.iconBytes) : status,
      stage: parsed ? parsed.stage : null,
      errorCode: parsed ? parsed.errorCode : null,
    });
  }

  return JSON.stringify({
    pngAvailable: pngBase64 !== null,
    results,
    note: 'check device hilog for pixelmap/writeEndEvent lines and take a screenshot after each variant if you need per-variant visual evidence',
  }, null, 1);
})()
`;

const ws = new WebSocket(wsUrl);
ws.addEventListener('open', () => {
  const send = (method, params) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
  (async () => {
    await send('Runtime.enable', {});
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      includeCommandLineAPI: true,
    });
    console.log(result.exceptionDetails
      ? 'EXCEPTION: ' + (result.exceptionDetails.exception && result.exceptionDetails.exception.description)
      : result.result.value);
    process.exit(0);
  })();
});
ws.addEventListener('error', (e) => {
  console.error('websocket error: ' + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
