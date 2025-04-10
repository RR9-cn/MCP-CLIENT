// DOM元素
const selectServerBtn = document.getElementById('selectServer');
const serverStatus = document.getElementById('serverStatus');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// 全局变量
let isConnected = false;
let isAIReady = false;

// 为UI元素添加事件监听器
selectServerBtn.addEventListener('click', selectServerScript);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 监听AI服务就绪
window.mcpAPI.onAIServiceReady(() => {
  isAIReady = true;
  addMessage('AI服务已准备就绪，您可以开始对话', 'system');
  updateStatus('AI已就绪，MCP未连接', false, true);
});

// 选择服务器脚本并连接
async function selectServerScript() {
  try {
    // 显示正在选择文件状态
    updateStatus('选择文件中...', false, false);
    
    const result = await window.mcpAPI.selectServerScript();
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      updateStatus('未选择文件', false, false);
      return;
    }

    const serverPath = result.filePaths[0];
    
    // 显示正在处理警告
    if (result.warning) {
      addMessage(`警告: ${result.warning}`, 'warning');
    }
    
    // 显示连接中状态
    updateStatus(`正在连接: ${serverPath}`, false, false);
    addMessage(`正在连接到服务器: ${serverPath}`, 'system');
    
    const connectResult = await window.mcpAPI.connectServer(serverPath);
    if (connectResult.success) {
      updateStatus('已连接', true, true);
      addMessage(`已成功连接到服务器：${serverPath}`, 'system');
      
      // 如果有可用工具，显示它们
      if (connectResult.tools) {
        addMessage(`可用工具: ${connectResult.tools.join(', ')}`, 'system');
      }
    } else {
      updateStatus('连接失败', false, false);
      
      // 处理多行错误消息
      const errorLines = connectResult.message.split('\n');
      addMessage(`连接失败：${errorLines[0]}`, 'error');
      
      // 添加额外的错误信息
      if (errorLines.length > 1) {
        const additionalInfo = errorLines.slice(1).join('\n');
        addMessage(additionalInfo, 'error-details');
      }
    }
  } catch (error) {
    updateStatus('连接失败', false, false);
    addMessage(`错误：${error.message}`, 'error');
  }
}

// 发送消息到主进程并处理响应
async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !(isConnected || isAIReady)) return;
  
  // 清空输入框并禁用按钮
  messageInput.value = '';
  disableInput(true);
  
  // 在UI中添加用户消息
  addMessage(message, 'user');
  
  try {
    let response;
    
    // 根据连接状态选择使用MCP还是直接AI对话
    if (isConnected) {
      // 通过MCP发送消息
      response = await window.mcpAPI.sendMessage(message);
      
      // 处理响应
      if (response.success) {
        // 解析响应，分离工具调用和AI回复
        const parts = response.message.split('\n');
        let currentText = '';
        
        for (const part of parts) {
          if (part.startsWith('[调用工具')) {
            // 如果有累积的文本，先添加为AI消息
            if (currentText) {
              addMessage(currentText, 'ai');
              currentText = '';
            }
            // 添加工具调用信息
            addToolCall(part);
          } else {
            // 累积普通文本
            currentText += (currentText ? '\n' : '') + part;
          }
        }
        
        // 添加剩余的文本作为AI回复
        if (currentText) {
          addMessage(currentText, 'ai');
        }
      } else {
        addMessage(`处理失败：${response.message}`, 'error');
      }
    } else if (isAIReady) {
      // 直接与AI对话
      response = await window.mcpAPI.chatWithAI(message);
      
      if (response.success) {
        addMessage(response.message, 'ai');
      } else {
        addMessage(`AI回复失败：${response.message}`, 'error');
      }
    } else {
      addMessage('请先等待AI服务就绪或连接到MCP服务器', 'error');
    }
  } catch (error) {
    addMessage(`错误：${error.message}`, 'error');
  } finally {
    // 重新启用输入
    disableInput(false);
    // 滚动到底部
    scrollToBottom();
  }
}

// 添加消息到聊天容器
function addMessage(text, type) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}-message`;
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

// 添加工具调用信息
function addToolCall(text) {
  const toolCallDiv = document.createElement('div');
  toolCallDiv.className = 'tool-call';
  toolCallDiv.textContent = text;
  messagesContainer.appendChild(toolCallDiv);
  scrollToBottom();
}

// 更新服务器连接状态
function updateStatus(text, isConnectedState, enableInput) {
  serverStatus.textContent = text;
  isConnected = isConnectedState;
  
  if (isConnectedState) {
    serverStatus.classList.add('connected');
  } else {
    serverStatus.classList.remove('connected');
  }
  
  disableInput(!enableInput);
}

// 启用/禁用输入区域
function disableInput(disabled) {
  messageInput.disabled = disabled;
  sendBtn.disabled = disabled;
}

// 滚动聊天到底部
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
} 