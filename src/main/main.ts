import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import { fileURLToPath } from "url";
import * as url from "url";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { DeepSeekAIService } from "../services/DeepSeekAIService.js";
import { MCPClient } from "../services/MCPClient.js";

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
let mcpClient: MCPClient | null = null;
let isAgentMode: boolean = false;

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
  // 清理MCP客户端资源
  if (mcpClient) {
    try {
      await mcpClient.cleanup();
    } catch (error: unknown) {
      console.error("清理MCP客户端资源时发生错误:", error);
    }
  }

  if (process.platform !== "darwin") app.quit();
});

// 初始化AI服务和MCP客户端
const initAIService = () => {
  try {
    console.log("正在初始化AI服务...");
    const aiService = new DeepSeekAIService(DEEPSEEK_API_KEY);
    mcpClient = new MCPClient(aiService);
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
ipcMain.handle("chat-with-ai", async (event, message) => {
  try {
    if (!mcpClient) {
      console.log("AI服务未初始化，正在初始化...");
      const result = initAIService();
      if (!result.success) {
        return { success: false, message: result.message };
      }
    }

    console.log("发送消息到AI:", message);
    const response = await mcpClient!.chatWithAI(message);
    return response;
  } catch (error: any) {
    console.error("AI对话失败:", error);
    return { success: false, message: `AI对话失败: ${error.message}` };
  }
});

// 处理连接到MCP服务器
ipcMain.handle("connect-server", async (event, serverPath) => {
  try {
    console.log(`尝试连接到服务器: ${serverPath}`);

    if (!mcpClient) {
      console.log("初始化AI服务...");
      const result = initAIService();
      if (!result.success) {
        console.error("AI服务初始化失败:", result.message);
        return { success: false, message: result.message };
      }
    }

    console.log("开始连接到MCP服务器...");
    const connectResult = await mcpClient!.connectToServer(serverPath);
    console.log("连接结果:", connectResult);

    return { success: true, message: "已成功连接到MCP服务器" };
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

// 处理发送消息到AI
ipcMain.handle("send-message", async (event, message) => {
  try {
    if (!mcpClient) {
      return { success: false, message: "MCP客户端未初始化" };
    }

    const response = await mcpClient.processQuery(message);
    return { success: true, message: response };
  } catch (error: any) {
    console.error("处理消息失败:", error);
    return { success: false, message: `处理消息失败: ${error.message}` };
  }
});

// 处理使用Agent模式发送消息到AI
ipcMain.handle("send-message-with-agent", async (event, message) => {
  try {
    if (!mcpClient) {
      return { success: false, message: "MCP客户端未初始化" };
    }

    console.log("使用Agent模式处理消息:", message);
    const response = await mcpClient.processQueryWithAgent(message);
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
ipcMain.handle("smart-send-message", async (event, message) => {
  try {
    if (!mcpClient) {
      return { success: false, message: "MCP客户端未初始化" };
    }

    console.log(`使用${isAgentMode ? "Agent" : "普通"}模式处理消息:`, message);

    // 根据当前模式选择处理方法
    const response = isAgentMode
      ? await mcpClient.processQueryWithAgent(message)
      : await mcpClient.processQuery(message);

    return {
      success: true,
      message: response,
      mode: isAgentMode ? "agent" : "normal",
    };
  } catch (error: any) {
    console.error(
      `处理消息失败 (${isAgentMode ? "Agent模式" : "普通模式"}):`,
      error
    );
    return {
      success: false,
      message: `处理消息失败: ${error.message}`,
      mode: isAgentMode ? "agent" : "normal",
    };
  }
});

// 处理选择服务器脚本文件
ipcMain.handle("select-server-script", async () => {
  try {
    if (!mainWindow) return { canceled: true };

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "脚本文件", extensions: ["js", "py"] }],
    });

    // 规范化所选文件路径
    if (!result.canceled && result.filePaths.length > 0) {
      console.log(`用户选择了文件: ${result.filePaths[0]}`);

      // 检查文件是否存在
      const fs = await import("fs");
      if (!fs.existsSync(result.filePaths[0])) {
        console.error(`文件不存在: ${result.filePaths[0]}`);
        return {
          canceled: false,
          filePaths: result.filePaths,
          warning: "文件可能不存在，请检查路径",
        };
      }
    }

    return result;
  } catch (error: any) {
    console.error("选择服务器脚本失败:", error);
    return { canceled: true, message: error.message };
  }
});
