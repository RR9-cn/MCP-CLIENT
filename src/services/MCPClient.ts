import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  DeepSeekAIService,
  Message,
  ToolDefinition,
} from "./DeepSeekAIService.js";
import path from "path";
import fs from "fs";

// 定义文件附件接口
interface FileAttachment {
  path: string;
  name: string;
  type: string;
}

export class MCPClient {
  private mcp: Client;
  private aiService: DeepSeekAIService;
  private transport: StdioClientTransport | null = null;
  private tools: ToolDefinition[] = [];
  private isConnected: boolean = false;

  // 添加服务器ID和名称属性
  private id: string;
  private serverName: string;
  private serverPath: string = "";

  constructor(
    aiService: DeepSeekAIService,
    id: string = "",
    serverName: string = ""
  ) {
    // 初始化MCP客户端和AI服务
    this.mcp = new Client({ name: "mcp-client-electron", version: "1.0.0" });
    this.aiService = aiService;
    this.id = id || `mcp-${Date.now()}`;
    this.serverName = serverName || "未命名服务器";
  }

  /**
   * 获取客户端ID
   */
  public getId(): string {
    return this.id;
  }

  /**
   * 获取服务器名称
   */
  public getServerName(): string {
    return this.serverName;
  }

  /**
   * 设置服务器名称
   */
  public setServerName(name: string): void {
    this.serverName = name;
  }

  /**
   * 获取服务器路径
   */
  public getServerPath(): string {
    return this.serverPath;
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
   * @param files - 可选的文件附件
   * @returns 处理后的AI回复
   */
  async chatWithAI(query: string, files: FileAttachment[] = []) {
    try {
      // 处理文件内容
      let userMessage = query;
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

      // 保存服务器路径
      this.serverPath = serverScriptPath;

      console.log(`connect server ！！！！: ${normalizedPath}`);

      // 检查文件是否存在
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
   * @param progressCallback 可选的工具调用进度回调，用于实时显示过程
   * @param files 可选的文件附件
   * @returns 处理后的结果
   */
  async processQueryWithAgent(
    query: string,
    progressCallback?: {
      onToolCall?: (name: string, args: any) => void;
      onToolResult?: (name: string, result: any) => void;
      onFinalResponse?: (response: string) => void;
    },
    files: FileAttachment[] = []
  ) {
    if (!this.isConnected) {
      return "请先连接到MCP服务器";
    }

    try {
      console.log("使用Agent模式处理查询:", query);

      // 处理文件内容
      let userMessage = query;
      if (files && files.length > 0) {
        const fileContext = await this.processFileAttachments(files);
        userMessage += fileContext;
        console.log("添加文件上下文:", fileContext);
      }

      // 存储工具调用过程的日志
      const toolCallLogs: string[] = [];

      // 使用AI服务的Agent循环处理查询
      const result = await this.aiService.runAgentLoop(
        userMessage,
        this.tools,
        async (name, args) => {
          console.log(`Agent调用工具: ${name}，参数:`, args);

          // 记录工具调用信息
          const toolCallLog = `[使用工具: ${name}] 参数: ${JSON.stringify(
            args
          )}`;
          toolCallLogs.push(toolCallLog);

          // 通知进度回调
          if (progressCallback?.onToolCall) {
            progressCallback.onToolCall(name, args);
          }

          // 执行MCP工具调用
          try {
            const toolResult = await this.mcp.callTool({
              name,
              arguments: args,
            });

            console.log(`工具执行结果:`, toolResult);

            // 记录工具调用结果
            const resultLog = `[工具结果] ${
              typeof toolResult === "string"
                ? toolResult
                : JSON.stringify(toolResult)
            }`;
            toolCallLogs.push(resultLog);

            // 通知结果回调
            if (progressCallback?.onToolResult) {
              progressCallback.onToolResult(name, toolResult);
            }

            return toolResult;
          } catch (error: any) {
            console.error(`工具${name}执行失败:`, error);

            // 记录工具调用失败
            const errorLog = `[工具执行失败] ${error.message || "未知错误"}`;
            toolCallLogs.push(errorLog);

            // 通知结果回调（失败情况）
            if (progressCallback?.onToolResult) {
              progressCallback.onToolResult(name, {
                error: error.message || "未知错误",
              });
            }

            throw error;
          }
        },
        5 // 最多5轮迭代
      );

      // 通知最终结果回调
      if (progressCallback?.onFinalResponse) {
        progressCallback.onFinalResponse(result);
      }

      // 将工具调用日志和最终结果组合返回
      return toolCallLogs.join("\n") + "\n\n" + result;
    } catch (error: any) {
      console.error("Agent处理查询失败:", error);
      const errorMessage = `处理查询时出错: ${error.message || "未知错误"}`;

      // 通知最终结果回调（出错情况）
      if (progressCallback?.onFinalResponse) {
        progressCallback.onFinalResponse(errorMessage);
      }

      return errorMessage;
    }
  }

  async processQuery(query: string, files: FileAttachment[] = []) {
    /**
     * Process a query using DeepSeek and available tools
     *
     * @param query - The user's input query
     * @param files - Optional file attachments
     * @returns Processed response as a string
     */
    try {
      // 处理文件内容
      let userMessage = query;
      if (files && files.length > 0) {
        const fileContext = await this.processFileAttachments(files);
        userMessage += fileContext;
      }

      // 创建DeepSeek API请求
      let messages: Message[] = [
        {
          role: "user",
          content: userMessage,
        },
      ];

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
          : fileExt === ".txt"
          ? "文本文件"
          : "未知类型文件";
      const stats = fs.statSync(file.path);
      const fileSizeInKB = Math.round(stats.size / 1024);

      return `- ${file.name} (${fileType}, ${fileSizeInKB}KB)`;
    });

    // 对于TXT文件，尝试读取内容
    let textContent = "";
    for (const file of files) {
      const fileExt = path.extname(file.path).toLowerCase();
      if (fileExt === ".txt") {
        try {
          // 读取前10000个字符作为预览
          const content = fs.readFileSync(file.path, "utf-8").slice(0, 10000);
          if (content.trim()) {
            textContent += `\n\n文件 ${file.name} 的内容预览:\n${content}${
              content.length >= 10000 ? "...(内容已截断)" : ""
            }`;
          }
        } catch (error) {
          console.error(`读取文本文件失败: ${file.path}`, error);
        }
      }
    }

    return `\n\n用户上传了以下文件：\n${fileDescriptions.join(
      "\n"
    )}${textContent}\n请分析这些文件内容。`;
  }

  /**
   * 包装方法，用于普通模式发送消息
   * @param message 用户消息
   * @param files 可选的文件附件
   * @returns 处理结果
   */
  async sendMessage(message: string, files: FileAttachment[] = []) {
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

  /**
   * 包装方法，用于Agent模式发送消息
   * @param message 用户消息
   * @param files 可选的文件附件
   * @param progressCallback 可选的进度回调
   * @returns 处理结果
   */
  async sendMessageWithAgent(
    message: string,
    files: FileAttachment[] = [],
    progressCallback?: {
      onToolCall?: (name: string, args: any) => void;
      onToolResult?: (name: string, result: any) => void;
      onFinalResponse?: (response: string) => void;
    }
  ) {
    try {
      const response = await this.processQueryWithAgent(
        message,
        progressCallback,
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
}
