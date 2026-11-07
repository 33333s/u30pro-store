# U30 Pro 插件商店

中兴 U30 Pro 原生 OpenWrt 固件（p540 起）的 apk 软件源：屏幕插件、内核模块和一些设备专用的服务。

软件源地址：

```
https://raw.githubusercontent.com/33333s/u30pro-store/main/aarch64_generic/packages.adb
```

## 在设备上使用

第一次要手动装上本源的签名公钥和地址（`u30pro-feed` 包）：

```sh
wget -O /tmp/u30pro-feed.apk https://raw.githubusercontent.com/33333s/u30pro-store/main/aarch64_generic/u30pro-feed-1.0-r2.apk
apk add --allow-untrusted /tmp/u30pro-feed.apk
apk update
```

之后和 OpenWrt 官方源一样用：`apk add u30pro-screen-thermal`，或者在 LuCI「系统 → 软件包」里装。索引的签名会校验（公钥 `/etc/apk/keys/u30pro-feed.pem`）。

## 包

| 包 | 作用 |
|---|---|
| `u30pro-feed` | 本源的公钥和地址（`/etc/apk/repositories.d/u30pro.list`） |
| `u30pro-screen-data` | 屏幕插件：移动数据开关 |
| `u30pro-screen-clients` | 屏幕插件：连着路由器的设备（DHCP 租约） |
| `u30pro-screen-thermal` | 屏幕插件：处理器、电池、主板、充电芯片、射频和环境温度 |
| `u30pro-screen-speedtest` | 屏幕插件：下载测速（10 MB） |
| `zwrt-datad` | 设备状态与控制服务（HTTP/SSE，端口 9460 仅本机，9461 局域网需登录），源码在 [zwrt-datad](https://github.com/33333s/zwrt-datad) 的 `u30pro` 分支 |
| `luci-app-zwrt-datad` | LuCI 页面“服务 → zwrt-datad”：云管理（接入 NMS 的状态、用 NMS 显示的凭据快速接入、连接设置）和网页终端（依赖 `zwrt-datad`） |
| `luci-theme-argon` | LuCI 主题 Argon 3.1.0（[jerrykuku/luci-theme-argon](https://github.com/jerrykuku/luci-theme-argon)，Apache-2.0，作者编好的包原样收录）；设置页 `luci-app-argon-config`，中文 `luci-i18n-argon-config-zh-cn` |
| `luci-theme-aurora` | LuCI 主题 Aurora 1.4.0（[eamonxg/luci-theme-aurora](https://github.com/eamonxg/luci-theme-aurora)，Apache-2.0，作者编好的包原样收录） |
| `luci-theme-u30pro` | 本机专用的 LuCI 主题：极简外观、带图标的侧边菜单（手机上是抽屉）、深浅色，带机身示意图的“概览”首页（屏幕主页实时画面，设了屏幕壁纸时一并画出，动态壁纸也会播放，卡片带开关）。装上即切换到它，需要 p542-s120 起的固件（屏幕壁纸要 p542-s124 起，“系统 → 按键”和“系统 → 屏幕”要 p542-s126 起）。NFC、按键、屏幕这些后端是固件自带的，不是软件包，旧固件上概览页会提示需要更新固件。样式底层是 Bootstrap 主题（Apache-2.0），图标是 Lucide 子集（ISC） |
| `luci-app-sms-forward` | 短信转发：收到的短信转发到 Telegram、Bark、PushPlus、Server 酱、钉钉、企业微信、飞书机器人、自定义 Webhook 或另一个手机号；可按发件人、内容过滤，长短信等分段到齐再发，失败重试，开启前已有的短信不发。页面在「蜂窝基带 → 短信转发」。依赖 curl |
| `luci-app-ttl` | 固定从蜂窝侧发出的包的 IPv4 TTL 和 IPv6 跳数限制（nftables 网卡 egress 规则，流量卸载开着也生效）。页面在「网络 → TTL 与跳数限制」 |
| `u30pro-kmod-loader` | 开机加载已装的内核模块包 |
| `kmod-*` | 内核模块，205 个，包名和 OpenWrt 25.12 一致（文件系统、存储、隧道、流量控制、netfilter 扩展、加密等） |

屏幕插件装好后 10 秒内出现在屏幕的功能页，卸载后消失，不用重启。

## 内核模块：每个内核一份

这个内核没有符号版本，模块只能用在编译它的那一次内核构建上。每个 `kmod-*` 都依赖 `u30pro-kernel-<build id 前 12 位>`，只有同一个内核的固件才提供它，所以在别的固件上 apk 会直接拒绝安装。

- 固件 p543 起，每个内核的模块放在自己的目录 `aarch64_generic/kmods/<build id 前 12 位>/`，有单独签名的索引。固件自带指向自己那一份的源地址（`/etc/apk/repositories.d/u30pro-kmods.list`），不用另外设置。
- p540～p542 的固件（内核 `89cf01ae97b8`）用的是 `aarch64_generic/` 里的那一套，这一套一直保留，不会因为出了新内核就装不上。
- 旧内核的目录也都保留：不升级固件，照样装得到自己内核的模块。

| 内核 build id | 固件 | 目录 | 配置 |
|---|---|---|---|
| `89cf01ae97b8` | p540～p542 | `aarch64_generic/` | `kernel-p540.config` |
| `4d35658e55ed` | p543 | `aarch64_generic/kmods/4d35658e55ed/` | `kernel-p543.config` |
| `c73608bc74c4` | p544 | `aarch64_generic/kmods/c73608bc74c4/` | `kernel-p544.config` |
| `ae56783b951a` | p553 起 | `aarch64_generic/kmods/ae56783b951a/` | `kernel-p553.config` |

模块从 kernel.org 的 Linux 6.12.94 加上 U30 Pro 移植补丁编译，配置见表里的文件。

## 自己写屏幕插件

插件就是 `/usr/share/u30pro/ui-plugins/` 下的一个 `<名字>.plugin` 文本文件（`key=value`，`#` 开头是注释，UTF-8），加上它调用的脚本。`packages/u30pro-screen-*` 是现成的例子。

| 键 | 含义 |
|---|---|
| `title` | 按钮下面的名字（必填，大约显示 7 个汉字） |
| `icon` | 内置图标：`wifi bolt gear sun moon mail chart globe power refresh info app` |
| `glyph` | 没有 `icon` 时按钮里画的一个字（默认取标题第一个字） |
| `type` | `info`（默认）、`action`、`toggle`、`qr` |
| `cmd` | 用 `/bin/sh` 以 root 运行的命令，收集它的输出 |
| `state_cmd` | 只用于 `toggle`：输出 `1` 或 `on` 表示开 |
| `text` | 只用于 `qr`：要编码的文本（也可以用 `cmd` 输出的第一行） |
| `refresh` | 只用于 `info`：页面打开时每隔几秒重新运行 `cmd`（2–3600，默认 5） |
| `order` | 菜单里的位置，小的在前（默认 50，内置项总在最前） |

- `info`：点开显示 `cmd` 输出的前 6 行（每行 47 个字符）。
- `action`：点一下运行一次 `cmd`，输出的第一行作为提示。
- `toggle`：开关按钮；功能页可见时每 5 秒跑一次 `state_cmd`，点击后运行 `cmd` 去切换。
- `qr`：显示二维码。

最多 24 个插件。命令在后台运行、没有超时，要写成很快结束的。插件以 root 身份运行，只装信得过的包。

## 目录

| 路径 | 内容 |
|---|---|
| `aarch64_generic/` | 软件源本身：各个 `.apk`、签名的索引 `packages.adb`、清单 `feed.json` |
| `packages/` | 非内核模块包的源文件（脚本、插件文件、包描述）；`zwrt-datad` 的二进制由它自己的仓库编译 |
| `kernel-p540.config` | 编译这些模块的内核配置 |

签名私钥不在这里。

## 许可

本仓库的脚本和插件用 MIT 许可证。内核模块是 Linux 内核的一部分，按 GPL-2.0 发布。
