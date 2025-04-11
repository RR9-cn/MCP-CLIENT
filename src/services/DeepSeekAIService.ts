import axios from "axios";

// DeepSeek API基础URL
export const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

export interface ToolDefinition {
  type: string;
  function: {
    name: string;
    description: string | undefined;
    parameters: any;
  };
}

export interface Message {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

/**
 * DeepSeekAIService - 专门处理与DeepSeek API的通信
 */
export class DeepSeekAIService {
  private apiKey: string;
  private apiUrl: string;
  private messageHistory: Message[] = [];
  private maxHistoryLength: number;

  constructor(
    apiKey: string,
    apiUrl: string = DEEPSEEK_API_URL,
    maxHistoryLength: number = 10
  ) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.maxHistoryLength = maxHistoryLength;
  }

  /**
   * 添加消息到历史记录
   * 当消息历史超过最大长度时自动清空，而不是只保留最近的消息
   */
  private addToHistory(message: Message) {
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistoryLength) {
      this.messageHistory = [];
    }
  }

  /**
   * 获取当前对话历史
   */
  public getMessageHistory(): Message[] {
    return [...this.messageHistory];
  }

  /**
   * 清除对话历史
   */
  public clearHistory() {
    this.messageHistory = [];
  }

  /**
   * 发送消息到DeepSeek API
   */
  async sendMessage(
    messages: Message[],
    tools: ToolDefinition[] = [],
    maxTokens: number = 1000
  ) {
    // 将新消息添加到历史记录
    messages.forEach((msg) => this.addToHistory(msg));

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: "deepseek-chat",
          messages: this.messageHistory,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? "auto" : undefined,
          max_tokens: maxTokens,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      const assistantMessage = response.data.choices[0].message;
      // 将AI的回复添加到历史记录
      this.addToHistory(assistantMessage);

      return assistantMessage;
    } catch (error: any) {
      console.error("DeepSeek API调用失败:", error);
      if (error.response) {
        console.error("请求详情:", error.config);
        console.error("响应状态:", error.response.status);
        console.error("响应数据:", error.response.data);
      }
      throw new Error("AI服务请求失败: " + (error.message || "未知错误"));
    }
  }

  /**
   * 运行Agent循环，处理工具调用直到完成任务
   * @param query 用户查询
   * @param tools 可用工具列表
   * @param toolExecutor 执行工具的函数
   * @param maxIterations 最大迭代次数
   * @returns 最终处理结果
   */
  async runAgentLoop(
    query: string,
    tools: ToolDefinition[] = [],
    toolExecutor: (name: string, args: any) => Promise<any>,
    maxIterations: number = 10
  ) {
    // 清空历史记录，开始新的对话
    this.clearHistory();

    // 初始用户消息
    const messages: Message[] = [
      {
        role: "user",
        content: query,
      },
    ];

    // 存储所有过程和结果
    let processLog: string[] = [];
    let currentIteration = 0;

    while (currentIteration < maxIterations) {
      currentIteration++;
      console.log(`Agent循环第${currentIteration}次迭代开始`);

      // 发送消息到AI并获取回复
      const assistantMessage = await this.sendMessage(messages, tools);

      // 提取工具调用
      const toolCalls = this.extractToolCalls(assistantMessage);

      // 如果没有工具调用，直接返回最终结果
      if (toolCalls.length === 0) {
        console.log("没有更多工具调用，返回最终结果");
        if (assistantMessage.content) {
          return assistantMessage.content;
        } else {
          return processLog.join("\n");
        }
      }

      console.log(`检测到${toolCalls.length}个工具调用`);

      // 处理所有工具调用
      for (const toolCall of toolCalls) {
        try {
          console.log(`执行工具: ${toolCall.name}`);
          processLog.push(
            `[使用工具: ${toolCall.name}] 参数: ${JSON.stringify(
              toolCall.arguments
            )}`
          );

          // 执行工具调用
          const result = await toolExecutor(toolCall.name, toolCall.arguments);

          // 将工具结果格式化并添加到历史
          this.formatToolResultMessage(toolCall.id, { content: result });

          processLog.push(
            `[工具结果] ${
              typeof result === "string" ? result : JSON.stringify(result)
            }`
          );
        } catch (error: any) {
          console.error(`工具 ${toolCall.name} 执行失败:`, error);
          // 添加错误信息到工具结果
          this.formatToolResultMessage(toolCall.id, {
            content: `执行失败: ${error.message || "未知错误"}`,
          });

          processLog.push(`[工具执行失败] ${error.message || "未知错误"}`);
        }
      }
    }

    // 如果达到最大迭代次数但仍未完成
    console.log(`已达到最大迭代次数(${maxIterations})，强制结束`);

    // 发送一个最终总结请求
    const finalMessage: Message = {
      role: "user",
      content: "请根据之前的工具调用结果，总结出最终答案。",
    };

    const finalResponse = await this.sendMessage([finalMessage], []);
    return finalResponse.content || processLog.join("\n");
  }

  /**
   * 处理响应内容中的工具调用
   */
  extractToolCalls(assistantMessage: any) {
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      return assistantMessage.tool_calls.map((toolCall: any) => {
        return {
          name: toolCall.function.name,
          arguments: JSON.parse(toolCall.function.arguments),
          id: toolCall.id,
          toolCall: toolCall,
        };
      });
    }
    return [];
  }

  /**
   * 格式化工具调用结果为API所需的消息格式
   */
  formatToolResultMessage(toolCallId: string, result: any) {
    // 确保工具响应的content是字符串
    let toolContent: string;
    if (typeof result.content === "string") {
      toolContent = result.content;
    } else if (Array.isArray(result.content)) {
      // 如果content是数组，将其转换为字符串
      toolContent = JSON.stringify(result.content);
    } else if (typeof result.content === "object" && result.content !== null) {
      toolContent = JSON.stringify(result.content);
    } else {
      toolContent = String(result.content || "");
    }

    const toolMessage = {
      role: "tool",
      content: toolContent,
      tool_call_id: toolCallId,
    };

    // 将工具响应添加到历史记录
    this.addToHistory(toolMessage);

    return toolMessage;
  }
}
