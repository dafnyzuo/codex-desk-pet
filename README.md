# Codex Desk Pet

一个轻量、透明、常驻桌面的 macOS Codex 小伙伴。角色由一张照片制作而成，可以直接向本机 Codex 提问，也能接收拖入的文件。应用不保存账号信息，也不内置 API Key。

![Codex Desk Pet preview](docs/app-preview.png)

## 功能

- 透明悬浮、始终置顶，可拖到任意位置
- 迷你、小巧、标准三档尺寸；默认小巧模式约 `284×344`
- 回复气泡加宽、加高，长回答可滚动查看并停留更久
- 内置 7 张独立透明姿势帧：眨眼、点头、跳跃、探头、挥手、伸懒腰和受惊摇晃；待机随机播放并避免连续重复
- 单击会随机做一个短动作并回应；右键可打开“动作预览”逐个体验
- Seedance 连续动画：挥手时会真实移动手部、眨眼和呼吸，而不是只移动整张图片
- 拖动时靠近屏幕边缘会实时磁吸并显示方向提示，同时主动避开 Dock 与菜单栏
- 点击 `✦` 直接提问，显示真实的连接、处理和完成状态
- 支持把图片、文档或文件夹拖到桌宠上交给 Codex 阅读
- 任务完成时发送 macOS 系统通知
- 单击互动，双击打开本机 Codex
- 未安装或未登录 Codex 时，复制问题并自动打开 Codex/网页版
- 菜单栏入口、隐藏、重置位置和登录时启动
- 全局快捷键 `⌘⇧Space`：桌宠隐藏时重新显示，休眠时立即唤醒
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
- 点击 `✦`：展开快速提问框（`⌘/Ctrl + Enter` 发送）
- 拖入文件：附加到快速提问，最多 5 项
- 拖动角色：移动位置
- 右键角色：显示完整菜单，可在“桌宠尺寸”中切换迷你、小巧或标准
- 菜单栏图标：显示或隐藏桌宠
- 任意应用中按 `⌘⇧Space`：快速显示并唤醒桌宠

![Codex Desk Pet quick prompt](docs/prompt-preview.png)

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
git tag v1.3.0
git push origin v1.3.0
```

代码使用 MIT License。角色图片的授权范围不同，详见 [ASSET_LICENSE.md](ASSET_LICENSE.md)。

---

## English

Codex Desk Pet is a compact, always-on-top macOS companion. Ask Codex directly, drop local files for read-only analysis, track real task status, or double-click the pet to open Codex. No API key or account data is bundled with the app. Download the appropriate `arm64` or `x64` DMG from GitHub Releases.
