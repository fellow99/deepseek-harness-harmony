/**
 * Self-test for the pure-JS sharp stub body (`scripts/lib/sharp-stub-body.js`).
 *
 * Runs on plain Node with no test framework and no dependency. The body is read
 * as text and embedded through the same wrapper functions the collect stage uses
 * (`scripts/lib/sharp-stub.mjs`), then both generated entry points are imported,
 * so a backtick or template interpolation in the body would fail here exactly as
 * it would fail the shipped artifact.
 *
 * Fixtures are built by hand: a real 1x1 PNG with a zlib-deflated IDAT and a
 * correct CRC32, a JPEG frame header, a GIF screen descriptor, and a VP8X WebP.
 *
 * Run: `node tests/sharp-stub.test.mjs` — exits non-zero when any check fails.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { wrapSharpStubCjs, wrapSharpStubEsm } from '../lib/sharp-stub.mjs';

const BODY_PATH = new URL('../lib/sharp-stub-body.js', import.meta.url);
const body = readFileSync(BODY_PATH, 'utf8');

const workDir = mkdtempSync(join(tmpdir(), 'dsh-sharp-stub-'));
const esmPath = join(workDir, 'index.mjs');
const cjsPath = join(workDir, 'index.cjs');
writeFileSync(esmPath, wrapSharpStubEsm(body));
writeFileSync(cjsPath, wrapSharpStubCjs(body));
const esm = (await import(pathToFileURL(esmPath).href)).default;
const cjs = createRequire(import.meta.url)(cjsPath);

/** Parse one fixture through both generated entry points and assert they agree. */
async function parseMetadata(input) {
  const fromEsm = await esm(input).metadata();
  const fromCjs = await cjs(input).metadata();
  assert.deepEqual(fromCjs, fromEsm, 'the ESM and CJS stubs must report identical metadata');
  return fromEsm;
}
// --- fixture builders -------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function png({ width, height, bitDepth, colorType, pixels, extraChunks = [] }) {
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const chunks = [signature, pngChunk('IHDR', ihdr)];
  if (pixels !== undefined) chunks.push(pngChunk('IDAT', deflateSync(pixels)));
  chunks.push(...extraChunks);
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function jpegSegment(marker, payload) {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([Buffer.from([0xFF, marker]), length, payload]);
}

function jpegFrame(width, height, segments = []) {
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  sof[6] = 1; sof[7] = 0x11; sof[8] = 0;
  sof[9] = 2; sof[10] = 0x11; sof[11] = 0;
  sof[12] = 3; sof[13] = 0x11; sof[14] = 0;
  return Buffer.concat([Buffer.from([0xFF, 0xD8]), ...segments, jpegSegment(0xC0, sof), Buffer.from([0xFF, 0xD9])]);
}

function exifApp1(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22);
  return jpegSegment(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]));
}

function gif(width, height, { transparent = false } = {}) {
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  const parts = [Buffer.from('GIF89a', 'ascii'), lsd];
  if (transparent) parts.push(Buffer.from([0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00]));
  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}

function webpChunk(fourCC, data) {
  const header = Buffer.alloc(8);
  header.write(fourCC, 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  const padding = data.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
  return Buffer.concat([header, data, padding]);
}

function vp8xWebp(width, height, flags) {
  const canvas = Buffer.alloc(10);
  canvas[0] = flags;
  const w = width - 1;
  const h = height - 1;
  canvas[4] = w & 0xFF; canvas[5] = (w >>> 8) & 0xFF; canvas[6] = (w >>> 16) & 0xFF;
  canvas[7] = h & 0xFF; canvas[8] = (h >>> 8) & 0xFF; canvas[9] = (h >>> 16) & 0xFF;
  const chunk = webpChunk('VP8X', canvas);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + chunk.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, chunk]);
}

const RGBA_PNG = png({ width: 1, height: 1, bitDepth: 8, colorType: 6, pixels: Buffer.from([0, 255, 0, 0, 255]) });
const GRAY_PNG = png({ width: 1, height: 1, bitDepth: 8, colorType: 0, pixels: Buffer.from([0, 128]) });
const PNG_16BIT = png({ width: 1, height: 1, bitDepth: 16, colorType: 0, pixels: Buffer.from([0, 0, 255]) });
const ICCP_PNG = png({
  width: 1,
  height: 1,
  bitDepth: 8,
  colorType: 2,
  pixels: Buffer.from([0, 10, 20, 30]),
  extraChunks: [pngChunk('iCCP', Buffer.concat([Buffer.from('p\0', 'ascii'), Buffer.from([0]), deflateSync(Buffer.from('icc'))]))],
});
const ACTL_PNG = png({
  width: 1,
  height: 1,
  bitDepth: 8,
  colorType: 6,
  pixels: Buffer.from([0, 0, 0, 0, 0]),
  extraChunks: [(function actl() {
    const data = Buffer.alloc(8);
    data.writeUInt32BE(2, 0);
    data.writeUInt32BE(0, 4);
    return pngChunk('acTL', data);
  })()],
});
const TRUNCATED_PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const UNRECOGNIZED = Buffer.from('definitely not an image', 'utf8');
const JPEG = jpegFrame(7, 3);
const JPEG_ORIENTED = jpegFrame(7, 3, [exifApp1(6)]);
const GIF_IMAGE = gif(3, 2);
const GIF_TRANSPARENT = gif(3, 2, { transparent: true });
const WEBP_ALPHA = vp8xWebp(5, 4, 0x10);
const WEBP_OPAQUE = vp8xWebp(5, 4, 0x00);

// --- tests ------------------------------------------------------------------

const tests = [];
function test(name, body) {
  tests.push({ name, body });
}

test('the body is embedded through the build wrapper and both entry points load', () => {
  assert.equal(typeof esm, 'function');
  assert.equal(esm.default, esm);
  assert.equal(typeof cjs, 'function');
  assert.ok(wrapSharpStubEsm(body).startsWith('/*!'), 'the shipped ESM banner is preserved');
  assert.ok(wrapSharpStubCjs(body).startsWith('/*!'), 'the shipped CJS banner is preserved');
  const backtick = String.fromCharCode(96);
  assert.equal(body.includes(backtick), false, 'the stub body must not contain a backtick');
  assert.equal(body.includes('${'), false, 'the stub body must not contain template interpolation');
});

test('a real 1x1 8-bit RGBA PNG reports truthful format, size, depth, space, alpha, and pages', async () => {
  const metadata = await parseMetadata(RGBA_PNG);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1);
  assert.equal(metadata.height, 1);
  assert.equal(metadata.depth, 'uchar');
  assert.equal(metadata.space, 'srgb');
  assert.equal(metadata.hasAlpha, true);
  assert.equal(metadata.pages, 1);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.iptc, undefined);
  assert.equal(metadata.comments, undefined);
  assert.equal(metadata.orientation, undefined);
});

test('a greyscale 8-bit PNG reports no alpha', async () => {
  const metadata = await parseMetadata(GRAY_PNG);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.depth, 'uchar');
  assert.equal(metadata.space, 'srgb');
  assert.equal(metadata.hasAlpha, false);
});

test('a 16-bit PNG reports the ushort depth sharp would report', async () => {
  const metadata = await parseMetadata(PNG_16BIT);
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.depth, 'ushort');
});

test('a minimal JPEG with an SOF0 frame reports format and dimensions', async () => {
  const metadata = await parseMetadata(JPEG);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 7);
  assert.equal(metadata.height, 3);
  assert.equal(metadata.depth, 'uchar');
  assert.equal(metadata.space, 'srgb');
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.pages, 1);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
});

test('a JPEG EXIF orientation is reported only when the APP1 tag is present', async () => {
  const metadata = await parseMetadata(JPEG_ORIENTED);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.orientation, 6);
  assert.notEqual(metadata.exif, undefined);
});

test('a GIF screen descriptor reports its declared dimensions', async () => {
  const metadata = await parseMetadata(GIF_IMAGE);
  assert.equal(metadata.format, 'gif');
  assert.equal(metadata.width, 3);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.depth, 'uchar');
  assert.equal(metadata.hasAlpha, false);
  assert.equal(metadata.pages, 1);
});

test('a GIF graphic control extension reports transparency truthfully', async () => {
  const metadata = await parseMetadata(GIF_TRANSPARENT);
  assert.equal(metadata.format, 'gif');
  assert.equal(metadata.hasAlpha, true);
});

test('a VP8X WebP reports canvas dimensions and the alpha flag', async () => {
  const withAlpha = await parseMetadata(WEBP_ALPHA);
  assert.equal(withAlpha.format, 'webp');
  assert.equal(withAlpha.width, 5);
  assert.equal(withAlpha.height, 4);
  assert.equal(withAlpha.depth, 'uchar');
  assert.equal(withAlpha.space, 'srgb');
  assert.equal(withAlpha.hasAlpha, true);
  assert.equal(withAlpha.pages, 1);
  const opaque = await parseMetadata(WEBP_OPAQUE);
  assert.equal(opaque.hasAlpha, false);
});

test('an unrecognized container returns no format key instead of guessing', async () => {
  const metadata = await parseMetadata(UNRECOGNIZED);
  assert.equal('format' in metadata, false);
});

test('a truncated PNG (signature only) returns no format and does not throw', async () => {
  const metadata = await parseMetadata(TRUNCATED_PNG);
  assert.equal('format' in metadata, false);
});

test('a PNG carrying an iCCP chunk reports a non-srgb space', async () => {
  const metadata = await parseMetadata(ICCP_PNG);
  assert.equal(metadata.format, 'png');
  assert.notEqual(metadata.space, 'srgb');
  assert.notEqual(metadata.icc, undefined);
});

test('a PNG carrying an acTL chunk reports more than one page', async () => {
  const metadata = await parseMetadata(ACTL_PNG);
  assert.equal(metadata.format, 'png');
  assert.ok(metadata.pages > 1, 'an animated PNG must report pages > 1');
});

test('Buffer, Uint8Array, ArrayBuffer, and unusable inputs are all tolerated', async () => {
  assert.equal((await parseMetadata(RGBA_PNG)).format, 'png');
  assert.equal((await parseMetadata(new Uint8Array(RGBA_PNG))).format, 'png');
  const arrayBuffer = RGBA_PNG.buffer.slice(RGBA_PNG.byteOffset, RGBA_PNG.byteOffset + RGBA_PNG.byteLength);
  assert.equal((await parseMetadata(arrayBuffer)).format, 'png');
  for (const unusable of [undefined, null, 42, 'text', {}, []]) {
    const result = await parseMetadata(unusable);
    assert.equal('format' in result, false, 'unusable input must yield no format');
  }
});

test('the raw decode proof settles while every encode terminal refuses by name', async () => {
  const image = esm(RGBA_PNG);
  assert.equal((await image.raw().toBuffer()).length, 0);
  await assert.rejects(image.toBuffer(), /sharp stub cannot encode pixels on HarmonyOS/u);
  assert.throws(() => image.toFile('/tmp/unused'), /sharp stub cannot write encoded pixels on HarmonyOS/u);
  assert.throws(() => image.stats(), /sharp stub cannot measure pixel statistics on HarmonyOS/u);
  assert.deepEqual(await image.info(), { format: 'png', width: 1, height: 1 });
  const fallback = image.someUnknownMethod();
  assert.equal(typeof fallback.metadata, 'function');
  assert.equal((await fallback.metadata()).format, 'png');
});

test('transform calls compose, so a refusal is reached instead of a property error', async () => {
  const chained = esm(RGBA_PNG)
    .rotate()
    .toColourspace('srgb')
    .resize({ width: 4, height: 4, fit: 'inside', withoutEnlargement: true });
  await assert.rejects(
    chained.clone().jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true }),
    /sharp stub cannot encode pixels on HarmonyOS/u,
  );
});

test('a refusal names the boundary that blocked the conversion', async () => {
  await assert.rejects(esm(PNG_16BIT).toBuffer(), /depth=ushort/u);
  await assert.rejects(esm(ICCP_PNG).toBuffer(), /icc/u);
  await assert.rejects(esm(ACTL_PNG).toBuffer(), /frames=/u);
  await assert.rejects(esm(GIF_IMAGE).toBuffer(), /GIF stays outside/u);
  await assert.rejects(esm(JPEG_ORIENTED).toBuffer(), /orientation=/u);
});

test('the proxy is never mistaken for a thenable', async () => {
  const image = esm(RGBA_PNG);
  assert.equal(image.then, undefined);
  assert.equal(await image, image);
});

test('a reachable platform bridge replaces the refusal, strips encoder metadata, and cleans up', async () => {
  const root = join(workDir, 'bridged');
  const requestLog = join(root, 'request.json');
  const adapterOutput = join(root, 'adapter-output.jpg');
  // The platform encoder attaches an ICC profile to everything it writes; the
  // stub must remove it, because the caller stores a metadata-free raster.
  const iccJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe2, 0x00, 0x14]),
    Buffer.from('ICC_PROFILE\0', 'latin1'),
    Buffer.from([0x01, 0x01, 0x11, 0x11, 0x11, 0x11]),
    Buffer.from([
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03,
      0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]),
    Buffer.from([0xff, 0xd9]),
  ]);
  mkdirSync(join(root, 'node_modules', 'electron'), { recursive: true });
  writeFileSync(adapterOutput, iccJpeg);
  // Stand-in for the ImageAdapter: record the request, then answer with bytes.
  // It deliberately claims dimensions the produced bytes contradict, so the test
  // proves the stub reports facts parsed from the bytes rather than the claim.
  writeFileSync(
    join(root, 'node_modules', 'electron', 'index.js'),
    'const fs = require("node:fs");\n'
    + 'module.exports = { systemPreferences: { callArkTSAsyncFunction: async (name, ret, args) => {\n'
    + '  const spec = JSON.parse(args[0]);\n'
    + '  fs.writeFileSync(' + JSON.stringify(requestLog) + ', JSON.stringify({ name: name, ret: ret, spec: spec }));\n'
    + '  fs.copyFileSync(' + JSON.stringify(adapterOutput) + ', spec.target);\n'
    + '  return { type: "string", value: JSON.stringify({ ok: true, width: 9, height: 9, bytes: 9, format: spec.format }) };\n'
    + '} } };\n',
  );
  const bridgedPath = join(root, 'index.mjs');
  writeFileSync(bridgedPath, wrapSharpStubEsm(body));
  const bridged = (await import(pathToFileURL(bridgedPath).href)).default;

  const encoded = await bridged(PNG_16BIT)
    .rotate()
    .toColourspace('srgb')
    .resize({ width: 1, height: 1, fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(encoded.data);
  assert.equal(out.includes(Buffer.from('ICC_PROFILE\0', 'latin1')), false,
    'the encoder ICC profile must be stripped');
  assert.equal(encoded.data.length, iccJpeg.length - 22, 'only the 22-byte APP2 segment may be removed');
  assert.deepEqual(encoded.info, { width: 1, height: 1 });
  const facts = await bridged(out).metadata();
  assert.equal(facts.format, 'jpeg');
  assert.equal(facts.space, 'srgb', 'no profile means the reported space returns to srgb');
  assert.equal(facts.icc, undefined);

  const logged = JSON.parse(readFileSync(requestLog, 'utf8'));
  assert.equal(logged.name, 'HarmonyImage.Convert');
  assert.equal(logged.ret, 'string');
  assert.equal(logged.spec.format, 'image/jpeg');
  assert.equal(logged.spec.quality, 85);
  assert.equal(logged.spec.maxWidth, 1);
  assert.equal(logged.spec.maxHeight, 1);
  assert.equal(existsSync(logged.spec.source), false, 'the staged source must be cleaned up');
  assert.equal(existsSync(logged.spec.target), false, 'the adapter output must be cleaned up');
});

rmSync(workDir, { recursive: true, force: true });

let failed = 0;
for (const { name, body: check } of tests) {
  try {
    await check();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error instanceof Error ? error.stack : String(error));
  }
}
console.log(`\n${tests.length - failed} of ${tests.length} checks passed`);
if (failed > 0) process.exitCode = 1;
