interface McpAPI {
  connectServer(serverPath: string): Promise<{
    success: boolean;
    message: string;
  }>;

  sendMessage(message: string): Promise<{
    success: boolean;
    message: string;
  }>;

  selectServerScript(): Promise<{
    canceled: boolean;
    filePaths?: string[];
    message?: string;
  }>;
}

declare global {
  interface Window {
    mcpAPI: McpAPI;
  }
}
