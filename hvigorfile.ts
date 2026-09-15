import { appTasks, OhosAppContext, OhosPluginId } from '@ohos/hvigor-ohos-plugin';
import { getNode } from '@ohos/hvigor';
import * as fs from 'fs';
import * as path from 'path';

/** 项目根目录（hvigorfile.ts 所在目录） */
const PROJECT_ROOT = __dirname;

/** 签名模式：由 SIGN_MODE 环境变量选择，缺省为 debug */
type SignMode = 'debug' | 'release';

interface SigningMaterial {
  certpath: string;
  storeFile: string;
  profile: string;
  keyAlias: string;
  keyPassword: string;
  storePassword: string;
  signAlg: string;
}

/** 本地签名配置文件中必填的字段（keyAlias / signAlg 有默认值，可省略） */
const REQUIRED_FIELDS = ['certpath', 'storeFile', 'profile', 'keyPassword', 'storePassword'] as const;

/** 统一失败出口：打印清晰错误并以非零码退出，绝不静默回退（防止误产错误签名的包）。 */
function fail(message: string): never {
  console.error(`[hvigorfile] 签名配置错误：${message}`);
  throw new Error(message);
}

/**
 * 把材料里的文件路径解析为绝对路径：
 *  - 绝对路径原样返回
 *  - 相对路径相对项目根目录解析（便于在 JSON 里写 ".ohos/release/release.p12"）
 */
function resolveMaterialPaths(m: SigningMaterial): SigningMaterial {
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p));
  return { ...m, certpath: abs(m.certpath), storeFile: abs(m.storeFile), profile: abs(m.profile) };
}

/**
 * 解析 SIGN_MODE：
 *  - 未设置 / 空字符串 → debug（默认）
 *  - "debug" | "release" → 原样返回
 *  - 其它值 → 直接失败（hard fail），绝不静默回退，避免"以为签的是 release、实际签的是 debug"。
 */
function resolveSignMode(): SignMode {
  const raw = (process.env.SIGN_MODE || '').trim();
  if (raw === '') return 'debug';
  if (raw === 'debug' || raw === 'release') return raw;
  return fail(`非法的 SIGN_MODE="${raw}"：只允许 "debug" 或 "release"（未设置时默认为 "debug"）。`);
}

/** 读取并校验一个本地签名配置文件，返回解析后的签名材料。 */
function loadMaterialFile(file: string): SigningMaterial {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return fail(`无法解析签名配置 ${file}：${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(`签名配置 ${file} 的顶层必须是 JSON 对象。`);
  }
  const raw = parsed as Record<string, unknown>;
  const str = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const missing = REQUIRED_FIELDS.filter((k) => str(k).trim() === '');
  if (missing.length > 0) {
    return fail(`签名配置 ${file} 缺少必填字段：${missing.join(', ')}。`);
  }
  return resolveMaterialPaths({
    certpath: str('certpath'),
    storeFile: str('storeFile'),
    profile: str('profile'),
    keyAlias: str('keyAlias') || 'debugKey',
    keyPassword: str('keyPassword'),
    storePassword: str('storePassword'),
    signAlg: str('signAlg') || 'SHA256withECDSA'
  });
}

/**
 * 签名配置来源（按优先级，先匹配者生效）：
 *  1. CI 环境变量：CERTPATH / STORE_FILE / PROFILE / KEY_ALIAS /
 *     KEY_PASSWORD / STORE_PASSWORD / SIGN_ALG
 *     （CERTPATH && STORE_FILE && STORE_PASSWORD && KEY_PASSWORD 四个齐全才生效）
 *  2. signing.<mode>.local.json —— 本地签名材料（gitignored），mode = SIGN_MODE：
 *       debug   → signing.debug.local.json   （DevEco 自动生成的调试证书 + debugKey）
 *       release → signing.release.local.json （华为签发的发布证书 + release Profile）
 *     文件内 certpath/storeFile/profile 写"相对项目根的路径"或绝对路径；
 *     keyAlias 默认 debugKey，signAlg 默认 SHA256withECDSA。
 *
 * 注意：storePassword/keyPassword 必须是 hvigor DecipherUtil 的 AES-GCM 密文
 * （≥32 位 hex），且 .p12 同级目录需有 material/{fd,ac,ce} 密钥链，否则签名失败。
 *
 * 两种来源都只在内存中注入（setBuildProfileOpt），绝不写回 build-profile.json5，
 * 因此仓库内不落任何敏感签名材料，可安全入库。
 */
function loadSigningConfig(mode: SignMode): SigningMaterial | null {
  const env = process.env;
  if (env.CERTPATH && env.STORE_FILE && env.STORE_PASSWORD && env.KEY_PASSWORD) {
    return resolveMaterialPaths({
      certpath: env.CERTPATH,
      storeFile: env.STORE_FILE,
      profile: env.PROFILE || '',
      keyAlias: env.KEY_ALIAS || 'debugKey',
      keyPassword: env.KEY_PASSWORD,
      storePassword: env.STORE_PASSWORD,
      signAlg: env.SIGN_ALG || 'SHA256withECDSA'
    });
  }
  const file = path.join(PROJECT_ROOT, `signing.${mode}.local.json`);
  if (fs.existsSync(file)) {
    return loadMaterialFile(file);
  }
  // 未提供签名材料：返回 null，由调用方决定跳过注入（保持 build-profile.json5 原样）。
  return null;
}

getNode(__filename).afterNodeEvaluate((node) => {
  const mode = resolveSignMode();
  const appContext = node.getContext(OhosPluginId.OHOS_APP_PLUGIN) as OhosAppContext;
  const buildProfileOpt = appContext.getBuildProfileOpt();
  const material = loadSigningConfig(mode);
  if (!material) {
    // 无本地签名材料：不修改 signingConfigs，交由 DevEco/IDE 自动调试签名或构建未签名调试包。
    const expected = path.join(PROJECT_ROOT, `signing.${mode}.local.json`);
    console.warn(
      `[hvigorfile] SIGN_MODE=${mode}，但未找到签名材料：${expected}` +
      `（也未提供 CERTPATH/STORE_FILE/STORE_PASSWORD/KEY_PASSWORD 环境变量）。` +
      `本次构建将产出未签名 / IDE 自动签名的包。`
    );
    return;
  }
  buildProfileOpt['app']['signingConfigs'] = [
    {
      name: 'default',
      type: 'HarmonyOS',
      material: material
    }
  ];
  appContext.setBuildProfileOpt(buildProfileOpt);
});

export default {
  system: appTasks, /* Built-in plugin of hvigor. It cannot be modified. */
  plugins: []       /* Custom plugin to extend the functionality of hvigor. */
}
