# Codex Desk Pet

一个轻量、透明、常驻桌面的 macOS Codex 小伙伴。角色由一张照片制作而成，应用不保存账号信息，也不内置 API Key。

![Codex Desk Pet preview](docs/app-preview.png)

## 功能

- 透明悬浮、始终置顶，可拖到任意位置
- 待机呼吸和点击反馈动画
- 单击互动，双击打开本机 Codex
- 未安装 Codex 时自动打开网页版
- 菜单栏入口、隐藏、重置位置和登录时启动
- Intel 与 Apple Silicon 双架构安装包

## 安装

1. 在 [GitHub Releases](https://github.com/dafnyzuo/codex-desk-pet/releases/latest) 下载与你的 Mac 对应的 DMG：
   - Apple Silicon（M1/M2/M3/M4…）：`arm64.dmg`
   - Intel Mac：`x64.dmg`
2. 打开 DMG，把 **Codex Desk Pet** 拖进 `Applications`。
3. 首次运行未签名版本时，在 Finder 中右键应用并选择“打开”。

> 当前 Release 工作流默认生成未签名安装包。公开大规模分发时，建议配置 Apple Developer 签名与公证。

## 使用

- 单击角色：随机互动
- 双击角色：打开 Codex
- 拖动角色：移动位置
- 右键角色：显示完整菜单
- 菜单栏图标：显示或隐藏桌宠

## 本地开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm run verify
npm start
```

构建本机目录版本：

```bash
npm run dist:dir
```

构建 Intel 与 Apple Silicon 的 DMG/ZIP：

```bash
npm run dist:mac
```

## 发布 GitHub Release

仓库已包含 `.github/workflows/release.yml`。推送版本标签后，GitHub Actions 会自动构建四个 macOS 文件并创建 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

代码使用 MIT License。角色图片的授权范围不同，详见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。

---

## English

Codex Desk Pet is a transparent, always-on-top macOS companion. Click it for a friendly reaction, drag it anywhere, or double-click it to open Codex. No API key or account data is bundled with the app. Download the appropriate `arm64` or `x64` DMG from GitHub Releases.
