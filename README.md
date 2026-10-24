# CineEcho：开车听电影原声学英语

把电影音频和英文 SRT 字幕上传到自己的服务器，服务器会按字幕时间把每句对白切成单独的音频，去掉无对白部分。iPhone App 下载后可离线连续播放。锁屏、蓝牙车机和方向盘的“上一曲/下一曲”都按句跳转。

```
server/  Node.js + TypeScript + ffmpeg + SQLite 服务端，含 Web 管理后台（Docker 部署）
app/     Expo / React Native iPhone App（EAS 云构建，Windows 上也能出 iOS 包）
```

## 1. 部署服务端

### 云服务器（Docker）
```bash
cd server
cp .env.example .env        # 修改 CINEECHO_PASSWORD
docker compose up -d --build
```
- 后台地址为 `http://<服务器IP>:8080`，用密码登录后上传 **音频 + SRT**。
- 数据保存在 `server/data/`（数据库、原始文件、切好的句子），记得备份。
- 建议用 Caddy 或 Nginx 加 HTTPS，例如 Caddyfile 写 `cine.example.com { reverse_proxy localhost:8080 }`。
  App 允许 http，但用 http 时密码是明文传输。
- 如果上传大文件失败，请检查反向代理的上传大小限制（Nginx 为 `client_max_body_size`）。

### 本地开发（需要 Node ≥ 22.13 和 ffmpeg）
```powershell
cd server
npm install
$env:CINEECHO_PASSWORD="test"; npm run dev
npm test
```

## 2. 构建并安装 iPhone App

有两种方式，任选一种：

| | 方式 A：免费 Apple ID（推荐先用） | 方式 B：付费开发者账号 |
|---|---|---|
| 费用 | 免费 | 99 美元/年 |
| 有效期 | **7 天**，到期需重新签名（数据不丢） | 1 年 |
| 需要 | GitHub 账号 + Windows 上的 Sideloadly | Expo 账号 |

### 方式 A：GitHub Actions 编译 + Sideloadly 免费签名

1. 把整个 `CineEcho` 文件夹推到你的 GitHub 仓库（建议设为私有）。
2. 打开仓库 → Actions → **iOS unsigned IPA** → Run workflow。约 20–30 分钟后，在本次运行页面底部的 Artifacts 下载 `CineEcho-unsigned-ipa`，解压得到 `CineEcho-unsigned.ipa`。
   以后打 `v*` 标签（如 `v1.0.1`）推送时也会自动编译。
3. Windows 上安装 [iTunes（官网版，非微软商店版）](https://www.apple.com/itunes/) 和 [Sideloadly](https://sideloadly.io/)。
4. 用数据线连接 iPhone，在手机上点“信任此电脑”。
5. 打开 Sideloadly，把 ipa 拖进去，填写 Apple ID，点 Start。
   - 建议用一个专门的小号 Apple ID。
   - 如果提示 bundle id 冲突，在 Advanced Options 里勾选修改 Bundle ID。
6. iPhone 上打开：设置 → 通用 → VPN 与设备管理 → 信任你的 Apple ID；iOS 16 及以上还需打开：设置 → 隐私与安全性 → 开发者模式，然后重启。
7. **每 7 天**用 Sideloadly 重新安装一次同一个 ipa 即可续期（下载的电影和进度都会保留）。
   - Sideloadly 可开启 Wi-Fi 自动续签：电脑开着且和手机在同一 Wi-Fi 时会自动续。
   - 免费 Apple ID 同时最多只能装 3 个侧载 App。

### 方式 B：付费开发者账号 + EAS 云构建

1. 注册 Apple Developer（99 美元/年）。可在 iPhone 上用 “Apple Developer” App 注册。
2. 注册 Expo 账号：https://expo.dev。
3. 在 Windows 上执行：
   ```powershell
   cd app
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest device:create      # 用 iPhone 扫码，注册设备 UDID
   npx eas-cli@latest build -p ios --profile preview
   ```
   - 第一次构建时，EAS 会让你登录 Apple 账号，并自动创建证书和描述文件。
   - 如果 bundle id `com.cineecho.app` 已被占用，请在 `app/app.json` 中改成自己的，例如 `com.<你的名字>.cineecho`。
4. 构建完成后，用 iPhone 扫描页面上的二维码安装。
   iOS 16 及以上需要打开：设置 → 隐私与安全性 → 开发者模式。

## 3. 使用

1. 在后台上传音频（mp3/m4a/mp4/mkv/wav 等）和英文 SRT，可同时上传一张海报（jpg/png/webp，可选），等待状态变成“就绪”。之后也可在列表里“传海报/换海报/删海报”。
2. 打开 App → 右上角“设置”，填写服务器地址和密码，然后登录。
3. 在列表中点电影开始下载；下载完成后再点即可播放。顶部搜索框可按电影名称筛选。长按可删除本地缓存。
4. 开车时：
   - 方向盘或车机的“下一曲/上一曲”跳到下一句或上一句，“播放/暂停”照常使用。
   - 锁屏显示当前句的英文。
5. 播放页只有播放/暂停按钮和进度条。拖动进度条会跳到该位置所在句的开头。语速（0.75–1.25x）、句间停顿（0–3 秒）和循环模式（不循环/单部/列表）可在下方切换。每部电影会记住进度。

## 界面预览（Windows 浏览器，演示数据，无声音）
```powershell
cd app
npx expo start --web
```
`src/lib/*.web.ts` 只用于预览，iOS 构建不会使用它们。

## 免费真机试听（Expo Go，不需要开发者账号）
iPhone 从 App Store 安装 Expo Go，和电脑连同一个 Wi-Fi，然后在电脑上执行 `cd app; npx expo start --go`，再用 iPhone 相机扫码。
这种方式依赖电脑一直运行，只适合试听；开车日常使用请按第 2 节安装独立的 App。

## 4. 已知限制（请在真机上验证）
- 一部电影约 1000–2000 句，每句都是一个播放列表项。首次加载和“上一句”需要重建队列，在很长的电影上可能稍有卡顿。
- 句间停顿在后台依靠 JS 定时器加静音播放保持存活；如果锁屏后停顿不生效，可以把停顿设为 0。
- 字幕严格按 SRT 时间切割。如果句首或句尾被截断，说明字幕时间轴偏紧，可以先调整 SRT 再在后台点“重新处理”。
- 服务器重新处理电影后，App 中已下载的旧版本不会自动更新，需要删除后重新下载。
