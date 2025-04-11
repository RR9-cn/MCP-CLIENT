import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import {
  DeepSeekAIService,
  Message,
  ToolDefinition,
} from "./DeepSeekAIService.js";
import * as fs from "fs";
import * as path from "path";

// 定义文件附件类型
export interface FileAttachment {
  path: string;
  name: string;
  type: string;
}

// 定义进度回调接口
export interface ProgressCallback {
  onToolCall: (name: string, args: any) => void;
  onToolResult: (name: string, result: any) => void;
  onFinalResponse: (response: string) => void;
}

export class MCPClient {
  private mcp: Client;
  private aiService: DeepSeekAIService;
  private transport: StdioClientTransport | null = null;
  private tools: ToolDefinition[] = [];
  private serverId: string;
  private serverName: string;
  private serverPath: string = "";
  private isConnected: boolean = false;

  constructor(
    aiService: DeepSeekAIService,
    serverId: string,
    serverName: string
  ) {
    // 初始化MCP客户端和AI服务
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    this.aiService = aiService;
    this.serverId = serverId;
    this.serverName = serverName;
  }

  async connectToServer(serverScriptPath: string) {
    /**
     * Connect to an MCP server
     *
     * @param serverScriptPath - Path to the server script (.py or .js)
     */
    try {
      // 保存服务器路径
      this.serverPath = serverScriptPath;

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

      // 设置连接状态
      this.isConnected = true;

      return {
        success: true,
        tools: this.tools.map((tool) => tool.function.name),
      };
    } catch (e: any) {
      console.error("Failed to connect to MCP server: ", e);
      this.isConnected = false;
      throw e;
    }
  }

  // 处理文件附件
  private async processFileAttachments(
    files: FileAttachment[]
  ): Promise<string> {
    if (!files || files.length === 0) return "";

    const fileDescriptions = files.map((file) => {
      const fileExt = path.extname(file.path).toLowerCase();
      const fileType =
        fileExt === ".pdf"
          ? "PDF文档"
          : fileExt === ".doc" || fileExt === ".docx"
          ? "Word文档"
          : "文本文件";
      const stats = fs.statSync(file.path);
      const fileSizeInKB = Math.round(stats.size / 1024);

      return `- ${file.name} (${fileType}, ${fileSizeInKB}KB)`;
    });

    return `\n\n用户上传了以下文件：\n${fileDescriptions.join(
      "\n"
    )}\n请分析这些文件内容。`;
  }

  async processQuery(
    query: string,
    files: FileAttachment[] = []
  ): Promise<string> {
    /**
     * Process a query using DeepSeek and available tools
     *
     * @param query - The user's input query
     * @param files - Optional file attachments
     * @returns Processed response as a string
     */
    // 创建DeepSeek API请求
    let userMessage = query;

    // 如果有文件附件，添加文件描述到消息中
    if (files && files.length > 0) {
      const fileContext = await this.processFileAttachments(files);
      userMessage += fileContext;
    }

    let messages: Message[] = [
      {
        role: "user",
        content: userMessage,
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

  async processQueryWithAgent(
    query: string,
    progressCallback: ProgressCallback,
    files: FileAttachment[] = []
  ): Promise<string> {
    /**
     * Process a query using DeepSeek with Agent mode
     *
     * @param query - The user's input query
     * @param progressCallback - Callback for progress updates
     * @param files - Optional file attachments
     * @returns Final response as a string
     */
    let userMessage = query;

    // 如果有文件附件，添加文件描述到消息中
    if (files && files.length > 0) {
      const fileContext = await this.processFileAttachments(files);
      userMessage += fileContext;
    }

    let messages: Message[] = [
      {
        role: "user",
        content: userMessage,
      },
    ];

    try {
      // 初始AI调用
      const assistantMessage = await this.aiService.sendMessage(
        messages,
        this.tools
      );

      let conversationDone = false;
      let finalResponse = "";

      if (assistantMessage.content) {
        finalResponse = assistantMessage.content;
        progressCallback.onFinalResponse(finalResponse);
        conversationDone = true;
      }

      // 处理工具调用
      if (!conversationDone) {
        const toolCalls = this.aiService.extractToolCalls(assistantMessage);

        if (toolCalls.length === 0) {
          // 没有工具调用但也没有内容，返回错误
          return "AI响应异常，既没有内容也没有工具调用";
        }

        // 添加助手的工具调用消息
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: toolCalls.map((tc) => tc.toolCall),
        });

        // 逐个处理工具调用
        for (const toolCall of toolCalls) {
          // 通知正在调用工具
          progressCallback.onToolCall(toolCall.name, toolCall.arguments);

          try {
            // 执行工具调用
            const result = await this.mcp.callTool({
              name: toolCall.name,
              arguments: toolCall.arguments,
            });

            // 通知工具调用结果
            progressCallback.onToolResult(toolCall.name, result);

            // 添加工具结果到消息
            messages.push(
              this.aiService.formatToolResultMessage(toolCall.id, result)
            );
          } catch (error: any) {
            // 通知工具调用错误
            progressCallback.onToolResult(toolCall.name, {
              error: error.message,
            });

            // 添加错误结果到消息
            messages.push(
              this.aiService.formatToolResultMessage(toolCall.id, {
                error: `调用工具 ${toolCall.name} 时出错: ${error.message}`,
              })
            );
          }
        }

        // 继续对话，获取AI的最终响应
        const finalMessage = await this.aiService.sendMessage(
          messages,
          this.tools
        );

        if (finalMessage.content) {
          finalResponse = finalMessage.content;
          progressCallback.onFinalResponse(finalResponse);
        } else {
          // 如果还有工具调用，递归处理
          const nextToolCalls = this.aiService.extractToolCalls(finalMessage);
          if (nextToolCalls.length > 0) {
            // 递归处理新的工具调用
            // 注意：为防止无限递归，实际应用中应当限制递归深度
            messages.push(finalMessage);
            return this.continueAgentConversation(messages, progressCallback);
          } else {
            finalResponse = "AI响应异常，没有返回最终回复";
          }
        }
      }

      return finalResponse;
    } catch (error: any) {
      console.error("Agent处理查询失败:", error);
      return "抱歉，处理您的请求时出现错误: " + error.message;
    }
  }

  private async continueAgentConversation(
    messages: Message[],
    progressCallback: ProgressCallback,
    maxDepth: number = 5,
    currentDepth: number = 0
  ): Promise<string> {
    if (currentDepth >= maxDepth) {
      return "达到最大工具调用深度，停止处理";
    }

    try {
      // 获取最后一条消息中的工具调用
      const lastMessage = messages[messages.length - 1];
      const toolCalls = this.aiService.extractToolCalls(lastMessage);

      if (toolCalls.length === 0) {
        // 没有更多工具调用，但检查是否有内容
        if (lastMessage.content) {
          progressCallback.onFinalResponse(lastMessage.content);
          return lastMessage.content;
        } else {
          return "AI响应异常，没有返回最终回复";
        }
      }

      // 逐个处理工具调用
      for (const toolCall of toolCalls) {
        // 通知正在调用工具
        progressCallback.onToolCall(toolCall.name, toolCall.arguments);

        try {
          // 执行工具调用
          const result = await this.mcp.callTool({
            name: toolCall.name,
            arguments: toolCall.arguments,
          });

          // 通知工具调用结果
          progressCallback.onToolResult(toolCall.name, result);

          // 添加工具结果到消息
          messages.push(
            this.aiService.formatToolResultMessage(toolCall.id, result)
          );
        } catch (error: any) {
          // 通知工具调用错误
          progressCallback.onToolResult(toolCall.name, {
            error: error.message,
          });

          // 添加错误结果到消息
          messages.push(
            this.aiService.formatToolResultMessage(toolCall.id, {
              error: `调用工具 ${toolCall.name} 时出错: ${error.message}`,
            })
          );
        }
      }

      // 继续对话，获取AI的最终响应
      const nextMessage = await this.aiService.sendMessage(
        messages,
        this.tools
      );
      messages.push(nextMessage);

      if (nextMessage.content) {
        progressCallback.onFinalResponse(nextMessage.content);
        return nextMessage.content;
      } else {
        // 递归处理新的工具调用
        return this.continueAgentConversation(
          messages,
          progressCallback,
          maxDepth,
          currentDepth + 1
        );
      }
    } catch (error: any) {
      console.error("继续Agent对话失败:", error);
      return "抱歉，处理工具调用时出现错误: " + error.message;
    }
  }

  // 包装方法
  async sendMessage(
    message: string,
    files: FileAttachment[] = []
  ): Promise<any> {
    try {
      const response = await this.processQuery(message, files);
      return {
        success: true,
        message: response,
        mode: "normal",
      };
    } catch (error: any) {
      console.error("处理消息失败:", error);
      return {
        success: false,
        message: `处理消息失败: ${error.message}`,
        mode: "normal",
      };
    }
  }

  // 包装Agent模式方法
  async sendMessageWithAgent(
    message: string,
    files: FileAttachment[] = [],
    progressCallback?: ProgressCallback
  ): Promise<any> {
    try {
      // 如果没有提供进度回调，创建一个空的回调
      const callback = progressCallback || {
        onToolCall: () => {},
        onToolResult: () => {},
        onFinalResponse: () => {},
      };

      const response = await this.processQueryWithAgent(
        message,
        callback,
        files
      );
      return {
        success: true,
        message: response,
        mode: "agent",
      };
    } catch (error: any) {
      console.error("Agent处理消息失败:", error);
      return {
        success: false,
        message: `Agent处理消息失败: ${error.message}`,
        mode: "agent",
      };
    }
  }

  async chatWithAI(
    message: string,
    files: FileAttachment[] = []
  ): Promise<any> {
    try {
      // 处理文件上下文
      let userMessage = message;
      if (files && files.length > 0) {
        const fileContext = await this.processFileAttachments(files);
        userMessage += fileContext;
      }

      // 使用AI服务直接对话
      const response = await this.aiService.chat(userMessage);
      return {
        success: true,
        message: response,
      };
    } catch (error: any) {
      console.error("AI对话失败:", error);
      return {
        success: false,
        message: `AI对话失败: ${error.message}`,
      };
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
    try {
      await this.mcp.close();
      this.isConnected = false;
    } catch (error) {
      console.error("清理MCP客户端资源时发生错误:", error);
    }
  }

  // 获取服务器名称
  getServerName(): string {
    return this.serverName;
  }

  // 获取服务器路径
  getServerPath(): string {
    return this.serverPath;
  }

  // 设置服务器名称
  setServerName(name: string): void {
    this.serverName = name;
  }

  // 获取连接状态
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}
