import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import {
  DeepSeekAIService,
  Message,
  ToolDefinition,
} from "./DeepSeekAIService.js";

export class MCPClient {
  private mcp: Client;
  private aiService: DeepSeekAIService;
  private transport: StdioClientTransport | null = null;
  private tools: ToolDefinition[] = [];

  constructor(aiService: DeepSeekAIService) {
    // 初始化MCP客户端和AI服务
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    this.aiService = aiService;
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // Determine script type and appropriate command
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      const command = isPy
        ? process.platform === "win32"
          ? "python"
          : "python3"
        : process.execPath;
      console.log(`command: ${command} serverScriptPath: ${serverScriptPath}`);
      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });
      this.mcp.connect(this.transport);

      // List available tools
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        };
      });
      console.log(
        "Connected to server with tools:",
        this.tools.map((tool) => tool.function.name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async processQuery(query: string) {
    /**
     * Process a query using DeepSeek and available tools
     *
     * @param query - The user's input query
     * @returns Processed response as a string
     */
    // 创建DeepSeek API请求
    let messages: Message[] = [
      {
        role: "user",
        content: query,
      },
    ];

    try {
      // 初始AI调用
      const finalText = [];
      const assistantMessage = await this.aiService.sendMessage(
        messages,
        this.tools
      );

      if (assistantMessage.content) {
        finalText.push(assistantMessage.content);
      }

      // 处理工具调用
      const toolCalls = this.aiService.extractToolCalls(assistantMessage);
      for (const toolCall of toolCalls) {
        // 执行工具调用
        const result = await this.mcp.callTool({
          name: toolCall.name,
          arguments: toolCall.arguments,
        });

        finalText.push(
          `[调用工具 ${toolCall.name}，参数 ${JSON.stringify(
            toolCall.arguments
          )}]`
        );

        // 继续与工具结果的对话
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [toolCall.toolCall],
        });

        messages.push(
          this.aiService.formatToolResultMessage(toolCall.id, result)
        );

        // 获取来自AI的下一个响应
        const followUpMessage = await this.aiService.sendMessage(messages);
        if (followUpMessage.content) {
          finalText.push(followUpMessage.content);
        }
      }

      return finalText.join("\n");
    } catch (error: any) {
      console.error("处理查询失败:", error);
      return "抱歉，处理您的请求时出现错误: " + error.message;
    }
  }

  async chatLoop() {
    /**
     * Run an interactive chat loop
     */
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client 已启动!");
      console.log("输入您的问题或输入 'quit' 退出。");

      while (true) {
        const message = await rl.question("\n问题: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    await this.mcp.close();
  }
}
