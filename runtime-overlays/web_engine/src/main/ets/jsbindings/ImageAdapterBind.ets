// ImageAdapterBind - registers ImageAdapter into the AKI framework.
//
// The binding names are the runtime keys the Node main process passes to
// systemPreferences.callArkTSFunction(); they deliberately carry no prefix any
// prebuilt native wrapper knows, so they resolve through the generic ArkTS
// lookup rather than a compiled per-name entry point.

import JsBindingUtils from '../utils/JsBindingUtils';
import Inject from '../common/InjectModule';
import lazy { ImageAdapter } from '../adapter/ImageAdapter';

/** Get or create ImageAdapter singleton */
function implImageAdapter(): ImageAdapter {
  return Inject.getOrCreate(ImageAdapter);
}

function platformFormats(): string {
  return implImageAdapter().platformFormats();
}

async function convert(requestJson: string): Promise<string> {
  return await implImageAdapter().convert(requestJson);
}

export class ImageAdapterBind {
  static bind() {
    JsBindingUtils.bindFunction("HarmonyImage.PlatformFormats", platformFormats);
    JsBindingUtils.bindFunction("HarmonyImage.Convert", convert);
  }
}
