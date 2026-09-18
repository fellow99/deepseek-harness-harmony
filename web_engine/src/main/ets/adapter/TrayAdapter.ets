// TrayAdapter - HarmonyOS status-bar (tray) integration for the Electron side.
//
// The runtime already ships a statusBarView extension ability plus a
// StatusBarManagerAdapter, but that adapter's binding surface takes up to eight
// parameters including a raw pixel buffer and function callbacks, while the
// generic ArkTS bridge marshals at most three primitive arguments. This adapter is
// therefore a facade with a string-in / string-out shape: the Node main process
// sends one JSON request and reads back one JSON outcome.
//
// The two facts that make the sync shape possible: statusBarManager.addToStatusBar
// throws BusinessError synchronously (so the error code is available immediately),
// and both image.createImageSource(ArrayBuffer) and ImageSource.createPixelMapSync
// are synchronous.

import { injectable, inject } from 'inversify';
import { statusBarManager } from '@kit.DeskTopExtensionKit';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';
import { bundleManager, common, Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import emitter from '@ohos.events.emitter';

import { BaseAdapter } from '../common/BaseAdapter';
import LogUtil from '../utils/LogUtil';
import { ContextAdapter } from './ContextAdapter';

const TAG: string = 'TrayAdapter';

/** The module that hosts the tray's quick-operation extension ability. */
const APP_MODULE: string = 'electron';
/** Main ability, raised when the tray icon is left-clicked. */
const MAIN_ABILITY: string = 'EntryAbility';
/** The statusBarView extension ability declared in module.json5. */
const STATUS_BAR_VIEW_ABILITY: string = 'StatusBarEntryAbility';

/** Menu commands the tray understands, mirroring what the caller sends. */
const CMD_SHOW_WINDOW: number = 1;
const CMD_QUIT: number = 2;

/** One context-menu node, as sent by the caller. */
interface MenuNode {
  commandId: number;
  label: string;
  submenu?: MenuNode[];
}

/** Tray setup request, carried as JSON so the bridge stays string-typed. */
interface SetupRequest {
  title?: string;
  tooltips?: string;
  /**
   * Raw BGRA_8888 pixels, base64-encoded, plus their dimensions. This mirrors how
   * the runtime's own StatusBarManagerAdapter builds the icon (raw buffer +
   * explicit InitializationOptions) and is the preferred input.
   */
  iconRawBase64?: string;
  iconWidth?: number;
  iconHeight?: number;
  /** Fallback: a base64 PNG, decoded with default options. */
  iconBase64?: string;
  /**
   * quickOperation window height. Qt's OHOS platform plugin uses 300.
   */
  quickOperationHeight?: number;
  /**
   * Name of the StatusBarViewExtensionAbility that hosts the left-click popup.
   * Both Qt's OHOS plugin and the runtime's own StatusBarManagerAdapter pass an
   * EMPTY string here, so that is the default.
   */
  quickOperationAbilityName?: string;
  /**
   * quickOperation moduleName. Qt's OHOS plugin omits the field entirely, so it
   * is omitted here too unless the caller sets it.
   */
  quickOperationModuleName?: string;
  /**
   * PixelMapFormat for the raw-icon path (default BGRA_8888, which is what the
   * runtime's own adapter uses).
   */
  iconPixelFormat?: number;
  menu?: MenuNode[];
}

/** Tray state, carried back as JSON for the same reason. */
interface TrayOutcome {
  ok: boolean;
  stage: string;
  created: boolean;
  menuItems: number;
  errorCode: number;
  message: string;
  /**
   * What the icon PixelMap ACTUALLY turned out to be, read back from the object
   * that is handed to the framework. Reported because a PixelMap whose real
   * dimensions differ from the requested ones would be marshalled with the wrong
   * size and fail the IPC write, which is the failure being investigated.
   */
  iconWidth: number;
  iconHeight: number;
  iconBytes: number;
}

@injectable()
export class TrayAdapter extends BaseAdapter {
  private ctxAdapter: ContextAdapter;
  private created: boolean = false;
  private stage: string = 'idle';
  private errorCode: number = 0;
  private message: string = '';
  private menuItems: number = 0;
  private iconWidth: number = 0;
  private iconHeight: number = 0;
  private iconBytes: number = 0;

  constructor(
    @inject(ContextAdapter) ctxAdapter: ContextAdapter
  ) {
    super();
    this.ctxAdapter = ctxAdapter;
  }

  /**
   * Install the tray icon, its hover text and its context menu.
   * Idempotent: a second call after success is reported, not retried.
   * @param requestJson - JSON SetupRequest.
   * @returns JSON TrayOutcome. Never throws.
   */
  setup(requestJson: string): string {
    let request: SetupRequest;
    try {
      request = JSON.parse(requestJson) as SetupRequest;
    } catch (err) {
      return this.fail('parse', err);
    }

    if (this.created) {
      return this.finish(true, 'already-created');
    }

    const context: common.Context | undefined = this.ctxAdapter.getActiveContext();
    if (context === undefined) {
      return this.fail('context', new Error('no active context bound yet'));
    }

    let icon: image.PixelMap;
    try {
      icon = this.buildIcon(request);
    } catch (err) {
      return this.fail('icon', err);
    }

    // Read back what the PixelMap ACTUALLY is. The framework marshals this object
    // rather than the requested width/height, so a mismatch here is the first
    // thing to look at for the "size of the pixelmap exceeds the limit" failure.
    try {
      const info: image.ImageInfo = icon.getImageInfoSync();
      this.iconWidth = info.size.width;
      this.iconHeight = info.size.height;
      this.iconBytes = icon.getPixelBytesNumber();
      LogUtil.info(
        TAG,
        `icon readback: ${this.iconWidth}x${this.iconHeight}, bytes=${this.iconBytes},`
        + ` rowBytes=${icon.getBytesNumberPerRow()}, requested=${request.iconWidth}x${request.iconHeight}`
      );
    } catch (err) {
      LogUtil.error(TAG, `icon readback failed: ${this.describe(err)}`);
    }

    try {
      const menus: statusBarManager.StatusBarMenuItem[] = this.buildMenu(request.menu);
      const quickOperation: statusBarManager.QuickOperation = {
        title: request.title ?? 'DeepSeek Harness',
        height: request.quickOperationHeight ?? 300,
        abilityName: request.quickOperationAbilityName ?? '',
      };
      // Qt's OHOS plugin omits moduleName entirely, so only set it on request.
      if (request.quickOperationModuleName !== undefined) {
        quickOperation.moduleName = request.quickOperationModuleName;
      }
      const icons: statusBarManager.StatusBarIcon = { white: icon, black: icon };
      const item: statusBarManager.StatusBarItem = {
        icons: icons,
        quickOperation: quickOperation,
      };
      if (menus.length > 0) {
        item.statusBarGroupMenu = [menus];
      }
      if (request.tooltips !== undefined) {
        item.hoverTips = request.tooltips;
      }
      statusBarManager.addToStatusBar(context, item);
      this.menuItems = menus.length;
      this.registerEvents();
      this.created = true;
      LogUtil.info(TAG, `tray installed, menu items: ${menus.length}`);
      return this.finish(true, 'created');
    } catch (err) {
      return this.fail('addToStatusBar', err);
    }
  }

  /**
   * Report the state of the last attempt, so a caller can verify the install
   * without depending on asynchronous callbacks.
   * @returns JSON TrayOutcome.
   */
  status(): string {
    return JSON.stringify(this.outcome(this.stage === 'created' || this.stage === 'already-created'));
  }

  /**
   * Remove the tray icon and detach its listeners.
   * @returns JSON TrayOutcome. Never throws.
   */
  remove(): string {
    const context: common.Context | undefined = this.ctxAdapter.getActiveContext();
    if (context === undefined) {
      return this.fail('context', new Error('no active context bound yet'));
    }
    try {
      if (this.created) {
        statusBarManager.removeFromStatusBar(context);
      }
      statusBarManager.off('statusBarIconClick');
      statusBarManager.off('rightMenuClick');
      this.created = false;
      this.menuItems = 0;
      return this.finish(true, 'removed');
    } catch (err) {
      return this.fail('removeFromStatusBar', err);
    }
  }

  /**
   * Build the icon PixelMap. Prefers raw BGRA_8888 bytes with explicit dimensions
   * -- the same construction the runtime's own StatusBarManagerAdapter uses, and
   * therefore the one the framework's icon path is written against. Falls back to
   * decoding a PNG when only that was supplied.
   * @param request - setup request.
   * @returns the icon pixel map.
   */
  private buildIcon(request: SetupRequest): image.PixelMap {
    if (request.iconRawBase64 !== undefined
      && request.iconWidth !== undefined
      && request.iconHeight !== undefined) {
      const helper: util.Base64Helper = new util.Base64Helper();
      const raw: Uint8Array = helper.decodeSync(request.iconRawBase64);
      const format: image.PixelMapFormat = request.iconPixelFormat === undefined
        ? image.PixelMapFormat.BGRA_8888
        : request.iconPixelFormat as image.PixelMapFormat;
      const options: image.InitializationOptions = {
        editable: false,
        pixelFormat: format,
        size: { width: request.iconWidth, height: request.iconHeight },
      };
      return image.createPixelMapSync(this.exactBuffer(raw), options);
    }
    if (request.iconBase64 !== undefined) {
      return this.decodeIcon(request.iconBase64);
    }
    throw new Error('iconRawBase64 + iconWidth/iconHeight (or iconBase64) is required');
  }

  /**
   * Return an ArrayBuffer holding exactly the view's bytes.
   * Base64Helper.decodeSync hands back a Uint8Array whose backing buffer can be
   * larger than the data itself; passing that whole buffer to createImageSource
   * or createPixelMapSync would let the decoder see trailing bytes -- exactly the
   * kind of size mismatch this adapter must avoid, given the framework reports
   * the failure as "the size of the pixelmap exceeds the limit".
   * @param bytes - decoded view.
   * @returns an ArrayBuffer of exactly bytes.byteLength.
   */
  private exactBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy: Uint8Array = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  /**
   * Decode a base64 PNG into the PixelMap the status bar expects.
   * @param base64 - base64 text of a PNG image.
   * @returns decoded pixel map.
   */
  private decodeIcon(base64: string): image.PixelMap {
    const helper: util.Base64Helper = new util.Base64Helper();
    const bytes: Uint8Array = helper.decodeSync(base64);
    const source: image.ImageSource = image.createImageSource(this.exactBuffer(bytes));
    return source.createPixelMapSync();
  }

  /**
   * Translate caller-supplied menu nodes into status bar menu items.
   * Every item carries a notifyOnly action so clicks come back as events rather
   * than launching an ability.
   * @param nodes - menu nodes, or undefined for no menu.
   * @returns menu items in a single group.
   */
  private buildMenu(nodes: MenuNode[] | undefined): statusBarManager.StatusBarMenuItem[] {
    const items: statusBarManager.StatusBarMenuItem[] = [];
    if (nodes === undefined) {
      return items;
    }
    nodes.forEach((node: MenuNode) => {
      const action: statusBarManager.StatusBarMenuAction = {
        abilityName: STATUS_BAR_VIEW_ABILITY,
        moduleName: APP_MODULE,
        notifyOnly: true,
      };
      const item: statusBarManager.StatusBarMenuItem = {
        title: node.label,
        menuAction: action,
        menuCode: `${node.commandId}`,
      };
      if (node.submenu !== undefined && node.submenu.length > 0) {
        const subs: statusBarManager.StatusBarSubMenuItem[] = [];
        node.submenu.forEach((sub: MenuNode) => {
          const subAction: statusBarManager.StatusBarMenuAction = {
            abilityName: STATUS_BAR_VIEW_ABILITY,
            moduleName: APP_MODULE,
            notifyOnly: true,
          };
          const subItem: statusBarManager.StatusBarSubMenuItem = {
            subTitle: sub.label,
            menuAction: subAction,
            menuCode: `${sub.commandId}`,
          };
          subs.push(subItem);
        });
        item.subMenu = subs;
      }
      items.push(item);
    });
    return items;
  }

  /** Attach the click listeners. Called once, right after a successful install. */
  private registerEvents(): void {
    statusBarManager.on('statusBarIconClick', (eventData: emitter.EventData) => {
      LogUtil.info(TAG, 'status bar icon clicked');
      this.showMainWindow();
    });
    statusBarManager.on('rightMenuClick', (eventData: emitter.EventData) => {
      LogUtil.info(TAG, `right menu clicked. menuCode: ${eventData?.data?.menuCode}`);
      this.dispatch(Number(eventData?.data?.menuCode));
    });
  }

  /**
   * Act on a context-menu command.
   * @param command - numeric command id, or NaN when the event carried none.
   */
  private dispatch(command: number): void {
    if (Number.isNaN(command)) {
      return;
    }
    if (command === CMD_SHOW_WINDOW) {
      this.showMainWindow();
    } else if (command === CMD_QUIT) {
      this.quit();
    }
  }

  /** Raise the main window by starting EntryAbility again. */
  private showMainWindow(): void {
    try {
      const context: common.Context | undefined = this.ctxAdapter.getActiveContext();
      if (context === undefined) {
        return;
      }
      const info: bundleManager.BundleInfo = bundleManager.getBundleInfoForSelfSync(
        bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
      const want: Want = {
        bundleName: info.name,
        moduleName: APP_MODULE,
        abilityName: MAIN_ABILITY,
      };
      const abilityContext: common.UIAbilityContext = context as common.UIAbilityContext;
      abilityContext.startAbility(want).catch((err: BusinessError) => {
        LogUtil.error(TAG, `startAbility failed: ${err.message}`);
      });
    } catch (err) {
      LogUtil.error(TAG, `showMainWindow failed: ${this.describe(err)}`);
    }
  }

  /**
   * End the whole application. Electron lives in the same process group as the
   * abilities, so killing every process is a real quit rather than a window close.
   */
  private quit(): void {
    try {
      const context: common.Context | undefined = this.ctxAdapter.getActiveContext();
      if (context === undefined) {
        return;
      }
      context.getApplicationContext().killAllProcesses().catch((err: BusinessError) => {
        LogUtil.error(TAG, `killAllProcesses failed: ${err.message}`);
      });
    } catch (err) {
      LogUtil.error(TAG, `quit failed: ${this.describe(err)}`);
    }
  }

  /** @param ok - whether the last attempt succeeded. @returns JSON snapshot. */
  private outcome(ok: boolean): TrayOutcome {
    return {
      ok: ok,
      stage: this.stage,
      created: this.created,
      menuItems: this.menuItems,
      errorCode: this.errorCode,
      message: this.message,
      iconWidth: this.iconWidth,
      iconHeight: this.iconHeight,
      iconBytes: this.iconBytes,
    };
  }

  /**
   * Record a successful stage.
   * @param ok - whether the attempt succeeded.
   * @param stage - stage name.
   * @returns JSON TrayOutcome.
   */
  private finish(ok: boolean, stage: string): string {
    this.stage = stage;
    if (ok) {
      this.errorCode = 0;
      this.message = '';
    }
    return JSON.stringify(this.outcome(ok));
  }

  /**
   * Record a failed stage, keeping the platform error code so the caller can tell
   * "device does not support this" from "our arguments were wrong".
   * @param stage - stage name.
   * @param err - whatever was thrown.
   * @returns JSON TrayOutcome.
   */
  private fail(stage: string, err: Object): string {
    this.stage = stage;
    this.errorCode = this.errorCodeOf(err);
    this.message = this.describe(err);
    LogUtil.error(TAG, `${stage} failed: ${this.message}`);
    return JSON.stringify(this.outcome(false));
  }

  /** @param err - thrown value. @returns its BusinessError code, or zero. */
  private errorCodeOf(err: Object): number {
    const business: BusinessError = err as BusinessError;
    if (typeof business.code === 'number') {
      return business.code;
    }
    return 0;
  }

  /** @param err - thrown value. @returns readable text for logs and outcomes. */
  private describe(err: Object): string {
    const business: BusinessError = err as BusinessError;
    if (typeof business.message === 'string') {
      return `${business.code}: ${business.message}`;
    }
    return `${err}`;
  }
}
