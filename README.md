# MCP 客户端 - Electron 桌面应用

这是一个基于 Electron 的 MCP（Model Context Protocol）客户端桌面应用，用于与支持 MCP 协议的服务器进行交互，并通过 DeepSeek AI 处理请求。

## 功能特点

- 美观直观的用户界面
- 支持连接 JavaScript 和 Python 编写的 MCP 服务器
- 与 DeepSeek AI 平台集成，智能处理请求
- 工具调用可视化展示
- 消息历史记录
- 跨平台支持（Windows、macOS、Linux）

## 开发环境配置

1. 克隆仓库：

   ```
   git clone <仓库URL>
   cd mcp-client-electron
   ```

2. 安装依赖：

   ```
   npm install
   ```

3. 创建.env 文件，添加 DeepSeek API 密钥：

   ```
   DEEPSEEK_API_KEY=your_api_key_here
   ```

4. 开发模式启动：

   ```
   npm run dev
   ```

5. 构建应用：

   ```
   npm run build
   ```

6. 打包应用：
   ```
   npm run dist
   ```

## 使用指南

1. 启动应用后，点击"选择服务器脚本"按钮
2. 选择一个支持 MCP 协议的 JavaScript 或 Python 脚本文件
3. 连接成功后，在输入框中输入您的问题并发送
4. 查看 AI 回复和工具调用结果

## 技术栈

- Electron: 跨平台桌面应用框架
- TypeScript: 类型安全的 JavaScript 超集
- DeepSeek API: AI 处理服务
- Model Context Protocol (MCP): 工具调用协议

## 许可证

ISC

node build\index.js C:\coding\front\dingding-mcp-server\build\index.js