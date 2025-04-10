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
