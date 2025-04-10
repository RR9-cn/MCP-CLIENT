const { contextBridge, ipcRenderer } = require("electron");

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld("mcpAPI", {
  // 连接到MCP服务器
  connectServer: (serverPath: string) => {
    return ipcRenderer.invoke("connect-server", serverPath);
  },

  // 发送消息到AI
  sendMessage: (message: string) => {
    return ipcRenderer.invoke("send-message", message);
  },

  // 直接与AI对话（不使用MCP工具）
  chatWithAI: (message: string) => {
    return ipcRenderer.invoke("chat-with-ai", message);
  },

  // 选择服务器脚本文件
  selectServerScript: () => {
    return ipcRenderer.invoke("select-server-script");
  },

  // 监听事件
  onAIServiceReady: (callback: () => void) => {
    ipcRenderer.on("ai-service-ready", callback);
  },
});
