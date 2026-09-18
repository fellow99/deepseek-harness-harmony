// ImageAdapter - HarmonyOS image decode / resize / re-encode for the Electron side.
//
// The runtime carries no libvips build for aarch64, so the `sharp` module is a
// pure-JS stub that can read container headers but cannot touch pixels. This
// adapter performs the real work with the platform image framework and is
// reached from the Node main process through the generic ArkTS bridge
// (`systemPreferences.callArkTSFunction`). Every entry point takes and returns a
// JSON string because that bridge marshals only primitive and array types.

import { injectable } from 'inversify';

import { image } from '@kit.ImageKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { BaseAdapter } from '../common/BaseAdapter';
import LogUtil from '../utils/LogUtil';

const TAG: string = 'ImageAdapter';

/** Output buffer reserved for one encode; the framework default is only 10 MiB. */
const PACK_BUFFER_BYTES: number = 32 * 1024 * 1024;

/** One conversion request, carried as JSON so the bridge stays string-typed. */
interface ConvertRequest {
  source: string;
  target: string;
  format: string;
  quality: number;
  maxWidth: number;
  maxHeight: number;
}

/** One conversion outcome, carried as JSON for the same reason. */
interface ConvertOutcome {
  ok: boolean;
  error: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
}

/** MIME formats this platform can decode and encode. */
interface PlatformFormats {
  decode: Array<string>;
  encode: Array<string>;
}

/** EXIF orientation to clockwise rotation degrees; mirrored values are refused. */
const ORIENTATION_ROTATION: Map<number, number> = new Map<number, number>([
  [1, 0],
  [3, 180],
  [6, 90],
  [8, 270],
]);

@injectable()
export class ImageAdapter extends BaseAdapter {

  /**
   * Report the platform decode and encode formats, so a caller can decide
   * whether a conversion is possible before submitting one.
   * @returns JSON PlatformFormats
   */
  platformFormats(): string {
    const formats: PlatformFormats = { decode: [], encode: [] };
    try {
      formats.decode = image.getImageSourceSupportedFormats();
    } catch (err) {
      LogUtil.error(TAG, `decode format probe failed: ${(err as BusinessError).message}`);
    }
    try {
      formats.encode = image.getImagePackerSupportedFormats();
    } catch (err) {
      LogUtil.error(TAG, `encode format probe failed: ${(err as BusinessError).message}`);
    }
    return JSON.stringify(formats);
  }

  /**
   * Decode one image file, scale it to fit the requested bounds, apply its EXIF
   * orientation, and write the re-encoded bytes to the target path.
   * @param requestJson - JSON ConvertRequest naming both paths and the output format.
   * @returns JSON ConvertOutcome; `ok` is false with a reason for every failure.
   */
  async convert(requestJson: string): Promise<string> {
    const outcome: ConvertOutcome = { ok: false, error: '', width: 0, height: 0, bytes: 0, format: '' };

    let request: ConvertRequest;
    try {
      request = JSON.parse(requestJson) as ConvertRequest;
    } catch (err) {
      outcome.error = `request is not valid JSON: ${(err as BusinessError).message}`;
      return JSON.stringify(outcome);
    }

    let source: image.ImageSource | undefined = undefined;
    let pixelMap: image.PixelMap | undefined = undefined;
    let packer: image.ImagePacker | undefined = undefined;
    try {
      source = image.createImageSource(request.source);
      if (source === undefined) {
        outcome.error = `cannot open "${request.source}" as an image source`;
        return JSON.stringify(outcome);
      }
      const info: image.ImageInfo = source.getImageInfoSync();
      const rotation: number = await this.readRotation(source);
      const bounds: image.Size = this.fit(info.size.width, info.size.height, request.maxWidth, request.maxHeight);
      const options: image.DecodingOptions = {
        desiredSize: { width: bounds.width, height: bounds.height },
        rotate: rotation,
        editable: false,
      };
      pixelMap = await source.createPixelMap(options);
      packer = image.createImagePacker();
      const packing: image.PackingOption = {
        format: request.format,
        quality: request.quality,
        bufferSize: PACK_BUFFER_BYTES,
      };
      const encoded: ArrayBuffer = await packer.packToData(pixelMap, packing);
      const bytes: Uint8Array = new Uint8Array(encoded);
      this.writeFile(request.target, bytes);
      outcome.ok = true;
      outcome.width = pixelMap.getImageInfoSync().size.width;
      outcome.height = pixelMap.getImageInfoSync().size.height;
      outcome.bytes = bytes.byteLength;
      outcome.format = request.format;
    } catch (err) {
      outcome.error = `conversion failed: ${(err as BusinessError).message}`;
      LogUtil.error(TAG, outcome.error);
    } finally {
      if (pixelMap !== undefined) {
        await pixelMap.release();
      }
      if (source !== undefined) {
        await source.release();
      }
      if (packer !== undefined) {
        await packer.release();
      }
    }
    return JSON.stringify(outcome);
  }

  /**
   * Resolve the clockwise rotation that EXIF orientation requires.
   * @param source - opened image source.
   * @returns rotation in degrees; zero when the file carries no orientation.
   * @throws when the file needs a mirrored transform, which this adapter does not apply.
   */
  private async readRotation(source: image.ImageSource): Promise<number> {
    let raw: string = '';
    try {
      raw = await source.getImageProperty(image.PropertyKey.ORIENTATION);
    } catch (err) {
      return 0;
    }
    const value: number = Number.parseInt(raw, 10);
    if (Number.isNaN(value) || value <= 1) {
      return 0;
    }
    const rotation: number | undefined = ORIENTATION_ROTATION.get(value);
    if (rotation === undefined) {
      throw new Error(`EXIF orientation ${value} needs a mirrored transform, which the OHOS image bridge does not apply`);
    }
    return rotation;
  }

  /**
   * Scale dimensions down to fit the requested bounds, preserving aspect ratio.
   * @param width - decoded width.
   * @param height - decoded height.
   * @param maxWidth - bound on the width, or zero for no bound.
   * @param maxHeight - bound on the height, or zero for no bound.
   * @returns target size, never enlarged.
   */
  private fit(width: number, height: number, maxWidth: number, maxHeight: number): image.Size {
    let scale: number = 1;
    if (maxWidth > 0 && width > maxWidth) {
      scale = Math.min(scale, maxWidth / width);
    }
    if (maxHeight > 0 && height > maxHeight) {
      scale = Math.min(scale, maxHeight / height);
    }
    if (scale >= 1) {
      return { width: width, height: height };
    }
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
    };
  }

  /**
   * Write encoded bytes to a path, replacing any previous file.
   * @param path - target path.
   * @param bytes - complete encoded image.
   */
  private writeFile(path: string, bytes: Uint8Array): void {
    const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(file.fd, bytes.buffer);
    } finally {
      fs.closeSync(file);
    }
  }
}
