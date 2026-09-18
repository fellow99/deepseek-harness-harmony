// TrayAdapterBind - registers TrayAdapter into the AKI framework.
//
// The binding names are the runtime keys the Node main process passes to
// systemPreferences.callArkTSFunction(). Like the image bridge, they carry no
// prefix any prebuilt native wrapper knows, so they resolve through the generic
// ArkTS lookup rather than a compiled per-name entry point.

import JsBindingUtils from '../utils/JsBindingUtils';
import Inject from '../common/InjectModule';
import lazy { TrayAdapter } from '../adapter/TrayAdapter';

/** Get or create TrayAdapter singleton */
function implTrayAdapter(): TrayAdapter {
  return Inject.getOrCreate(TrayAdapter);
}

function setup(requestJson: string): string {
  return implTrayAdapter().setup(requestJson);
}

function status(): string {
  return implTrayAdapter().status();
}

function remove(): string {
  return implTrayAdapter().remove();
}

export class TrayAdapterBind {
  static bind() {
    JsBindingUtils.bindFunction("HarmonyTray.Setup", setup);
    JsBindingUtils.bindFunction("HarmonyTray.Status", status);
    JsBindingUtils.bindFunction("HarmonyTray.Remove", remove);
  }
}
