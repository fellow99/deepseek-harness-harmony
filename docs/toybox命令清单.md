# toybox 命令清单（真机逐条实测）

> **设备**：`3QC0226526001227` · HarmonyOS 6.1.0.135（API 24）· 2in1
> **实测日期**：2026-09-22 ｜ **toybox 版本**：`toybox 0.8.12`
> **shell**：`/system/bin/sh` = **mksh R59**（`@(#)MIRBSD KSH R59 2020/10/31`）—— **不是** toysh，见 §7
>
> 本清单**不是抄文档**，而是**在设备上逐条探测**得出。四步，全部可复现（§10）：
> 1. `toybox`（无参）→ 列出**编译进二进制**的 applet 集合；
> 2. `[ -L ]` + `readlink /system/bin/<n>` → 判定软链是否存在、指向何方（**不执行任何系统二进制**）；
> 3. `toybox <n> --help` → 判定 applet 是否真的可调度；
> 4. `unalias <n>; type <n>` → 判定该名字是否被 **mksh 内建/保留字**抢先（**必须先 unalias**，否则 130 条恒等 alias 会遮蔽真实解析）。
>
> 另有一组**功能实测**（§9）：在 `/data/local/tmp` 真实执行读写/文本/打包/校验操作，**原样贴出输出**。
>
> ## ⚠️ 两条安全警告（都是本清单实测踩出来的）
> 1. **不要对未知的 `/system/bin` 二进制传任意参数。** 首轮探测执行 `<n> --this-is-not-a-real-flag`，其中 **`/system/bin/reboot` 实际指向 `begetctl`**（不是 toybox），**直接把设备重启了**（`uptime` 证实 `up 0 min`）。第二轮已改为纯 `readlink` + `toybox <n> --help`，不再执行未知二进制。
> 2. **不要用 `command -v <n>` 判断"命令在哪/是否存在"。** 本设备 mksh 预置 **130 条恒等 alias**（`alias cat=cat`、`alias ls=ls`…），`command -v cat` 返回的是 `alias cat=cat` **而不是路径**（§6）。要路径就用 `type` / `whence -v` / `ls -l`。

---

## 1. 结论速览

| 类别 | 数量 | 含义 | 能否直接敲命令名 |
|---|---|---|---|
| **A 类 · 真 toybox** | **166** | 软链 → `toybox`，applet 已编译，**且不被 shell 拦截** | ✅ 可，跑的是 **toybox** |
| **A 类 · 被 shell 拦截** | **11** | 同样是 toybox 软链，但 **mksh 内建/保留字抢先** | ⚠️ 可，但跑的是 **mksh 的实现**（要 toybox 得写 `toybox <n>`） |
| **B 类 · 只能 `toybox <n>`** | **1** | applet 已编译，**没有软链** | ❌ 直接敲 → not found |
| **悬空软链（坏）** | **42** | 软链 → `toybox`，但 applet **未编译** | ❌ 敲了报 `toybox: Unknown command` |
| **非 toybox 软链** | **4** | 软链 → **别的系统程序**（`begetctl` / `fsck.f2fs`） | ⚠️ 会真的执行那个程序（见 §5 的 `reboot`） |
| 裸名不存在 | 4 | `type` 报 not found | ❌ |
| （合计）编译进 toybox | 178 | `toybox` 无参输出 | — |

**一句话**：**166 个可直接当 toybox 用；11 个名字会落到 mksh 自己的实现；只有 `nc` 必须写 `toybox <n>`；另有 42 个软链是坏的、4 个软链指向别的程序（危险）。**

> **与既有文档的关键差异（实测推翻推测）**
> - 本工程原按 OpenHarmony 上游默认 `toybox_extended_cmd = false` 推测 C 类命令"未验证"。**本设备该 flag 已启用**：`awk` / `wget` / `diff` / `expr` / `tr` / `telnet` / `traceroute` / `traceroute6` / `getfattr` / `ipcs` **全部已编译、软链齐全、可直接用**。
> - 原记录"B 类约 18 项（`base32 blkid nc route reboot sha224sum…`）"**不成立**：本设备 **B 类只有 `nc` 一个**；其余多为**悬空软链**或**已编译并软链**。

---

## 2. A 类：可直接调用（177）

- **`✓`** = 已在 §9 功能实测中产生**正确输出**；
- **`(mksh)`** = 该名字被 **mksh 内建/保留字**抢先，**裸名跑的是 mksh 实现**；要强制用 toybox 请写 `toybox <名字>`。

### 文件与目录（34）

`basename` ✓、`cat` ✓ (mksh)、`cmp`、`comm`、`cp` ✓、`cpio`、`dd`、`df` ✓、`dirname` ✓、`du` ✓、`file`、`find` ✓、`install`、`link`、`ln` ✓、`ls` ✓、`lsattr`、`mkdir` ✓、`mkfifo`、`mknod`、`mktemp`、`mv` ✓、`readlink`、`realpath` ✓ (mksh)、`rm`、`rmdir`、`shred`、`split`、`stat` ✓、`tar` ✓、`touch`、`truncate`、`unlink`、`xargs` ✓

### 文本处理（31）

`awk` ✓、`cat` ✓ (mksh)、`cut` ✓、`diff` ✓、`dos2unix`、`echo` (mksh)、`egrep`、`expand`、`fgrep`、`fmt`、`grep` ✓、`head` ✓、`hexedit`、`iconv`、`more`、`nl`、`od` ✓、`paste`、`patch`、`printf` ✓、`rev`、`sed`、`sort` ✓、`strings`、`tac`、`tail` ✓、`tr` ✓、`uniq` ✓、`unix2dos`、`wc` ✓、`xxd` ✓

### 进程与作业（19）

`iotop`、`ipcs`、`kill` (mksh)、`killall`、`lsof`、`nice`、`nohup`、`nsenter`、`pgrep`、`pidof`、`pkill`、`prlimit`、`ps`、`renice`、`setsid`、`taskset`、`time` (mksh)、`timeout`、`top`

### 系统信息与配置（17）

`chroot`、`date` ✓、`dmesg`、`env` ✓、`free`、`groups`、`hostname`、`id` ✓、`logname`、`printenv`、`sysctl`、`uname` ✓、`uptime`、`vmstat`、`which` ✓、`who`、`whoami`

### 网络（6）

`ftpget`、`ftpput`、`ifconfig`、`netstat`、`ping`、`ping6`

### 硬件 / I²C / 内核模块（4）

`insmod`、`lsmod`、`reset`、`rmmod`

### 终端与其它（4）

`clear`、`help`、`tty`、`watch`

### 其它（63）

`base64` ✓、`cal`、`chcon`、`chgrp`、`chmod` ✓、`chown`、`chvt`、`cksum`、`count`、`crc32`、`expr`、`factor`、`fallocate`、`false` (mksh)、`flock`、`freeramdisk`、`fstype`、`fsync`、`getconf` ✓、`getfattr`、`gunzip` ✓、`gzip`、`inotifyd`、`lspci`、`lsusb`、`mcookie`、`md5sum` ✓、`mkpasswd`、`mkswap`、`mount`、`mountpoint`、`netcat`、`nproc`、`pwd` (mksh)、`pwdx`、`readahead`、`route`、`seq` ✓、`setfattr`、`sha1sum`、`sha256sum`、`sha384sum`、`sha512sum`、`sleep` (mksh)、`swapoff`、`swapon`、`sync`、`tee`、`telnet`、`test` ✓ (mksh)、`traceroute`、`traceroute6`、`true` (mksh)、`ulimit` (mksh)、`umount`、`usleep`、`uudecode`、`uuencode`、`uuidgen`、`w`、`wget`、`yes`、`zcat`

---

## 3. B 类：applet 已编译，但没有软链（1 个）

**裸名会 `not found`**，必须写 `toybox <n>`。

| 名字 | 正确用法 | 说明 |
|---|---|---|
| `nc` | `toybox nc` | TCP/UDP 瑞士刀。`readlink /system/bin/nc` → 空、`type nc` → `not found`，但 `toybox nc --help` → 正常 |

---

## 4. 悬空软链：看起来有、其实是坏的（42 个）

这些名字**在 `/system/bin` 里是软链**且 `readlink` 明确指向 `toybox`，**但该 applet 没编译进二进制** → 执行得到 `toybox: Unknown command <n>`。

> ⚠️ **用 `ls` 或 `command -v` 判断"有没有"会误判为可用。** 判定必须用 `toybox <n> --help`。

`acpi`、`arch`、`ascii`、`blockdev`、`bunzip2`、`bzcat`、`chattr`、`chrt`、`devmem`、`dnsdomainname`、`eject`、`fsfreeze`、`halt`、`hwclock`、`i2cdetect`、`i2cdump`、`i2cget`、`i2cset`、`ionice`、`iorenice`、`killall5`、`logger`、`login`、`losetup`、`makedevs`、`microcom`、`mix`、`modinfo`、`nbd-client`、`oneit`、`partprobe`、`passwd`、`pivot_root`、`pmap`、`poweroff`、`rfkill`、`sendevent`、`sntp`、`switch_root`、`tunctl`、`unshare`、`vconfig`

---

## 5. 非 toybox 软链：指向别的系统程序（4 个）

**不是** toybox applet，且**会真的执行目标程序** —— 探测时必须排除。

| 名字 | readlink 目标 | 备注 |
|---|---|---|
| `reboot` | `begetctl` | ⚠️ **真实系统服务控制程序** —— 本轮 `reboot --<乱写的参数>` **确实重启了设备** |
| `resize.f2fs` | `fsck.f2fs` | fsck 家族（文件系统检查） |
| `service_control` | `begetctl` | ⚠️ **真实系统服务控制程序** —— 本轮 `reboot --<乱写的参数>` **确实重启了设备** |
| `sload.f2fs` | `fsck.f2fs` | fsck 家族（文件系统检查） |

---

## 6. mksh 的两层"遮蔽"（本设备特有，极易踩坑）

本设备的 mksh **预置了 139 条 alias**，其中 **130 条是恒等 alias**（`cat=cat`、`ls=ls`…），另有 9 条 mksh 自身用途（`autoload` / `functions` / `hash` / `history` / `integer` / `local` / `nameref` / `r` / `type`）。

### 6.1 第一层：恒等 alias —— 影响 `command -v`（不影响执行）

```
$ command -v cat        →  alias cat=cat        （不是 /bin/cat！）
$ command -v ls         →  alias ls=ls
```

**后果**：任何用 `command -v` / `which` 推断二进制路径或判定"命令是否可用"的脚本，在本设备上会拿到 **alias 字符串**。判路径请用 `type` / `whence -v`。

> `which` 实测返回 `/bin/cat`（`which` 是 toybox applet，不走 mksh 的 alias 表），而 `command -v` 是 **mksh 内建**，会走。两者结论不同，别混用。

### 6.2 第二层：真·内建/保留字 —— 影响**执行**（11 个）

**只有**下列名字裸名会跑到 **mksh 自己的实现**（`unalias` 后 `type` 报 `is a shell builtin` / `is a reserved word`）：

| 名字 | `type` 判定 | 说明 |
|---|---|---|
| `cat` | `is a shell builtin` | 裸名 = mksh 实现；`toybox cat` = toybox 实现 |
| `echo` | `is a shell builtin` | 裸名 = mksh 实现；`toybox echo` = toybox 实现 |
| `false` | `is a shell builtin` | 裸名 = mksh 实现；`toybox false` = toybox 实现 |
| `kill` | `is a shell builtin` | 裸名 = mksh 实现；`toybox kill` = toybox 实现 |
| `pwd` | `is a shell builtin` | 裸名 = mksh 实现；`toybox pwd` = toybox 实现 |
| `realpath` | `is a shell builtin` | 裸名 = mksh 实现；`toybox realpath` = toybox 实现 |
| `sleep` | `is a shell builtin` | 裸名 = mksh 实现；`toybox sleep` = toybox 实现 |
| `test` | `is a shell builtin` | 裸名 = mksh 实现；`toybox test` = toybox 实现 |
| `true` | `is a shell builtin` | 裸名 = mksh 实现；`toybox true` = toybox 实现 |
| `ulimit` | `is a shell builtin` | 裸名 = mksh 实现；`toybox ulimit` = toybox 实现 |
| `time` | `is a reserved word` | shell 语法保留字，与 toybox `time` **无关** |

> ⚠️ **注意 `printf` 不在其中** —— `unalias printf; type printf` → `printf is a tracked alias for /bin/printf`，即 **`printf` 走 PATH 上的 toybox**。同理 `ls` / `grep` / `sed` 等都**不是**内建，走的仍是 toybox。（此前把 `printf` 等一并写进"内建遮蔽"的说法**不准确，已更正**。）

---

## 7. shell 身份：`/system/bin/sh` = mksh R59（**不是** toysh）

| 探针 | 结果 | 可信 |
|---|---|---|
| `KSH_VERSION` | `@(#)MIRBSD KSH R59 2020/10/31` | ✅ **决定性** |
| `readlink /system/bin/sh` | 空 → `sh` 是**普通文件**，不是软链 | ✅ |
| `md5sum /system/bin/sh` vs `toybox` | `5b5e8eb9…` vs `19f83712…` → **不同** | ✅ |
| `readlink /proc/self/exe` | 报 `/system/bin/toybox` | ❌ **会骗人，勿用** |
| `uname -a` 结尾 | `…aarch64 Toybox`（内核 utsname） | ❌ **与 shell 无关** |

---

## 8. 未编译：对照 OpenHarmony 参考构建

本设备**没有**下列名字（多为 §4 的悬空软链）：

```
acpi arch ascii blockdev bunzip2 bzcat chattr chrt devmem dnsdomainname eject fsfreeze halt
hwclock i2cdetect i2cdump i2cget i2cset ionice iorenice killall5 logger login losetup makedevs
microcom mix modinfo nbd-client oneit partprobe passwd pivot_root pmap poweroff restorecon rfkill
sendevent sntp switch_root tunctl unshare vconfig
```

**整体不存在**：`bash`、`busybox`、`vi`、`man`、`strace`、`bc`、`fdisk`、`fsck`、`crond` 及 **GNU coreutils 全家**。

---

## 9. 功能实测（原始输出）

在 `/data/local/tmp/tbprobe` 真实执行，**原样贴出**：

```
cat: hello
ls: a.txt 
cp: rc=0 b=hello
mv: rc=0 c_exists=Y
mkdir: rc=0
find: ./a.txt ./c.txt ./d/e/f.txt 
grep: 1:x
sed1: x
awk: 1:x 2:y 3:z 
sort: x y z 
uniq:       1 x       1 y       1 z 
wc: 3
head: x
tail: z
cut: x y z 
tr: HELLO
od:  h e l l o 

xxd: 00000000: 6865 6c6c 6f0a                           hello.
md5sum: b1946ac92492d2347c6235b4d2611184  a.txt
stat: size=6
printf: p-q
date: 2026
test: TEST_OK
TIMEOUT_OK
tar: rc=0 list=a.txt 
gunzip: hello
xargs: x y z 
ln: cannot create hard link from 'a.txt' to 'hard.txt': Permission denied
ln-hard: rc=1 content=/data/local/tmp/tbprobe2.sh[59]: cat: hard.txt: No such file or directory
ln-soft: rc=0 target=a.txt
diff: rc=0
base64: aGVsbG8K
seq: 1 2 3 
env-count: 18 vars
id: uid=2000(shell) gid=2000(shell) groups=2000(shell),1006(file_manager),1007(log),1097(netsys_socket),3009(readproc) context=u:r:sh:s0
uname-s: HarmonyOS
getconf: 4096
which: /bin/cat
basename: c.txt
dirname: /a/b
realpath: /data/local/tmp/tbprobe/a.txt
chmod: rc=0 mode=640
du: 15	.
df: /dev/block/platform/b0000000.hi_pcie/by-name/userdata 972831044 80008332 892691640 9% /data
cleanup-rc=0
```

### 9.1 实测中的两个重要发现

1. **`ln -s`（软链）与 `chmod` 在 shell 上下文里成功** —— 与"平台全局禁止 symlink/chmod"的印象相反：
   `ln -s a.txt soft.txt` → `rc=0 target=a.txt`；`chmod 640 a.txt` → `rc=0 mode=640`。
   原因见 `id` 输出：**shell 运行在 `context=u:r:sh:s0`**，而**第三方应用**在各自的应用域 → 平台限制**按 SELinux 域生效**，限制的是**应用域**，不是 shell 域。
   ⚠️ 因此 `docs/ACL申请清单-v2.md` 与相关 spec 中"symlink/chmod 对三方应用不可用"的表述**应限定为「应用域」**，不要写成"平台全局禁止"。
2. **硬链仍被拒**：`ln a.txt hard.txt` → `Permission denied`（与既有记录一致）。即：**软链在 shell 域可用，硬链不可。**

---

## 10. 复现步骤

```bash
# ① 编译集
hdc shell toybox                                   # → 178 个 applet 名单
hdc shell "toybox --version"                       # → toybox 0.8.12

# ② 软链真相（安全，不执行）
hdc shell "readlink /system/bin/cat"               # → toybox          （A 类）
hdc shell "readlink /system/bin/nc"                # → 空              （B 类）
hdc shell "readlink /system/bin/acpi"              # → toybox          （但未编译 → 悬空）
hdc shell "readlink /system/bin/reboot"            # → begetctl        （不是 toybox！勿执行）

# ③ applet 是否可调度
hdc shell "toybox awk --help | head -1"            # 有输出 → 已编译

# ④ 是否被 shell 抢先（必须先 unalias）
hdc shell "sh -c 'unalias cat; type cat'"          # → cat is a shell builtin
hdc shell "sh -c 'unalias printf; type printf'"     # → tracked alias for /bin/printf（未被抢先）

# ⑤ 功能实测（安全，用 scratch 目录）
hdc shell "mkdir -p /data/local/tmp/t && cd /data/local/tmp/t && echo hi > a && cat a && md5sum a && rm -f a"
```

---

## 11. 对既有文档的同步结果

下表为**已执行的同步**（截至 2026-09-22）：

| 文档 | 原表述 | 处理 | 状态 |
|---|---|---|---|
| `specs/010-tool-bash/spec.md` FR-4.2 / §2.3 | C 类（`awk/wget/diff/expr/tr/telnet/traceroute`）标 `未验证` | 改为**本设备实测全部可用**（`toybox_extended_cmd` 已启用） | ✅ 已改 |
| 同上 FR-4.1 / §2.3 | "B 类含 `base32 blkid nc route reboot sha224sum…`（约 18 项）" | 改为**B 类只有 `nc`**；其余为**悬空软链**或已编译 | ✅ 已改 |
| 同上 FR-4.1 / FR-4.6 | 未提"悬空软链"与 `command -v` 陷阱 | 补：**42 个悬空软链**；判定必须用 `toybox <n> --help`；`command -v` 返回 alias 而非路径 | ✅ 已改 |
| 同上 FR-4.6 | "mksh 内建遮蔽 `time test pwd realpath ulimit kill echo printf`"（**过宽，且 `printf` 错**） | 更正为：内建 10 个（`cat echo false kill pwd realpath sleep test true ulimit`）+ 保留字 `time`；**`printf` / `ls` / `grep` / `sed` 不在此列** | ✅ 已改（含显式"上一版不准确"更正） |
| `skills/harmony-runtime-capabilities/SKILL.md` | 同上（含过宽遮蔽清单） | 已更正，并补悬空软链 / `command -v` alias 陷阱 / extended_cmd 已启用 | ✅ 已改 |
| `plugins/harmony-plugin-exec/README.md` + `README_zh.md` | 同上 | 已更正 | ✅ 已改 |
| `logs/20260922-1/TEST_REPORT.md` | 无本轮 toybox 逐条实测记录 | 追加「附三：toybox 逐条实测」章节 | ✅ 已改 |
| `docs/ACL申请清单-v2.md` | "symlink/chmod 对三方应用不可用" | **已限定为「应用域」**（shell 域 `u:r:sh:s0` 下 `ln -s`/`chmod` 均成功；硬链两边都不可） | ✅ 已改（2026-09-22） |
| `docs/鸿蒙环境能力清单-v0.1.5.md` | 同上 | 同上；并新增**第三个"会骗人的探针"**：`hdc shell` 看不到 `/data/service/hnp`（SELinux 以 ENOENT 隐藏），应用域却能看到 —— 结论必须以应用域为观测点 | ✅ 已改（2026-09-22） |
| 插件 `harmony-plugin-exec` 的 A/B/C/D 分级与**工具描述文本** | 仍按上游推测书写 | **已按实测重写** `lib/inventory.js`：A=177（内含 10 个 extended）、B=`['nc']`、C=空（flag 已启用）、D 保留、新增 `DANGLING_SYMLINKS`(42) / `NON_TOYBOX_SYMLINKS`(4) / `SHADOWED_BUILTINS`(10) / `RESERVED_WORDS`(`time`)；工具描述同步（含 TRAP 与 `reboot→begetctl` 警示） | ✅ 已改（2026-09-22） |

---

## 12. 附：原始数据文件

**已归档进仓库**（不再只留在临时目录）：`logs/20260922-1/toybox-probe/`

| 文件 | 内容 |
|---|---|
| `tb-list.txt` | `toybox`（无参）原始输出 —— 178 个 applet |
| `systembin.txt` | `ls -l /system/bin` 原始输出（227 软链 + 157 普通文件） |
| `tbprobe2-out.txt` | **安全探测完整输出**（512 行：META / LINK / PERCOMMAND / BATTERY） |
| `tbprobe3-out.txt` | `type` 判定（alias / tracked alias / reserved / not found） |
| `builtin-all-out.txt` | `unalias` 后的真实解析（BUILTIN / RESERVED / PATH / ABSENT） |
| `alias-all.txt` | mksh 的 139 条 alias 全表 |
| `tbprobe2.sh` / `tbprobe3.sh` / `builtin-all.sh` / `alias-all.sh` | 探测脚本（**可直接复现**；`tbprobe2.sh` 为安全版，不含执行未知二进制） |
| `parse-toybox2.cjs` / `gen-doc2.cjs` | 集合解析与本清单的生成脚本（保证数据→文档无人工转录） |

> ⚠️ **首轮（不安全）脚本未归档**：它含 `<n> --this-is-not-a-real-flag` 循环，**会触发 `reboot`→`begetctl` 重启设备**，故意不保留以免被误用。

