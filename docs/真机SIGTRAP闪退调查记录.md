# 真机 SIGTRAP 闪退调查记录

> 调查时间：2026-09-12
> 设备：`192.168.0.130:41861`（HAD-W32，API 24）
> 包名：`org.fellow99.DeepseekHarnessHarmony`
> 状态：已定位到「我们本机编译产物崩溃 / 他机编译产物正常」，根因待最终确认

---

## 一、现象

- 真机部署我们 hvigor 编译的签名 HAP（debug / release 均复现），启动后 **~250ms 闪退**。
- 崩溃签名固定：
  ```
  Reason: Signal: SIGTRAP(TRAP_BRKPT) @ 0x0000005c16aca77c
  threadName: kHarnessHarmony
  processdump: DfxUnwinder: Failed to step first frame, lr fallback
  ```
- 崩溃发生在 `kHarnessHarmony` 线程（Electron 运行时自起的 bootstrap 线程），
  在 `ParseAssetsOHOS → PowerMonitor → LIBUV init` 之后 ~4ms，
  **早于 main.js 任何日志输出**（`[dsh-harmony]` 一行都没有）。
- 无 root、`/data/log/faultlog` 对 shell（uid 2000, log 组）Permission denied，拿不到完整 cppcrash backtrace。
  hiview / hiappevent CLI 在本设备不可用。`aa dump` / `bm dump` 不含崩溃栈。

## 二、已排除的假设（逐一验证）

| 假设 | 验证方法 | 结论 |
|---|---|---|
| `.so` 文件损坏 | 哈希比对 ours vs 官方 v37.2.3 release | **MATCH**（libelectron/libadapter/libffmpeg/libc++_shared 全一致） |
| 运行时 blob 版本不匹配（V8 snapshot） | 9 个 blob（icudtl.dat / snapshot_blob.bin / v8_context_snapshot.bin / resources.pak / chrome_* / electron / locales/*.pak）哈希比对 ours vs 官方 v37.2.3 release | **全部 MATCH** |
| release 混淆导致 | debug 包同样崩溃 | 排除 |
| bundleName 改名（org.fellow99.* vs 原 com.huawei.ohos_electron） | resfile 按 bundle 自动挂载，`ParseAssetsOHOS` 成功读到路径 | 排除 |
| main.js / dsh-dist / package.json 内容 | 用他机可运行 HAP 的 main.js(25774B) + package.json + dsh-dist.tar.gz(155MB) **整体替换**进本工程重编译 | **仍崩**，地址不变 → 排除内容 |
| 多余 `libs/arm64-v8a/electron`（13888B ELF） | 删除后重编译 | **仍崩**，地址不变 → 排除 |

## 三、决定性对照实验

`_test/` 目录提供了**另一台机器编译**的签名 HAP（370MB，2026-09-09）：

- 部署到同一台设备：**不崩溃**，进程稳定存活。
- 完整启动链路正常：
  ```
  [dsh-harmony] 首次启动，解压 dsh-dist.tar.gz → /data/storage/el2/base/files/dsh-dist
  [dsh-harmony] 解压完成，文件数: 50155
  [dsh-harmony] host 就绪: http://192.168.0.130:33397/
  [dsh-harmony] 已安装渲染进程 Host→loopback 改写，端口 33397
  ```
- dsh Host 完整运行，Web UI 加载成功。

**结论：相同源码 + 相同 .so + 相同 blob + 相同 main.js/dsh-dist，
他机编译不崩，本机编译崩。差异锁定在「本机编译/打包过程」。**

## 四、两个 HAP 的产物结构差异

| 项目 | 他机 HAP（不崩） | 本机 HAP（崩） |
|---|---|---|
| `libs/arm64-v8a/electron` | 无 | 有（13888B，已删） |
| `ets/modules.abc` | 1,356,056 B | 1,247,196 B（差 ~109KB） |
| `resources.index` | 18,493 B | 8,167 B |
| resfile 条目数 | 15 | 26（多 11 个官方 demo 残留文件，已清理） |
| 签名 / .so / blob / main.js | 完全一致 | 完全一致 |

`ets/modules.abc` 与 `resources.index` 的差异指向 **ArkTS 编译器 / hvigor 工具链版本不同**，
或**本机工程源码与他机工程源码存在细微版本差**。

## 五、下一步（待执行）

1. **拿到本机崩溃 backtrace**（根因定位的关键，目前缺失）：
   - 申请设备 root / userdebug 权限读 `/data/log/faultlog/temp/cppcrash-*.log`，或
   - 用 DevEco Studio 真机调试模式（自带崩溃栈抓取），或
   - 在应用内挂 `process.on('uncaughtException')` + 自定义信号处理（不适用 native SIGTRAP）。
2. **对齐工具链**：比对两台机器的 DevEco Studio / hvigor / ArkTS 编译器版本
   （`hvigor --version`、`param get const.ohos.version`），怀疑 ArkTS 编译器差异导致
   `modules.abc` 在 native 初始化期的行为不同。
3. **比对源码 commit**：他机 HAP 的 `ets/sourceMaps.map` 显示 267 个 .ets，
   需与他机工程的 git commit 对齐，确认是否同源同版本。
4. 拿到 backtrace 后，用 `harmonypc-electron/lib.unstripped/libelectron.so`（1.1GB，含符号）
   + `llvm-symbolizer`（`D:\oh-workspace\deveco-studio-6\sdk\default\openharmony\native\llvm\bin\`）
   符号化 `0x5c16aca77c` 所在库偏移，定位具体 CHECK 断言。

## 六、当前可用版本

`_test/build/default/outputs/default/electron-default-signed.hap`（他机编译）已验证可完整运行，
可作为**临时可用版本**部署。本机编译链修复前，建议直接分发该 HAP。

## 七、环境备忘

- hdc：`d:\oh-workspace\command-line-tools-6\sdk\default\openharmony\toolchains\hdc.exe`
- 构建必须用 DevEco JBR：`D:\oh-workspace\deveco-studio-6\jbr`（PATH 上的 Temurin 21 会触发 `Invalid CEN header`）
- 构建命令：`hvigorw assembleHap --mode module -p product=default -p buildMode=debug --no-daemon`
- llvm 工具链：`D:\oh-workspace\deveco-studio-6\sdk\default\openharmony\native\llvm\bin\`
- 未裁剪符号库：`harmonypc-electron/lib.unstripped/libelectron.so`
