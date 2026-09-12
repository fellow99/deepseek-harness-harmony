import { appTasks, OhosAppContext, OhosPluginId } from '@ohos/hvigor-ohos-plugin';
import { getNode } from '@ohos/hvigor';
import * as fs from 'fs';
import * as path from 'path';

/** 项目根目录（hvigorfile.ts 所在目录） */
const PROJECT_ROOT = __dirname;

interface SigningMaterial {
  certpath: string;
  storeFile: string;
  profile: string;
  keyAlias: string;
  keyPassword: string;
  storePassword: string;
  signAlg: string;
}

/**
 * 把材料里的文件路径解析为绝对路径：
 *  - 绝对路径原样返回
 *  - 相对路径相对项目根目录解析（便于在 JSON 里写 ".ohos/config/xxx.p12"）
 */
function resolveMaterialPaths(m: SigningMaterial): SigningMaterial {
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p));
  return { ...m, certpath: abs(m.certpath), storeFile: abs(m.storeFile), profile: abs(m.profile) };
}

/**
 * 签名配置来源（按优先级）：
 *  1. CI 环境变量：CERTPATH / STORE_FILE / PROFILE / KEY_ALIAS /
 *     KEY_PASSWORD / STORE_PASSWORD / SIGN_ALG
 *  2. signing.local.json —— 本地签名材料（gitignored）
 *     指向 .ohos/config/ 下的 .p12/.cer/.p7b；同目录的 material/ 是解密密钥链。
 *
 * 注意：storePassword/keyPassword 必须是 hvigor DecipherUtil 的 AES-GCM 密文
 * （≥32 位 hex），且 .p12 同级目录需有 material/{fd,ac,ce} 密钥链，否则签名失败。
 *
 * 这样 build-profile.json5 无需再提交任何敏感签名材料，可安全入库。
 */
function loadSigningConfig(): SigningMaterial | null {
  const env = process.env;
  if (env.CERTPATH && env.STORE_FILE && env.STORE_PASSWORD && env.KEY_PASSWORD) {
    return resolveMaterialPaths({
      certpath: env.CERTPATH,
      storeFile: env.STORE_FILE,
      profile: env.PROFILE,
      keyAlias: env.KEY_ALIAS || 'debugKey',
      keyPassword: env.KEY_PASSWORD,
      storePassword: env.STORE_PASSWORD,
      signAlg: env.SIGN_ALG || 'SHA256withECDSA'
    });
  }
  const file = path.join(PROJECT_ROOT, 'signing.local.json');
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return resolveMaterialPaths({
      certpath: raw.certpath,
      storeFile: raw.storeFile,
      profile: raw.profile,
      keyAlias: raw.keyAlias || 'debugKey',
      keyPassword: raw.keyPassword,
      storePassword: raw.storePassword,
      signAlg: raw.signAlg || 'SHA256withECDSA'
    });
  }
  // 未提供签名材料：返回 null，由调用方决定跳过注入（保持 build-profile.json5 原样，
  // 全新克隆 / CI 可直接构建调试包，需要正式签名时再提供 signing.local.json 或环境变量）。
  return null;
}

getNode(__filename).afterNodeEvaluate((node) => {
  const appContext = node.getContext(OhosPluginId.OHOS_APP_PLUGIN) as OhosAppContext;
  const buildProfileOpt = appContext.getBuildProfileOpt();
  const material = loadSigningConfig();
  if (!material) {
    // 无本地签名材料：不修改 signingConfigs，交由 DevEco/IDE 自动调试签名或构建未签名调试包。
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
