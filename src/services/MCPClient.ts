import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
  private isConnected: boolean = false;

  constructor(aiService: DeepSeekAIService) {
    // 初始化MCP客户端和AI服务
    this.mcp = new Client({ name: "mcp-client-electron", version: "1.0.0" });
    this.aiService = aiService;
  }

  /**
   * 获取连接状态
   */
  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * 获取可用工具列表
   */
  public getAvailableTools(): ToolDefinition[] {
    return [...this.tools];
  }

  /**
   * 直接与AI进行对话，不经过MCP工具
   * @param query - 用户的问题
   * @returns 处理后的AI回复
   */
  async chatWithAI(query: string) {
    let messages: Message[] = [
      {
        role: "user",
        content: query,
      },
    ];

    try {
      // 发送消息到AI服务
      const assistantMessage = await this.aiService.sendMessage(messages);

      if (assistantMessage.content) {
        return {
          success: true,
          message: assistantMessage.content,
        };
      } else {
        return {
          success: false,
          message: "AI没有返回内容",
        };
      }
    } catch (error: any) {
      console.error("AI对话失败:", error);
      return {
        success: false,
        message: "AI对话失败: " + error.message,
      };
    }
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // 规范化路径，处理Windows路径中的反斜杠
      const normalizedPath = serverScriptPath.replace(/\\/g, "/");

      console.log(`connect server ！！！！: ${normalizedPath}`);

      // 检查文件是否存在
      const fs = await import("fs");
      if (!fs.existsSync(serverScriptPath)) {
        throw new Error(`服务器脚本文件不存在: ${serverScriptPath}`);
      }

      // Determine script type and appropriate command
      const isJs = serverScriptPath.endsWith(".js");
      const isPy = serverScriptPath.endsWith(".py");
      if (!isJs && !isPy) {
        throw new Error("Server script must be a .js or .py file");
      }
      // 根据脚本类型确定命令
      const command = isJs ? "node" : "python";

      console.log(`使用命令: ${command} 运行: ${serverScriptPath}`);

      // 初始化传输并连接到服务器
      this.transport = new StdioClientTransport({
        command,
        args: [serverScriptPath],
      });

      // 添加超时处理
      const connectPromise = this.mcp.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("连接服务器超时，请检查服务器脚本是否正确")),
          10000
        );
      });

      await Promise.race([connectPromise, timeoutPromise]);

      // List available tools
      console.log("连接成功，正在获取可用工具...");
      const toolsPromise = this.mcp.listTools();
      const toolsTimeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("获取工具列表超时")), 5000);
      });

      const toolsResult = await Promise.race([
        toolsPromise,
        toolsTimeoutPromise,
      ]);
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

      this.isConnected = true;
      return {
        success: true,
        tools: this.tools.map((tool) => tool.function.name),
      };
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      this.isConnected = false;
      throw e;
    }
  }

  /**
   * 使用Agent模式处理查询
   * @param query 用户查询
   * @returns 处理后的结果
   */
  async processQueryWithAgent(query: string) {
    if (!this.isConnected) {
      return "请先连接到MCP服务器";
    }

    try {
      console.log("使用Agent模式处理查询:", query);

      // 存储工具调用过程的日志
      const toolCallLogs: string[] = [];

      // 使用AI服务的Agent循环处理查询
      const result = await this.aiService.runAgentLoop(
        query,
        this.tools,
        async (name, args) => {
          console.log(`Agent调用工具: ${name}，参数:`, args);

          // 记录工具调用信息
          toolCallLogs.push(
            `[使用工具: ${name}] 参数: ${JSON.stringify(args)}`
          );

          // 执行MCP工具调用
          try {
            const toolResult = await this.mcp.callTool({
              name,
              arguments: args,
            });

            console.log(`工具执行结果:`, toolResult);

            // 记录工具调用结果
            toolCallLogs.push(
              `[工具结果] ${
                typeof toolResult === "string"
                  ? toolResult
                  : JSON.stringify(toolResult)
              }`
            );

            return toolResult;
          } catch (error: any) {
            console.error(`工具${name}执行失败:`, error);

            // 记录工具调用失败
            toolCallLogs.push(`[工具执行失败] ${error.message || "未知错误"}`);

            throw error;
          }
        },
        5 // 最多5轮迭代
      );

      // 将工具调用日志和最终结果组合返回
      return toolCallLogs.join("\n") + "\n\n" + result;
    } catch (error: any) {
      console.error("Agent处理查询失败:", error);
      return `处理查询时出错: ${error.message || "未知错误"}`;
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

  async cleanup() {
    /**
     * Clean up resources
     */
    if (this.isConnected) {
      await this.mcp.close();
      this.isConnected = false;
    }
  }
}
