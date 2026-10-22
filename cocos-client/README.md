# 倒子麻将 - Cocos Creator 客户端

基于 Cocos Creator 3.8 的跨平台麻将客户端，可打包为 Web、Android、iOS 等平台应用。

## 环境要求

- **Cocos Dashboard** 2.x（用于安装和管理 Cocos Creator 编辑器）
- **Cocos Creator** 3.8.8（通过 Cocos Dashboard 安装）
- **Node.js** 18+
- **服务端** 已启动（Rust/actix-web，端口 8088）

## 安装步骤

### 1. 安装 Cocos Dashboard

1. 访问 [Cocos 官网](https://www.cocos.com/creator-download) 下载 Cocos Dashboard
2. 安装并登录 Cocos 账号（可免费注册）

### 2. 安装 Cocos Creator 编辑器

1. 打开 Cocos Dashboard
2. 在左侧选择「编辑器」
3. 点击「安装」→ 选择 **3.8.8** 版本
4. 等待下载安装完成

### 3. 导入项目

1. 在 Cocos Dashboard 左侧选择「项目」
2. 点击「添加」→ 选择此 `cocos-client` 目录
3. 选择 Cocos Creator 3.8.8 编辑器打开项目

### 4. 创建场景

首次打开项目时需要创建一个场景：

1. 在编辑器菜单选择 **文件** → **新建场景**
2. 保存到 `assets/scenes/main.scene`
3. 在层级管理器中选择 **Canvas** 节点
4. 在属性检查器中点击「添加组件」→ 搜索 `GameManager`
5. 将 `GameManager` 组件添加到 Canvas 节点
6. 保存场景（Ctrl+S / Cmd+S）

### 5. 配置服务器地址（可选）

默认连接 `ws://当前域名/ws`。如需修改：

编辑 `assets/scripts/WebSocketManager.ts` 中 `getDefaultServerUrl()` 方法的返回值。

开发时可改为：
```typescript
return 'ws://localhost:8088/ws';
```

## 构建发布

### Web 平台

1. 菜单 **项目** → **构建发布**
2. 平台选择 **Web Mobile** 或 **Web Desktop**
3. 点击「构建」，完成后点击「运行」预览

### Android

1. 安装 Android SDK 和 NDK（通过 Android Studio）
2. 在 Cocos Creator 中配置 SDK/NDK 路径
3. 构建时平台选择 **Android**
4. 包名：`com.daozi.mahjong`

### iOS

1. 需要 macOS + Xcode
2. 平台选择 **iOS**
3. Bundle ID：`com.daozi.mahjong`
4. 构建后用 Xcode 打开生成的项目进行签名和发布

## 项目结构

```
cocos-client/
├── .cocos-project.json          # Cocos 项目标识
├── package.json                 # 项目元数据
├── tsconfig.json                # TypeScript 配置
├── settings/                    # 项目设置
│   └── v2/packages/
│       ├── project.json         # 设计分辨率等
│       └── builder.json         # 构建配置
├── assets/
│   └── scripts/
│       ├── types.ts             # 类型定义（Tile, Meld 等）
│       ├── GameState.ts         # 全局游戏状态
│       ├── WebSocketManager.ts  # WebSocket 通信
│       ├── UIHelper.ts          # UI 组件工厂
│       ├── GameManager.ts       # 主控制器（挂 Canvas）
│       └── panels/
│           ├── LoginPanel.ts    # 登录注册
│           ├── LobbyPanel.ts    # 大厅（创建房间/计分器）
│           ├── RoomPanel.ts     # 房间等待
│           └── GamePanel.ts     # 游戏主界面
└── README.md
```

## 技术说明

- **UI 方式**：全部通过 TypeScript 代码动态创建（无需在编辑器中拖拽布局）
- **牌面渲染**：使用 `Graphics` 组件绘制牌背景 + `Label` 组件显示数字和花色
- **架构**：单场景 + 面板切换（LoginPanel → LobbyPanel → RoomPanel → GamePanel）
- **网络**：原生 WebSocket，与服务端 JSON 协议通信
- **适配**：使用 `view.getVisibleSize()` 动态适配不同分辨率

## 开发调试

1. 在编辑器中按 **Ctrl+P / Cmd+P** 可预览运行
2. 确保服务端已启动：`cd ../server && cargo run`
3. 浏览器 DevTools 可查看 WebSocket 通信日志
