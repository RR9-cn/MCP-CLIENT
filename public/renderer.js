// DOM元素
const selectServerBtn = document.getElementById('selectServer');
const serverStatus = document.getElementById('serverStatus');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const agentModeSwitch = document.getElementById('agentModeSwitch');
const modeIndicator = document.getElementById('modeIndicator');

// 全局变量
let isConnected = false;
let isAIReady = false;
let isAgentMode = false;
// 当前处理中的消息ID，用于关联工具调用
let currentMessageId = null;

// 为UI元素添加事件监听器
selectServerBtn.addEventListener('click', selectServerScript);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
if (agentModeSwitch) {
  agentModeSwitch.addEventListener('change', toggleAgentMode);
}

// 监听AI服务就绪
window.mcpAPI.onAIServiceReady(() => {
  isAIReady = true;
  addMessage('AI服务已准备就绪，您可以开始对话', 'system');
  updateStatus('AI已就绪，MCP未连接', false, true);
  
  initAgentModeState();
});

// 监听工具调用更新
window.mcpAPI.onToolCallUpdate((data) => {
  console.log('收到工具调用:', data);
  // 显示工具调用信息
  addToolCall(`[使用工具: ${data.name}] 参数: ${JSON.stringify(data.args)}`, 'tool-call-running');
});

// 监听工具调用结果
window.mcpAPI.onToolResultUpdate((data) => {
  console.log('收到工具结果:', data);
  // 判断结果类型
  if (data.result && data.result.error) {
    // 显示错误信息
    addToolCall(`[工具调用失败: ${data.name}] ${data.result.error}`, 'tool-call-error');
  } else {
    // 显示成功结果
    const resultStr = typeof data.result === 'string' 
      ? data.result 
      : JSON.stringify(data.result);
    addToolCall(`[工具结果: ${data.name}] ${resultStr}`, 'tool-call-success');
  }
});

// 监听Agent最终回复
window.mcpAPI.onAgentFinalResponse((data) => {
  console.log('收到最终回复:', data);
  // 添加AI最终回复
  addMessage(data.response, 'ai');
});

async function initAgentModeState() {
  try {
    isAgentMode = await window.mcpAPI.getAgentMode();
    updateModeIndicator(isAgentMode);
    
    if (agentModeSwitch) {
      agentModeSwitch.checked = isAgentMode;
    }
  } catch (error) {
    console.error('获取Agent模式状态失败:', error);
  }
}

async function toggleAgentMode() {
  try {
    const newMode = agentModeSwitch ? agentModeSwitch.checked : !isAgentMode;
    isAgentMode = await window.mcpAPI.setAgentMode(newMode);
    updateModeIndicator(isAgentMode);
    
    addMessage(`已切换至${isAgentMode ? 'Agent模式' : '普通模式'}`, 'system');
  } catch (error) {
    addMessage(`切换模式失败: ${error.message}`, 'error');
    if (agentModeSwitch) {
      agentModeSwitch.checked = isAgentMode;
    }
  }
}

function updateModeIndicator(isAgent) {
  if (modeIndicator) {
    modeIndicator.textContent = isAgent ? 'Agent模式' : '普通模式';
    modeIndicator.className = isAgent ? 'agent-mode' : 'normal-mode';
  }
}

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
  
  // 生成一个消息 ID 用于跟踪当前会话
  currentMessageId = Date.now();
  
  // 清空输入框并禁用按钮
  messageInput.value = '';
  disableInput(true);
  
  // 创建消息会话容器
  const sessionContainer = document.createElement('div');
  sessionContainer.className = 'message-session';
  sessionContainer.dataset.messageId = currentMessageId;
  messagesContainer.appendChild(sessionContainer);
  
  // 在UI中添加用户消息
  addMessageToSession(sessionContainer, message, 'user');
  
  try {
    let response;
    
    // 根据连接状态选择使用MCP还是直接AI对话
    if (isConnected) {
      // 在Agent模式下，创建进度显示区域
      if (isAgentMode) {
        const progressContainer = document.createElement('div');
        progressContainer.className = 'tool-calls-container';
        sessionContainer.appendChild(progressContainer);
        
        // 添加等待提示
        const waitingDiv = document.createElement('div');
        waitingDiv.className = 'tool-processing';
        waitingDiv.textContent = `${isAgentMode ? '[Agent模式]' : '[普通模式]'} 处理中...`;
        progressContainer.appendChild(waitingDiv);
      }
      
      response = await window.mcpAPI.smartSendMessage(message);
      
      // 处理响应
      if (response.success) {
        // 在非Agent模式下，直接显示AI回复
        if (response.mode !== 'agent') {
          addMessageToSession(sessionContainer, response.message, 'ai');
        }
        // Agent模式下，实时回调会处理显示
      } else {
        addMessageToSession(sessionContainer, `处理失败：${response.message}`, 'error');
      }
    } else if (isAIReady) {
      // 直接与AI对话
      response = await window.mcpAPI.chatWithAI(message);
      
      if (response.success) {
        addMessageToSession(sessionContainer, response.message, 'ai');
      } else {
        addMessageToSession(sessionContainer, `AI回复失败：${response.message}`, 'error');
      }
    } else {
      addMessageToSession(sessionContainer, '请先等待AI服务就绪或连接到MCP服务器', 'error');
    }
  } catch (error) {
    // 获取当前会话容器
    const currentSession = document.querySelector(`.message-session[data-message-id="${currentMessageId}"]`);
    addMessageToSession(currentSession, `错误：${error.message}`, 'error');
  } finally {
    // 重新启用输入
    disableInput(false);
    // 滚动到底部
    scrollToBottom();
    // 清除当前消息ID
    currentMessageId = null;
  }
}

// 添加消息到会话容器
function addMessageToSession(sessionContainer, text, type) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}-message`;
  messageDiv.textContent = text;
  sessionContainer.appendChild(messageDiv);
  scrollToBottom();
}

// 添加消息到聊天容器
function addMessage(text, type) {
  // 如果有当前会话容器，添加到会话中
  const currentSession = document.querySelector(`.message-session[data-message-id="${currentMessageId}"]`);
  if (currentSession) {
    addMessageToSession(currentSession, text, type);
    return;
  }
  
  // 否则创建一个新的非会话消息
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}-message`;
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  scrollToBottom();
}

// 添加工具调用信息
function addToolCall(text, className = 'tool-call') {
  // 查找当前会话的工具调用容器
  const currentSession = document.querySelector(`.message-session[data-message-id="${currentMessageId}"]`);
  if (!currentSession) {
    // 如果没有当前会话，创建一个普通工具调用消息
    const toolCallDiv = document.createElement('div');
    toolCallDiv.className = className;
    toolCallDiv.textContent = text;
    messagesContainer.appendChild(toolCallDiv);
  } else {
    // 查找或创建工具调用容器
    let toolCallsContainer = currentSession.querySelector('.tool-calls-container');
    if (!toolCallsContainer) {
      toolCallsContainer = document.createElement('div');
      toolCallsContainer.className = 'tool-calls-container';
      currentSession.appendChild(toolCallsContainer);
    }
    
    // 添加工具调用信息
    const toolCallDiv = document.createElement('div');
    toolCallDiv.className = className;
    toolCallDiv.textContent = text;
    toolCallsContainer.appendChild(toolCallDiv);
  }
  
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