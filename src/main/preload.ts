const { contextBridge, ipcRenderer } = require("electron");

// 暴露给渲染进程的API
contextBridge.exposeInMainWorld("mcpAPI", {
  // 连接到MCP服务器
  connectServer: (serverPath: string, serverName?: string) => {
    return ipcRenderer.invoke("connect-server", serverPath, serverName);
  },

  // 获取服务器列表
  getServerList: () => {
    return ipcRenderer.invoke("get-server-list");
  },

  // 添加新的MCP服务器
  addMcpServer: (serverPath: string, serverName: string) => {
    return ipcRenderer.invoke("add-mcp-server", serverPath, serverName);
  },

  // 切换活动服务器
  switchActiveServer: (serverId: string) => {
    return ipcRenderer.invoke("switch-active-server", serverId);
  },

  // 删除服务器连接
  removeServer: (serverId: string) => {
    return ipcRenderer.invoke("remove-server", serverId);
  },

  // 发送消息到AI
  sendMessage: (message: string) => {
    return ipcRenderer.invoke("send-message", message);
  },

  // 使用Agent模式发送消息到AI
  sendMessageWithAgent: (message: string) => {
    return ipcRenderer.invoke("send-message-with-agent", message);
  },

  // 获取当前AI模式（agent或普通模式）
  getAgentMode: () => {
    return ipcRenderer.invoke("get-agent-mode");
  },

  // 设置当前AI模式
  setAgentMode: (isAgentMode: boolean) => {
    return ipcRenderer.invoke("set-agent-mode", isAgentMode);
  },

  // 智能发送消息（根据当前模式自动选择）
  smartSendMessage: (
    message: string,
    files?: Array<{ path: string; name: string; type: string }>
  ) => {
    return ipcRenderer.invoke("smart-send-message", message, files);
  },

  // 直接与AI对话（不使用MCP工具）
  chatWithAI: (
    message: string,
    files?: Array<{ path: string; name: string; type: string }>
  ) => {
    return ipcRenderer.invoke("chat-with-ai", message, files);
  },

  // 选择服务器脚本文件
  selectServerScript: () => {
    return ipcRenderer.invoke("select-server-script");
  },

  // 选择文件上传
  selectFiles: (options?: { extensions: string[] }) => {
    return ipcRenderer.invoke("select-files", options);
  },

  // 获取文件临时路径
  getTempFilePath: (filePath: string) => {
    return ipcRenderer.invoke("get-temp-file-path", filePath);
  },

  // 保存上传的文件
  saveUploadedFile: (filePath: string, targetDir: string) => {
    return ipcRenderer.invoke("save-uploaded-file", filePath, targetDir);
  },

  // 监听事件
  onAIServiceReady: (callback: () => void) => {
    ipcRenderer.on("ai-service-ready", callback);
  },

  // 监听工具调用过程更新
  onToolCallUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on("tool-call-update", (_event: any, data: unknown) =>
      callback(data)
    );
  },

  // 监听工具调用结果更新
  onToolResultUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on("tool-result-update", (_event: any, data: unknown) =>
      callback(data)
    );
  },

  // 监听Agent最终回复
  onAgentFinalResponse: (callback: (data: unknown) => void) => {
    ipcRenderer.on("agent-final-response", (_event: any, data: unknown) =>
      callback(data)
    );
  },

  // 监听服务器列表更新
  onServerListUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on("server-list-update", (_event: any, data: unknown) =>
      callback(data)
    );
  },
});
