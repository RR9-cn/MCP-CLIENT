import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import * as url from "url";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { DeepSeekAIService } from "../services/DeepSeekAIService.js";
import { MCPClient } from "../services/MCPClient.js";

// 为了解决类型问题，定义文件附件接口
interface FileAttachment {
  path: string;
  name: string;
  type: string;
}

// 定义进度回调接口
interface ProgressCallback {
  onToolCall: (name: string, args: any) => void;
  onToolResult: (name: string, result: any) => void;
  onFinalResponse: (response: string) => void;
}

// 在ESM中创建__dirname的等效项
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置dotenv加载.env文件
dotenv.config();

// 从环境变量获取API密钥
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;

if (!DEEPSEEK_API_KEY) {
  console.error("请设置DEEPSEEK_API_KEY环境变量");
  process.exit(1);
}

let mainWindow: BrowserWindow | null = null;
// 修改为Map存储多个MCP客户端
let mcpClients: Map<string, MCPClient> = new Map();
// 当前活动的MCP客户端ID
let activeMcpClientId: string | null = null;
let isAgentMode: boolean = false;
// AI服务实例
let aiService: DeepSeekAIService | null = null;

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // 加载应用的 index.html
  // 在生产环境使用文件协议加载本地HTML文件
  try {
    mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, "../../public/index.html"),
        protocol: "file:",
        slashes: true,
      })
    );
  } catch (error) {
    console.error("加载index.html失败:", error);
  }

  // 打开开发者工具
  mainWindow.webContents.openDevTools();

  mainWindow.on("closed", function () {
    mainWindow = null;
  });

  // 在窗口创建后立即初始化AI服务
  initAIService();
}

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    // 在macOS上，当点击dock图标且没有其他窗口打开时，通常会在应用程序中重新创建一个窗口
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 当所有窗口都被关闭时退出，除了在macOS上
app.on("window-all-closed", async function () {
  // 清理所有MCP客户端资源
  for (const [id, client] of mcpClients.entries()) {
    try {
      console.log(`正在清理MCP客户端资源: ${id}`);
      await client.cleanup();
    } catch (error: unknown) {
      console.error(`清理MCP客户端资源时发生错误 (${id}):`, error);
    }
  }

  if (process.platform !== "darwin") app.quit();
});

// 初始化AI服务和MCP客户端
const initAIService = () => {
  try {
    console.log("正在初始化AI服务...");
    aiService = new DeepSeekAIService(DEEPSEEK_API_KEY);

    // 创建默认MCP客户端并设置为活动客户端
    const defaultClientId = "default-client";
    mcpClients.set(
      defaultClientId,
      new MCPClient(aiService, defaultClientId, "默认服务")
    );
    activeMcpClientId = defaultClientId;

    console.log("AI服务初始化成功");

    // 通知渲染进程AI服务已准备就绪
    if (mainWindow) {
      mainWindow.webContents.send("ai-service-ready");
    }

    return { success: true, message: "AI服务初始化成功" };
  } catch (error: any) {
    console.error("AI服务初始化失败:", error);
    return { success: false, message: `AI服务初始化失败: ${error.message}` };
  }
};

// 处理直接与AI对话
ipcMain.handle("chat-with-ai", async (event, message, files) => {
  try {
    if (!activeMcpClientId || !mcpClients.has(activeMcpClientId)) {
      console.log("AI服务未初始化，正在初始化...");
      const result = initAIService();
      if (!result.success) {
        return { success: false, message: result.message };
      }
    }

    console.log("发送消息到AI:", message);
    const activeMcpClient = mcpClients.get(activeMcpClientId!);
    if (!activeMcpClient) {
      return { success: false, message: "无法找到活动的MCP客户端" };
    }

    // 处理文件附件
    const fileAttachments: { path: string; name: string; type: string }[] = [];
    if (files && Array.isArray(files) && files.length > 0) {
      files.forEach((file) => {
        if (
          file &&
          typeof file.path === "string" &&
          typeof file.name === "string" &&
          typeof file.type === "string"
        ) {
          fileAttachments.push({
            path: file.path,
            name: file.name,
            type: file.type,
          });
        }
      });
      console.log("附件文件:", fileAttachments);
    }

    // 添加文件参数
    const response = await activeMcpClient.chatWithAI(message, fileAttachments);
    return response;
  } catch (error: any) {
    console.error("AI对话失败:", error);
    return { success: false, message: `AI对话失败: ${error.message}` };
  }
});

// 添加新的处理程序来获取所有服务器列表
ipcMain.handle("get-server-list", () => {
  const servers = [];
  for (const [id, client] of mcpClients.entries()) {
    servers.push({
      id: id,
      name: client.getServerName(),
      path: client.getServerPath(),
      active: id === activeMcpClientId,
      connected: client.getConnectionStatus(),
    });
  }
  return servers;
});

// 切换当前活动的服务器
ipcMain.handle("switch-active-server", async (event, serverId) => {
  if (!mcpClients.has(serverId)) {
    return { success: false, message: "找不到指定的服务器" };
  }

  activeMcpClientId = serverId;

  // 通知列表更新
  notifyServerListUpdate();

  return {
    success: true,
    message: "已切换服务器",
    serverName: mcpClients.get(serverId)!.getServerName(),
  };
});

// 处理添加新MCP服务器
ipcMain.handle("add-mcp-server", async (event, serverPath, serverName) => {
  try {
    if (!aiService) {
      console.log("AI服务未初始化，正在初始化...");
      const result = initAIService();
      if (!result.success) {
        console.error("AI服务初始化失败:", result.message);
        return { success: false, message: result.message };
      }
    }

    // 生成唯一ID
    const serverId = `mcp-${Date.now()}`;
    const newClient = new MCPClient(
      aiService!,
      serverId,
      serverName || "新服务器"
    );

    console.log(
      `创建新服务器: ${serverPath}, 名称: ${serverName || "新服务器"}`
    );

    // 连接到服务器
    const connectResult = await newClient.connectToServer(serverPath);

    // 将新客户端添加到Map
    mcpClients.set(serverId, newClient);

    // 设置为活动客户端
    activeMcpClientId = serverId;

    console.log(`已添加新服务器，ID: ${serverId}`);

    // 通知列表更新
    notifyServerListUpdate();

    return {
      success: true,
      serverId: serverId,
      serverName: serverName || "新服务器",
      tools: connectResult.tools,
    };
  } catch (error: any) {
    console.error("添加MCP服务器失败:", error);
    return { success: false, message: `添加服务器失败: ${error.message}` };
  }
});

// 更新连接到MCP服务器的处理程序以支持多服务器
ipcMain.handle("connect-server", async (event, serverPath, serverName) => {
  try {
    console.log(`尝试连接到服务器: ${serverPath}`);

    if (!aiService) {
      console.log("初始化AI服务...");
      const result = initAIService();
      if (!result.success) {
        console.error("AI服务初始化失败:", result.message);
        return { success: false, message: result.message };
      }
    }

    // 检查这是连接新服务器还是重连现有服务器
    if (serverName) {
      // 直接调用添加服务器的函数，不使用IPC事件
      try {
        if (!aiService) {
          console.log("AI服务未初始化，正在初始化...");
          const result = initAIService();
          if (!result.success) {
            console.error("AI服务初始化失败:", result.message);
            return { success: false, message: result.message };
          }
        }

        // 生成唯一ID
        const serverId = `mcp-${Date.now()}`;
        const newClient = new MCPClient(
          aiService!,
          serverId,
          serverName || "新服务器"
        );

        console.log(
          `创建新服务器: ${serverPath}, 名称: ${serverName || "新服务器"}`
        );

        // 连接到服务器
        const connectResult = await newClient.connectToServer(serverPath);

        // 将新客户端添加到Map
        mcpClients.set(serverId, newClient);

        // 设置为活动客户端
        activeMcpClientId = serverId;

        console.log(`已添加新服务器，ID: ${serverId}`);

        // 通知列表更新
        notifyServerListUpdate();

        return {
          success: true,
          serverId: serverId,
          serverName: serverName || "新服务器",
          tools: connectResult.tools,
          message: "已成功连接到MCP服务器",
        };
      } catch (error: any) {
        console.error("添加MCP服务器失败:", error);
        return { success: false, message: `添加服务器失败: ${error.message}` };
      }
    } else if (activeMcpClientId && mcpClients.has(activeMcpClientId)) {
      // 使用当前活动客户端连接
      const activeMcpClient = mcpClients.get(activeMcpClientId)!;

      console.log("开始连接到MCP服务器...");
      const connectResult = await activeMcpClient.connectToServer(serverPath);
      console.log("连接结果:", connectResult);

      return {
        success: true,
        message: "已成功连接到MCP服务器",
        serverId: activeMcpClientId,
        serverName: activeMcpClient.getServerName(),
        tools: connectResult.tools,
      };
    } else {
      return { success: false, message: "未找到可用的MCP客户端" };
    }
  } catch (error: any) {
    console.error("连接MCP服务器失败:", error);
    let errorMessage = `连接MCP服务器失败: ${error.message}`;

    // 提供更详细的错误提示
    if (error.message.includes("超时")) {
      errorMessage +=
        "\n\n可能的原因:\n1. 服务器脚本路径错误\n2. 服务器脚本存在问题\n3. 服务器脚本启动时间过长";
    } else if (error.message.includes("ENOENT")) {
      errorMessage += "\n\n文件不存在，请检查路径是否正确";
    }

    return { success: false, message: errorMessage };
  }
});

// 处理发送消息到AI的其他方法也需要更新为使用activeMcpClientId
ipcMain.handle("send-message", async (event, message) => {
  try {
    if (!activeMcpClientId || !mcpClients.has(activeMcpClientId)) {
      return { success: false, message: "MCP客户端未初始化" };
    }

    const activeMcpClient = mcpClients.get(activeMcpClientId)!;
    const response = await activeMcpClient.processQuery(message);
    return { success: true, message: response };
  } catch (error: any) {
    console.error("处理消息失败:", error);
    return { success: false, message: `处理消息失败: ${error.message}` };
  }
});

// 处理使用Agent模式发送消息到AI
ipcMain.handle("send-message-with-agent", async (event, message) => {
  try {
    if (!activeMcpClientId || !mcpClients.has(activeMcpClientId)) {
      return { success: false, message: "MCP客户端未初始化" };
    }

    console.log("使用Agent模式处理消息:", message);
    const activeMcpClient = mcpClients.get(activeMcpClientId)!;

    // 创建进度回调
    const progressCallback = {
      onToolCall: (name: string, args: any) => {
        // 发送工具调用更新通知
        if (mainWindow) {
          mainWindow.webContents.send("tool-call-update", {
            name,
            args,
            timestamp: Date.now(),
          });
        }
      },
      onToolResult: (name: string, result: any) => {
        // 发送工具结果更新通知
        if (mainWindow) {
          mainWindow.webContents.send("tool-result-update", {
            name,
            result,
            timestamp: Date.now(),
          });
        }
      },
      onFinalResponse: (response: string) => {
        // 发送最终回复通知
        if (mainWindow) {
          mainWindow.webContents.send("agent-final-response", {
            response,
            timestamp: Date.now(),
          });
        }
      },
    };

    const response = await activeMcpClient.processQueryWithAgent(
      message,
      progressCallback
    );
    return { success: true, message: response, mode: "agent" };
  } catch (error: any) {
    console.error("处理Agent消息失败:", error);
    return {
      success: false,
      message: `处理Agent消息失败: ${error.message}`,
      mode: "agent",
    };
  }
});

// 获取当前的Agent模式状态
ipcMain.handle("get-agent-mode", () => {
  return isAgentMode;
});

// 设置Agent模式状态
ipcMain.handle("set-agent-mode", (event, mode: boolean) => {
  console.log(`设置AI模式: ${mode ? "Agent模式" : "普通模式"}`);
  isAgentMode = mode;
  return isAgentMode;
});

// 智能发送消息（根据当前模式自动选择）
ipcMain.handle("smart-send-message", async (event, message, files) => {
  try {
    if (!activeMcpClientId || !mcpClients.has(activeMcpClientId)) {
      return { success: false, message: "请先连接到MCP服务器" };
    }

    const activeMcpClient = mcpClients.get(activeMcpClientId!);
    if (!activeMcpClient) {
      return { success: false, message: "无法找到活动的MCP客户端" };
    }

    // 处理文件附件
    const fileAttachments: { path: string; name: string; type: string }[] = [];
    if (files && Array.isArray(files) && files.length > 0) {
      files.forEach((file) => {
        if (
          file &&
          typeof file.path === "string" &&
          typeof file.name === "string" &&
          typeof file.type === "string"
        ) {
          fileAttachments.push({
            path: file.path,
            name: file.name,
            type: file.type,
          });
        }
      });
      console.log("附件文件:", fileAttachments);
    }

    if (isAgentMode) {
      // 创建进度回调
      const progressCallback = {
        onToolCall: (name: string, args: any) => {
          if (mainWindow) {
            mainWindow.webContents.send("tool-call-update", {
              name,
              args,
              timestamp: Date.now(),
            });
          }
        },
        onToolResult: (name: string, result: any) => {
          if (mainWindow) {
            mainWindow.webContents.send("tool-result-update", {
              name,
              result,
              timestamp: Date.now(),
            });
          }
        },
        onFinalResponse: (response: string) => {
          if (mainWindow) {
            mainWindow.webContents.send("agent-final-response", {
              response,
              timestamp: Date.now(),
            });
          }
        },
      };

      // 使用sendMessageWithAgent方法，传递文件参数
      return await activeMcpClient.sendMessageWithAgent(
        message,
        fileAttachments,
        progressCallback
      );
    } else {
      // 使用sendMessage方法，传递文件参数
      return await activeMcpClient.sendMessage(message, fileAttachments);
    }
  } catch (error: any) {
    console.error("发送消息失败:", error);
    return { success: false, message: `发送消息失败: ${error.message}` };
  }
});

// 处理选择服务器脚本
ipcMain.handle("select-server-script", async (event) => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "脚本文件", extensions: ["py", "js"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const isValidExtension =
      filePath.endsWith(".py") || filePath.endsWith(".js");

    // 获取文件名作为默认服务器名称
    const path = await import("path");
    const serverName = path.basename(filePath, path.extname(filePath));

    return {
      canceled: false,
      filePaths: [filePath],
      warning: !isValidExtension
        ? "选择的文件不是.py或.js文件，可能无法正常工作"
        : undefined,
      serverName,
    };
  } catch (error: any) {
    console.error("选择服务器脚本失败:", error);
    return {
      canceled: true,
      error: error.message,
    };
  }
});

// 删除服务器连接
ipcMain.handle("remove-server", async (event, serverId) => {
  try {
    if (!mcpClients.has(serverId)) {
      return { success: false, message: "找不到指定的服务器" };
    }

    // 获取要删除的客户端
    const clientToRemove = mcpClients.get(serverId)!;

    // 执行清理操作
    try {
      await clientToRemove.cleanup();
    } catch (error: unknown) {
      console.error(`清理服务器资源时发生错误 (${serverId}):`, error);
    }

    // 从Map中删除
    mcpClients.delete(serverId);

    // 如果删除的是当前活动客户端，则切换到另一个可用客户端
    if (serverId === activeMcpClientId) {
      // 找到第一个可用客户端
      const iterator = mcpClients.keys();
      const firstKey = iterator.next();
      activeMcpClientId =
        mcpClients.size > 0 && !firstKey.done ? firstKey.value : null;

      if (activeMcpClientId) {
        console.log(
          `已切换到服务器: ${mcpClients
            .get(activeMcpClientId)!
            .getServerName()}`
        );
      } else {
        console.log("没有可用的服务器，正在初始化默认服务器");
        initAIService();
      }
    }

    // 通知列表更新
    notifyServerListUpdate();

    return {
      success: true,
      message: "已删除服务器",
      newActiveId: activeMcpClientId,
    };
  } catch (error: any) {
    console.error("删除服务器失败:", error);
    return { success: false, message: `删除服务器失败: ${error.message}` };
  }
});

// 添加函数来广播服务器列表更新
function notifyServerListUpdate() {
  if (mainWindow) {
    const servers = [];
    for (const [id, client] of mcpClients.entries()) {
      servers.push({
        id: id,
        name: client.getServerName(),
        path: client.getServerPath(),
        active: id === activeMcpClientId,
        connected: client.getConnectionStatus(),
      });
    }
    mainWindow.webContents.send("server-list-update", servers);
  }
}

// 处理文件选择
ipcMain.handle("select-files", async (event, options) => {
  try {
    if (!mainWindow) {
      return { success: false, message: "主窗口未初始化" };
    }

    const filters = [];
    if (options && options.extensions) {
      filters.push({
        name: "文档",
        extensions: options.extensions.map((ext: string) =>
          ext.replace(".", "")
        ),
      });
    } else {
      filters.push(
        { name: "PDF文档", extensions: ["pdf"] },
        { name: "Word文档", extensions: ["doc", "docx"] },
        { name: "文本文件", extensions: ["txt"] }
      );
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: filters,
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    // 获取文件信息
    const files = result.filePaths.map((filePath) => {
      const stats = fs.statSync(filePath);
      const fileExt = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);

      return {
        path: filePath,
        name: fileName,
        size: stats.size,
        type: fileExt,
        lastModified: stats.mtime.getTime(),
      };
    });

    return { success: true, files };
  } catch (error: any) {
    console.error("选择文件失败:", error);
    return { success: false, message: `选择文件失败: ${error.message}` };
  }
});

// 获取文件的临时可访问路径
ipcMain.handle("get-temp-file-path", (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, message: "文件不存在" };
    }

    // 创建临时目录（如果不存在）
    const tempDir = path.join(app.getPath("temp"), "mcp-client-uploads");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const fileName = path.basename(filePath);
    const tempFilePath = path.join(tempDir, fileName);

    // 复制文件到临时目录
    fs.copyFileSync(filePath, tempFilePath);

    return { success: true, path: tempFilePath };
  } catch (error: any) {
    console.error("获取临时文件路径失败:", error);
    return {
      success: false,
      message: `获取临时文件路径失败: ${error.message}`,
    };
  }
});

// 保存上传的文件
ipcMain.handle("save-uploaded-file", (event, filePath, targetDir) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, message: "源文件不存在" };
    }

    // 创建目标目录（如果不存在）
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = path.basename(filePath);
    const targetPath = path.join(targetDir, fileName);

    // 复制文件到目标目录
    fs.copyFileSync(filePath, targetPath);

    return { success: true, path: targetPath };
  } catch (error: any) {
    console.error("保存上传文件失败:", error);
    return { success: false, message: `保存上传文件失败: ${error.message}` };
  }
});
