import { DeepSeekAIService } from "./DeepSeekAIService.js";
import { MCPClient } from "./MCPClient.js";
import dotenv from "dotenv";

// 配置dotenv以加载.env文件
dotenv.config();

// 从环境变量获取API密钥
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY as string;

if (!DEEPSEEK_API_KEY) {
  console.error("请设置DEEPSEEK_API_KEY环境变量1");
  process.exit(1);
}

async function main() {
  try {
    // 创建DeepSeekAIService实例
    const aiService = new DeepSeekAIService(DEEPSEEK_API_KEY);

    // 创建MCPClient实例
    const client = new MCPClient(aiService);

    // 连接到服务器
    await client.connectToServer(process.argv[2]);

    // 启动交互式聊天循环
    await client.chatLoop();

    // 清理资源
    await client.cleanup();
  } catch (error) {
    console.error("程序运行出错:", error);
    process.exit(1);
  }
}

main();
