// Pure-JS sharp stub body for HarmonyOS aarch64, where no libvips build exists.
//
// The stub parses container headers to report truthful image facts for consumers
// that only need metadata; it performs no decoding, resizing, colour conversion,
// or encoding, so any request that needs real pixels still fails loudly.
//
// Two pixel origins behave differently on purpose. 'raw().toBuffer()' is the
// decode proof admission runs before it trusts a header, so it settles without
// throwing and reports zero bytes. Every other terminal ('toBuffer', 'toFile',
// 'stats') refuses with the concrete boundary that blocked it, because an empty
// result there would be indistinguishable from a completed conversion.
//
// This file is embedded verbatim into both the ESM and CJS sharp entry points by
// scripts/lib/sharp-stub.mjs. It must stay free of require, module.exports,
// imports, backticks, and template interpolation, and its module scope must have
// no side effects. Every reader below bounds itself against the byte length; a
// length field is never used to allocate.

function stubToBytes(input) {
  if (input === undefined || input === null) return undefined;
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return undefined;
}

function stubByteAt(bytes, offset) {
  if (bytes === undefined || offset < 0 || offset >= bytes.length) return -1;
  return bytes[offset];
}

function stubU16BE(bytes, offset) {
  const a = stubByteAt(bytes, offset);
  const b = stubByteAt(bytes, offset + 1);
  if (a < 0 || b < 0) return -1;
  return (a << 8) | b;
}

function stubU16LE(bytes, offset) {
  const a = stubByteAt(bytes, offset);
  const b = stubByteAt(bytes, offset + 1);
  if (a < 0 || b < 0) return -1;
  return a | (b << 8);
}

function stubU24LE(bytes, offset) {
  const a = stubByteAt(bytes, offset);
  const b = stubByteAt(bytes, offset + 1);
  const c = stubByteAt(bytes, offset + 2);
  if (a < 0 || b < 0 || c < 0) return -1;
  return (a | (b << 8) | (c << 16)) >>> 0;
}

function stubU32BE(bytes, offset) {
  const a = stubByteAt(bytes, offset);
  const b = stubByteAt(bytes, offset + 1);
  const c = stubByteAt(bytes, offset + 2);
  const d = stubByteAt(bytes, offset + 3);
  if (a < 0 || b < 0 || c < 0 || d < 0) return -1;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function stubU32LE(bytes, offset) {
  const a = stubByteAt(bytes, offset);
  const b = stubByteAt(bytes, offset + 1);
  const c = stubByteAt(bytes, offset + 2);
  const d = stubByteAt(bytes, offset + 3);
  if (a < 0 || b < 0 || c < 0 || d < 0) return -1;
  return ((d << 24) | (c << 16) | (b << 8) | a) >>> 0;
}

function stubU16(bytes, offset, little) {
  return little ? stubU16LE(bytes, offset) : stubU16BE(bytes, offset);
}

function stubU32(bytes, offset, little) {
  return little ? stubU32LE(bytes, offset) : stubU32BE(bytes, offset);
}

function stubBytesEqual(bytes, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    if (stubByteAt(bytes, offset + index) !== text.charCodeAt(index)) return false;
  }
  return true;
}

function stubFourCC(bytes, offset) {
  const a = stubByteAt(bytes, offset);
  const b = stubByteAt(bytes, offset + 1);
  const c = stubByteAt(bytes, offset + 2);
  const d = stubByteAt(bytes, offset + 3);
  if (a < 0 || b < 0 || c < 0 || d < 0) return '';
  return String.fromCharCode(a, b, c, d);
}

// Skip a GIF sub-block chain starting at a length byte and return the offset
// after its zero terminator, or the byte length when the chain runs off the end.
function stubSkipSubBlocks(bytes, offset) {
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = stubByteAt(bytes, cursor);
    if (size < 0) return bytes.length;
    cursor += 1;
    if (size === 0) return cursor;
    cursor += size;
  }
  return bytes.length;
}

// Read the EXIF orientation (1-8) from a TIFF stream at [start, end), or
// undefined when the stream carries no valid orientation tag. Iteration and the
// entry count are both bounded so a malformed header cannot drive the walk.
function stubExifOrientation(bytes, start, end) {
  const limit = Math.min(end, bytes.length);
  if (start < 0 || limit - start < 8) return undefined;
  const first = stubByteAt(bytes, start);
  const second = stubByteAt(bytes, start + 1);
  let little;
  if (first === 0x49 && second === 0x49) little = true;
  else if (first === 0x4D && second === 0x4D) little = false;
  else return undefined;
  if (stubU16(bytes, start + 2, little) !== 42) return undefined;
  const ifdOffset = stubU32(bytes, start + 4, little);
  if (ifdOffset < 0) return undefined;
  const ifd = start + ifdOffset;
  if (ifd < start || ifd + 2 > limit) return undefined;
  const count = stubU16(bytes, ifd, little);
  if (count < 1) return undefined;
  const entriesStart = ifd + 2;
  const entries = Math.min(count, 1024, Math.floor((limit - entriesStart) / 12));
  for (let index = 0; index < entries; index += 1) {
    const entry = entriesStart + index * 12;
    if (stubU16(bytes, entry, little) !== 0x0112) continue;
    const type = stubU16(bytes, entry + 2, little);
    if (type !== 3 && type !== 4) return undefined;
    const value = type === 3 ? stubU16(bytes, entry + 8, little) : stubU32(bytes, entry + 8, little);
    if (value >= 1 && value <= 8) return value;
    return undefined;
  }
  return undefined;
}

// PNG: IHDR carries dimensions, bit depth, and colour type; iCCP, acTL, and eXIf
// carry the profile, animation, and EXIF facts.
function stubPngMetadata(bytes) {
  if (!stubBytesEqual(bytes, 0, '\u0089PNG\r\n\u001a\n')) return undefined;
  if (stubU32BE(bytes, 8) < 13) return undefined;
  if (stubFourCC(bytes, 12) !== 'IHDR') return undefined;
  const width = stubU32BE(bytes, 16);
  const height = stubU32BE(bytes, 20);
  const bitDepth = stubByteAt(bytes, 24);
  const colorType = stubByteAt(bytes, 25);
  if (width < 0 || height < 0 || bitDepth < 0 || colorType < 0) return undefined;
  const metadata = { format: 'png', width: width, height: height, pages: 1 };
  metadata.depth = bitDepth === 16 ? 'ushort' : 'uchar';
  metadata.space = 'srgb';
  metadata.hasAlpha = colorType === 4 || colorType === 6;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = stubU32BE(bytes, offset);
    if (length < 0) break;
    const type = stubFourCC(bytes, offset + 4);
    const dataStart = offset + 8;
    if (length > bytes.length - dataStart - 4) break;
    if (type === 'IEND') break;
    if (type === 'iCCP') {
      metadata.icc = bytes.subarray(dataStart, dataStart + length);
      metadata.space = 'rgb';
    } else if (type === 'acTL') {
      const frames = stubU32BE(bytes, dataStart);
      if (frames >= 1) metadata.pages = frames;
    } else if (type === 'eXIf') {
      metadata.exif = bytes.subarray(dataStart, dataStart + length);
      const orientation = stubExifOrientation(bytes, dataStart, dataStart + length);
      if (orientation !== undefined) metadata.orientation = orientation;
    }
    offset = dataStart + length + 4;
  }
  return metadata;
}

// JPEG: SOFn carries dimensions and component count; APP1 carries EXIF/XMP, APP2
// the ICC profile, APP13 IPTC, and COM the comment. Scanning stops at SOS.
function stubJpegMetadata(bytes) {
  if (stubByteAt(bytes, 0) !== 0xFF || stubByteAt(bytes, 1) !== 0xD8) return undefined;
  let offset = 2;
  let frame;
  let icc;
  const metadata = { format: 'jpeg', pages: 1, hasAlpha: false };
  while (offset < bytes.length) {
    if (stubByteAt(bytes, offset) !== 0xFF) break;
    let markerAt = offset + 1;
    while (stubByteAt(bytes, markerAt) === 0xFF) markerAt += 1;
    const marker = stubByteAt(bytes, markerAt);
    if (marker < 0) break;
    offset = markerAt + 1;
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) continue;
    if (marker === 0xD9 || marker === 0xDA) break;
    const length = stubU16BE(bytes, offset);
    if (length < 2) break;
    const dataStart = offset + 2;
    const dataEnd = offset + length;
    if (dataEnd > bytes.length) break;
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3
      || marker === 0xC5 || marker === 0xC6 || marker === 0xC7
      || marker === 0xC9 || marker === 0xCA || marker === 0xCB
      || marker === 0xCD || marker === 0xCE || marker === 0xCF) {
      if (dataEnd - dataStart >= 6) {
        const precision = stubByteAt(bytes, dataStart);
        const height = stubU16BE(bytes, dataStart + 1);
        const width = stubU16BE(bytes, dataStart + 3);
        const components = stubByteAt(bytes, dataStart + 5);
        if (precision >= 0 && height >= 0 && width >= 0 && components >= 0) {
          frame = { precision: precision, width: width, height: height, components: components };
        }
      }
    } else if (marker === 0xE1) {
      if (dataEnd - dataStart >= 6 && stubBytesEqual(bytes, dataStart, 'Exif\u0000\u0000')) {
        metadata.exif = bytes.subarray(dataStart, dataEnd);
        const orientation = stubExifOrientation(bytes, dataStart + 6, dataEnd);
        if (orientation !== undefined) metadata.orientation = orientation;
      } else if (dataEnd - dataStart >= 29 && stubBytesEqual(bytes, dataStart, 'http://ns.adobe.com/xap/1.0/\u0000')) {
        metadata.xmp = bytes.subarray(dataStart, dataEnd);
      }
    } else if (marker === 0xE2) {
      if (dataEnd - dataStart >= 12 && stubBytesEqual(bytes, dataStart, 'ICC_PROFILE\u0000')) {
        icc = bytes.subarray(dataStart, dataEnd);
      }
    } else if (marker === 0xED) {
      if (dataEnd - dataStart >= 14 && stubBytesEqual(bytes, dataStart, 'Photoshop 3.0\u0000')) {
        metadata.iptc = bytes.subarray(dataStart, dataEnd);
      }
    } else if (marker === 0xFE) {
      metadata.comments = bytes.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  if (frame === undefined) return undefined;
  metadata.width = frame.width;
  metadata.height = frame.height;
  metadata.depth = frame.precision === 8 ? 'uchar' : 'ushort';
  metadata.space = frame.components === 4 ? 'cmyk' : (frame.components === 1 || frame.components === 3 ? 'srgb' : 'rgb');
  if (icc !== undefined) {
    metadata.icc = icc;
    if (metadata.space === 'srgb') metadata.space = 'rgb';
  }
  return metadata;
}

// GIF: the logical screen descriptor carries dimensions; the graphic control
// extension carries the transparent flag; image descriptors count frames.
function stubGifMetadata(bytes) {
  if (!stubBytesEqual(bytes, 0, 'GIF87a') && !stubBytesEqual(bytes, 0, 'GIF89a')) return undefined;
  const width = stubU16LE(bytes, 6);
  const height = stubU16LE(bytes, 8);
  const packed = stubByteAt(bytes, 10);
  if (width < 1 || height < 1 || packed < 0) return undefined;
  const metadata = { format: 'gif', width: width, height: height, depth: 'uchar', space: 'srgb', hasAlpha: false, pages: 1 };
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 0x07) + 1));
  let images = 0;
  let transparent = false;
  while (offset < bytes.length) {
    const tag = stubByteAt(bytes, offset);
    if (tag < 0) break;
    if (tag === 0x3B) break;
    if (tag === 0x21) {
      const label = stubByteAt(bytes, offset + 1);
      if (label === 0xF9 && stubByteAt(bytes, offset + 2) === 4) {
        const flags = stubByteAt(bytes, offset + 3);
        if (flags >= 0 && (flags & 0x01) !== 0) transparent = true;
      } else if (label === 0xFE) {
        metadata.comments = true;
      }
      offset = stubSkipSubBlocks(bytes, offset + 2);
      continue;
    }
    if (tag === 0x2C) {
      images += 1;
      const descriptor = stubByteAt(bytes, offset + 9);
      if (descriptor < 0) break;
      offset += 10;
      if ((descriptor & 0x80) !== 0) offset += 3 * (1 << ((descriptor & 0x07) + 1));
      const minCodeSize = stubByteAt(bytes, offset);
      if (minCodeSize < 0) break;
      offset += 1;
      offset = stubSkipSubBlocks(bytes, offset);
      continue;
    }
    break;
  }
  if (transparent) metadata.hasAlpha = true;
  if (images > 1) metadata.pages = images;
  return metadata;
}

// WebP: VP8X carries canvas dimensions and the alpha/animation flags; VP8L and
// VP8 carry dimensions when no VP8X is present; ICCP, EXIF, and XMP carry
// metadata. RIFF chunk padding is honoured when advancing.
function stubWebpMetadata(bytes) {
  if (!stubBytesEqual(bytes, 0, 'RIFF') || !stubBytesEqual(bytes, 8, 'WEBP')) return undefined;
  let offset = 12;
  let vp8x;
  let vp8l = -1;
  let vp8 = -1;
  let icc;
  let exifStart = -1;
  let exifEnd = -1;
  let xmpStart = -1;
  let xmpEnd = -1;
  let frames = 0;
  while (offset + 8 <= bytes.length) {
    const fourCC = stubFourCC(bytes, offset);
    const size = stubU32LE(bytes, offset + 4);
    if (size < 0) break;
    const dataStart = offset + 8;
    if (size > bytes.length - dataStart) break;
    if (fourCC === 'VP8X' && size >= 10) {
      vp8x = { flags: stubByteAt(bytes, dataStart), dataStart: dataStart };
    } else if (fourCC === 'VP8L' && size >= 5) {
      vp8l = dataStart;
    } else if (fourCC === 'VP8 ' && size >= 10) {
      vp8 = dataStart;
    } else if (fourCC === 'ICCP') {
      icc = bytes.subarray(dataStart, dataStart + size);
    } else if (fourCC === 'EXIF') {
      exifStart = dataStart;
      exifEnd = dataStart + size;
    } else if (fourCC === 'XMP ') {
      xmpStart = dataStart;
      xmpEnd = dataStart + size;
    } else if (fourCC === 'ANMF') {
      frames += 1;
    }
    offset = dataStart + size + (size % 2);
  }
  let width;
  let height;
  let alpha = false;
  let animated = false;
  if (vp8x !== undefined) {
    alpha = (vp8x.flags & 0x10) !== 0;
    animated = (vp8x.flags & 0x02) !== 0;
    width = stubU24LE(bytes, vp8x.dataStart + 4) + 1;
    height = stubU24LE(bytes, vp8x.dataStart + 7) + 1;
  } else if (vp8l >= 0) {
    const bits = stubU32LE(bytes, vp8l + 1);
    if (bits < 0) return undefined;
    width = (bits & 0x3FFF) + 1;
    height = ((bits >>> 14) & 0x3FFF) + 1;
    alpha = ((bits >>> 28) & 0x01) === 1;
  } else if (vp8 >= 0) {
    if (!stubBytesEqual(bytes, vp8 + 3, '\u009d\u0001*')) return undefined;
    const rawWidth = stubU16LE(bytes, vp8 + 6);
    const rawHeight = stubU16LE(bytes, vp8 + 8);
    if (rawWidth < 0 || rawHeight < 0) return undefined;
    width = rawWidth & 0x3FFF;
    height = rawHeight & 0x3FFF;
  } else {
    return undefined;
  }
  if (width < 1 || height < 1) return undefined;
  const metadata = { format: 'webp', width: width, height: height, depth: 'uchar', space: 'srgb', hasAlpha: alpha, pages: 1 };
  if (animated) metadata.pages = frames > 1 ? frames : 2;
  if (icc !== undefined) {
    metadata.icc = icc;
    metadata.space = 'rgb';
  }
  if (exifStart >= 0) {
    metadata.exif = bytes.subarray(exifStart, exifEnd);
    const orientation = stubExifOrientation(bytes, exifStart, exifEnd);
    if (orientation !== undefined) metadata.orientation = orientation;
  }
  if (xmpStart >= 0) metadata.xmp = bytes.subarray(xmpStart, xmpEnd);
  return metadata;
}

// Dispatch to the format whose magic bytes match. Unrecognized or truncated
// input yields an empty object with no format key, never a guess and never a
// throw.
function stubMetadata(input) {
  let bytes;
  try {
    bytes = stubToBytes(input);
  } catch (error) {
    return {};
  }
  if (bytes === undefined || bytes.length === 0) return {};
  try {
    let metadata = stubPngMetadata(bytes);
    if (metadata === undefined) metadata = stubJpegMetadata(bytes);
    if (metadata === undefined) metadata = stubGifMetadata(bytes);
    if (metadata === undefined) metadata = stubWebpMetadata(bytes);
    return metadata === undefined ? {} : metadata;
  } catch (error) {
    return {};
  }
}

// Name the concrete boundary that blocked a pixel operation. The facts come from
// the same header parse metadata() reports, so a refusal never contradicts it.
function stubRefusal(metadata) {
  if (metadata.format === undefined) return 'the bytes are not a recognized PNG/JPEG/GIF/WebP container';
  const facts = [];
  if (metadata.width !== undefined && metadata.height !== undefined) {
    facts.push(metadata.width + 'x' + metadata.height);
  }
  if (metadata.depth !== undefined) facts.push('depth=' + metadata.depth);
  if (metadata.space !== undefined) facts.push('space=' + metadata.space);
  if (metadata.icc !== undefined) facts.push('icc');
  if (metadata.exif !== undefined) facts.push('exif');
  if (metadata.orientation !== undefined) facts.push('orientation=' + metadata.orientation);
  if (metadata.xmp !== undefined) facts.push('xmp');
  if (metadata.iptc !== undefined) facts.push('iptc');
  if (metadata.pages !== undefined && metadata.pages > 1) facts.push('frames=' + metadata.pages);
  if (metadata.hasAlpha === true) facts.push('alpha');

  const needs = [];
  if (metadata.format === 'gif') needs.push('GIF stays outside the version-one image contract');
  if (metadata.pages !== undefined && metadata.pages > 1) needs.push('animation is dropped rather than converted');
  if (metadata.depth !== undefined && metadata.depth !== 'uchar') needs.push('16-bit or sub-8-bit samples need rescaling');
  if (metadata.space !== undefined && metadata.space !== 'srgb') needs.push('a non-sRGB colour space needs colour management');
  if (metadata.icc !== undefined) needs.push('an embedded ICC profile needs colour management');
  if (metadata.exif !== undefined || metadata.xmp !== undefined || metadata.iptc !== undefined
    || metadata.orientation !== undefined) {
    needs.push('embedded metadata needs removal');
  }
  if (needs.length === 0) needs.push('the requested transform or re-encode needs the decoded raster');

  return 'image/' + metadata.format + ' (' + facts.join(', ') + '): ' + needs.join('; ');
}

// A refusal, never a silent empty result: reporting success without pixels would
// disguise a missing capability as a completed conversion.
function stubUnsupported(operation, metadata) {
  const error = new Error('sharp stub cannot ' + operation + ' on HarmonyOS: ' + stubRefusal(metadata)
    + '. Decoding, resizing, colour conversion, and JPEG/WebP encoding are unavailable in the pure-JS stub.');
  error.code = 'SHARP_STUB_UNSUPPORTED';
  return error;
}

// A raw pixel read is the decode proof admission runs before it trusts the
// header, so it must settle without throwing. Its empty result states that no
// raster was produced, and no caller reads those bytes.
function stubRawRaster() {
  return { toBuffer: async () => Buffer.alloc(0) };
}

// The Electron bridge that reaches the platform image framework. Absent outside
// Electron (the stub test), where every conversion falls back to a refusal.
function stubBridge() {
  if (typeof stubSystemPreferences === 'undefined') return undefined;
  if (stubSystemPreferences === undefined || stubSystemPreferences === null) return undefined;
  if (typeof stubSystemPreferences.callArkTSAsyncFunction !== 'function') return undefined;
  return stubSystemPreferences;
}

// Whether the body can exchange temporary files with the platform bridge.
function stubBridgeAvailable() {
  return stubBridge() !== undefined
    && typeof stubFs !== 'undefined'
    && typeof stubPath !== 'undefined'
    && typeof stubOs !== 'undefined';
}

// Concatenate byte runs into one buffer.
function stubConcat(parts) {
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].length;
  const joined = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    joined.set(parts[i], at);
    at += parts[i].length;
  }
  return joined;
}

function stubWriteU32LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

// Drop the ICC profile and comments a JPEG encoder may attach. The encoder
// writes the profile unconditionally, and the normalization contract stores a
// metadata-free raster, so leaving it would fail the caller's verification.
function stubStripJpegMetadata(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts = [];
  let pending = 0;
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const size = stubU16BE(bytes, offset + 2);
    if (size < 2 || offset + 2 + size > bytes.length) break;
    const end = offset + 2 + size;
    const drop = marker === 0xfe
      || (marker === 0xe2 && stubBytesEqual(bytes, offset + 4, 'ICC_PROFILE\u0000'));
    if (drop) {
      // Emit everything before this segment, then resume after it, so the run
      // that follows a removed segment does not carry it back in.
      parts.push(bytes.subarray(pending, offset));
      pending = end;
    }
    offset = end;
    if (marker === 0xda) break;
  }
  parts.push(bytes.subarray(pending));
  return stubConcat(parts);
}

// Drop the ICCP / EXIF / XMP chunks a WebP encoder may attach, then repair the
// RIFF size, which counts every byte after the size field itself.
function stubStripWebpMetadata(bytes) {
  if (bytes.length < 12 || !stubBytesEqual(bytes, 0, 'RIFF') || !stubBytesEqual(bytes, 8, 'WEBP')) return bytes;
  const parts = [bytes.subarray(0, 12)];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = stubU32LE(bytes, offset + 4);
    if (size < 0) break;
    const padded = size + (size % 2);
    if (offset + 8 + padded > bytes.length) break;
    const fourCC = stubFourCC(bytes, offset);
    if (fourCC !== 'ICCP' && fourCC !== 'EXIF' && fourCC !== 'XMP ') {
      parts.push(bytes.subarray(offset, offset + 8 + padded));
    }
    offset += 8 + padded;
  }
  const joined = stubConcat(parts);
  stubWriteU32LE(joined, 4, joined.length - 8);
  return joined;
}

// Drop the ancillary text and profile chunks a PNG encoder may attach; the
// pixel chunks are untouched.
function stubStripPngMetadata(bytes) {
  if (bytes.length < 8 || !stubBytesEqual(bytes, 0, '\u0089PNG\r\n\u001a\n')) return bytes;
  const parts = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = stubU32BE(bytes, offset);
    if (size < 0 || size > bytes.length - offset - 12) break;
    const end = offset + 12 + size;
    const type = stubFourCC(bytes, offset + 4);
    const drop = type === 'iCCP' || type === 'eXIf' || type === 'tEXt'
      || type === 'zTXt' || type === 'iTXt';
    if (!drop) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return stubConcat(parts);
}

/** Dispatch metadata removal to the produced container. */
function stubStripMetadata(bytes, format) {
  if (format === 'jpeg') return stubStripJpegMetadata(bytes);
  if (format === 'webp') return stubStripWebpMetadata(bytes);
  if (format === 'png') return stubStripPngMetadata(bytes);
  return bytes;
}

/**
 * Encode one transformed image through the platform image framework.
 * The bridge marshals only strings, so the request travels as JSON and the
 * caller's bytes travel as a temporary file the adapter reads and replaces.
 * The recorded transform arguments decide the outcome: resize supplies the
 * bounds, and the chosen encoder supplies the format and quality. The returned
 * facts are re-parsed from the cleaned bytes, so nothing depends on a dimension
 * the adapter merely claimed.
 */
async function stubEncodeWithBridge(state) {
  if (state.bytes === undefined || state.mediaType === undefined) return undefined;
  if (!stubBridgeAvailable()) return undefined;
  const directory = stubPath.join(stubOs.tmpdir(), 'dsh-sharp-stub');
  stubFs.mkdirSync(directory, { recursive: true });
  const stamp = process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  const sourcePath = stubPath.join(directory, stamp + '.in');
  const targetPath = stubPath.join(directory, stamp + '.out');
  try {
    stubFs.writeFileSync(sourcePath, state.bytes);
    const request = JSON.stringify({
      source: sourcePath,
      target: targetPath,
      format: state.mediaType,
      quality: state.quality,
      maxWidth: state.width === undefined ? 0 : state.width,
      maxHeight: state.height === undefined ? 0 : state.height,
    });
    const envelope = await stubBridge().callArkTSAsyncFunction('HarmonyImage.Convert', 'string', [request]);
    const payload = envelope !== null && typeof envelope === 'object' && 'value' in envelope
      ? envelope.value
      : envelope;
    let outcome;
    try {
      outcome = JSON.parse(String(payload));
    } catch (error) {
      throw new Error('the image bridge returned an unparsable outcome: ' + String(payload));
    }
    if (outcome.ok !== true) throw new Error('the image bridge refused the conversion: ' + String(outcome.error));
    const produced = stubFs.readFileSync(targetPath);
    const producedFacts = stubMetadata(produced);
    const cleaned = stubStripMetadata(produced, producedFacts.format);
    const facts = stubMetadata(cleaned);
    if (facts.format === undefined) throw new Error('the image bridge produced bytes this stub cannot identify');
    return { data: new Uint8Array(cleaned), info: { width: facts.width, height: facts.height } };
  } finally {
    try { stubFs.rmSync(sourcePath, { force: true }); } catch (error) { /* best-effort cleanup */ }
    try { stubFs.rmSync(targetPath, { force: true }); } catch (error) { /* best-effort cleanup */ }
  }
}

function sharp(input, options) {
  const bytes = stubToBytes(input);
  // Transform arguments are recorded rather than applied: the platform bridge
  // performs the whole chain's work when the terminal runs.
  const state = { bytes: bytes, width: undefined, height: undefined, mediaType: undefined, quality: undefined };
  const refuse = (operation) => {
    return () => {
      throw stubUnsupported(operation, stubMetadata(bytes));
    };
  };
  const chain = {
    metadata: async () => stubMetadata(bytes),
    raw: () => stubRawRaster(),
    rotate: () => proxy,
    toColourspace: () => proxy,
    withMetadata: () => proxy,
    timeout: () => proxy,
    clone: () => proxy,
    resize: (options) => {
      if (options !== undefined && options !== null) {
        state.width = options.width;
        state.height = options.height;
      }
      return proxy;
    },
    jpeg: (options) => {
      state.mediaType = 'image/jpeg';
      state.quality = options !== undefined && options !== null && options.quality !== undefined ? options.quality : 80;
      return proxy;
    },
    webp: (options) => {
      state.mediaType = 'image/webp';
      state.quality = options !== undefined && options !== null && options.quality !== undefined ? options.quality : 80;
      return proxy;
    },
    png: () => {
      state.mediaType = 'image/png';
      state.quality = 100;
      return proxy;
    },
    toBuffer: async () => {
      const encoded = await stubEncodeWithBridge(state);
      if (encoded === undefined) throw stubUnsupported('encode pixels', stubMetadata(bytes));
      return encoded;
    },
    toFile: refuse('write encoded pixels'),
    stats: refuse('measure pixel statistics'),
    info: async () => {
      const metadata = stubMetadata(bytes);
      const info = {};
      if (metadata.format !== undefined) info.format = metadata.format;
      if (metadata.width !== undefined) info.width = metadata.width;
      if (metadata.height !== undefined) info.height = metadata.height;
      return info;
    },
  };
  // Transform calls compose: every unlisted member returns the proxy, so an
  // arbitrary chain reaches one terminal. "then" stays absent so the proxy is
  // never mistaken for a thenable, and symbols stay absent so engine-level
  // protocols are not answered with a function.
  const proxy = new Proxy(chain, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property === 'symbol') return undefined;
      if (property === 'then' || property === 'catch' || property === 'finally') return undefined;
      return () => proxy;
    },
  });
  return proxy;
}
