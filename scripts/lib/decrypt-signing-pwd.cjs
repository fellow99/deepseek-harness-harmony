// decrypt-signing-pwd.cjs -- print the plaintext keystore passwords for a
// signing.<mode>.local.json.
//
// WHY: signing.<mode>.local.json deliberately stores hvigor DecipherUtil AES-GCM
// CIPHERTEXT, not plaintext, so the file is safe to keep on disk. hap-sign-tool,
// however, needs the plaintext. hvigor decrypts it with its own DecipherUtil,
// which derives the key from <configDir>/material/{fd,ac,ce}. Rather than
// reimplementing that derivation, this helper calls hvigor's own implementation.
//
// The passwords are written to stdout only, so the caller can hold them in
// memory; they are never written to a file. Do not echo this output.
//
// usage: node decrypt-signing-pwd.cjs <signing.<mode>.local.json>

'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

/** Locate an installed @ohos/hvigor and make it resolvable (it is not a project dep). */
function makeHvigorResolvable() {
  const base = path.join(os.homedir(), '.hvigor', 'project_caches');
  if (!fs.existsSync(base)) {
    throw new Error(`no hvigor cache at ${base} - run a hvigor build at least once`);
  }
  const candidates = [];
  for (const entry of fs.readdirSync(base)) {
    const modules = path.join(base, entry, 'workspace', 'node_modules');
    if (fs.existsSync(path.join(modules, '@ohos', 'hvigor'))) {
      candidates.push(modules);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`@ohos/hvigor not found under ${base}/*/workspace/node_modules`);
  }
  const chosen = candidates[candidates.length - 1];
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${chosen}${path.delimiter}${process.env.NODE_PATH}`
    : chosen;
  Module._initPaths(); // re-read NODE_PATH so transitive requires resolve
  return chosen;
}

function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) {
    throw new Error('usage: node decrypt-signing-pwd.cjs <signing.<mode>.local.json>');
  }
  const hvigorModules = makeHvigorResolvable();

  // decipher-util.js ships inside the hvigor plugin, not inside the cache.
  const decipherCandidates = [
    process.env.HVIGOR_DECIPHER_UTIL,
    path.join('D:', 'oh-workspace', 'command-line-tools', 'hvigor', 'hvigor-ohos-plugin', 'src', 'utils', 'decipher-util.js'),
  ].filter(Boolean);
  let decipherPath = null;
  for (const candidate of decipherCandidates) {
    if (fs.existsSync(candidate)) { decipherPath = candidate; break; }
  }
  if (!decipherPath) {
    throw new Error(`decipher-util.js not found (set HVIGOR_DECIPHER_UTIL); looked in: ${decipherCandidates.join(', ')}`);
  }

  const { DecipherUtil } = require(decipherPath);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const materialDir = path.dirname(path.resolve(cfg.storeFile));

  const result = {
    materialDir: materialDir,
    hvigorModules: hvigorModules,
    keyPassword: DecipherUtil.decryptPwd(materialDir, cfg.keyPassword, 'keyPwd'),
    storePassword: DecipherUtil.decryptPwd(materialDir, cfg.storePassword, 'storePwd'),
  };
  process.stdout.write(JSON.stringify(result));
}

main();
