// DOM元素
const selectServerBtn = document.getElementById('selectServer');
const serverStatus = document.getElementById('serverStatus');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const agentModeSwitch = document.getElementById('agentModeSwitch');
const modeIndicator = document.getElementById('modeIndicator');
const serversContainer = document.getElementById('serversContainer') || document.createElement('div');

// 如果页面上还没有serversContainer元素，创建并添加它
if (!document.getElementById('serversContainer')) {
  serversContainer.id = 'serversContainer';
  serversContainer.className = 'servers-container';
  document.querySelector('.server-section').appendChild(serversContainer);
}

// 全局变量
let isConnected = false;
let isAIReady = false;
let isAgentMode = false;
// 当前处理中的消息ID，用于关联工具调用
let currentMessageId = null;
// 当前活动的服务器ID
let activeServerId = null;

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

// 监听服务器列表更新
window.mcpAPI.onServerListUpdate((servers) => {
  updateServersList(servers);
});

// 更新服务器列表UI
function updateServersList(servers) {
  serversContainer.innerHTML = '';
  
  // 检查servers是否是有效数组
  if (!servers || !Array.isArray(servers) || servers.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-servers';
    emptyMsg.textContent = '没有连接的服务器';
    serversContainer.appendChild(emptyMsg);
    return;
  }
  
  servers.forEach(server => {
    if (!server) return; // 跳过无效服务器对象
    
    const serverDiv = document.createElement('div');
    serverDiv.className = `server-item ${server.active ? 'active' : ''} ${server.connected ? 'connected' : ''}`;
    serverDiv.dataset.id = server.id || 'unknown';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'server-name';
    nameSpan.textContent = server.name || '未命名服务器';
    
    const statusDot = document.createElement('span');
    statusDot.className = `status-dot ${server.connected ? 'connected' : 'disconnected'}`;
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'server-actions';
    
    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch-server-btn';
    switchBtn.textContent = '切换';
    switchBtn.addEventListener('click', () => switchServer(server.id));
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-server-btn';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => removeServer(server.id));
    
    serverDiv.appendChild(statusDot);
    serverDiv.appendChild(nameSpan);
    actionsDiv.appendChild(switchBtn);
    actionsDiv.appendChild(removeBtn);
    serverDiv.appendChild(actionsDiv);
    
    serversContainer.appendChild(serverDiv);
  });
  
  // 更新当前活动服务器ID
  const activeServer = servers.find(server => server && server.active);
  if (activeServer) {
    activeServerId = activeServer.id;
    // 更新连接状态
    updateStatus(activeServer.connected ? '已连接' : '未连接', activeServer.connected, isAIReady);
  }
}

// 切换活动服务器
async function switchServer(serverId) {
  try {
    const result = await window.mcpAPI.switchActiveServer(serverId);
    if (result.success) {
      addMessage(`已切换到服务器: ${result.serverName || '未命名服务器'}`, 'system');
      // 获取最新的服务器列表
      const servers = await window.mcpAPI.getServerList();
      updateServersList(servers);
    } else {
      addMessage(`切换服务器失败: ${result.message || '未知错误'}`, 'error');
    }
  } catch (error) {
    addMessage(`切换服务器出错: ${error && error.message ? error.message : '未知错误'}`, 'error');
  }
}

// 移除服务器
async function removeServer(serverId) {
  try {
    const result = await window.mcpAPI.removeServer(serverId);
    if (result.success) {
      addMessage('已移除服务器', 'system');
      // 获取最新的服务器列表
      const servers = await window.mcpAPI.getServerList();
      updateServersList(servers);
    } else {
      addMessage(`移除服务器失败: ${result.message || '未知错误'}`, 'error');
    }
  } catch (error) {
    addMessage(`移除服务器出错: ${error && error.message ? error.message : '未知错误'}`, 'error');
  }
}

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
    addMessage(`切换模式失败: ${error && error.message ? error.message : '未知错误'}`, 'error');
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
    updateStatus('选择文件中...', false, isAIReady);
    
    const result = await window.mcpAPI.selectServerScript();
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      updateStatus('未选择文件', false, isAIReady);
      return;
    }

    const serverPath = result.filePaths[0];
    const serverName = result.serverName || '未命名服务器';
    
    // 显示正在处理警告
    if (result.warning) {
      addMessage(`警告: ${result.warning}`, 'warning');
    }
    
    // 显示连接中状态
    updateStatus(`正在连接: ${serverPath}`, false, isAIReady);
    addMessage(`正在连接到服务器: ${serverPath} (${serverName})`, 'system');
    
    // 传递服务器名称参数
    const connectResult = await window.mcpAPI.connectServer(serverPath, serverName);
    if (connectResult.success) {
      updateStatus('已连接', true, true);
      addMessage(`已成功连接到服务器: ${serverName}`, 'system');
      
      // 更新活动服务器ID
      activeServerId = connectResult.serverId;
      
      // 如果有可用工具，显示它们
      if (connectResult && connectResult.tools && Array.isArray(connectResult.tools)) {
        addMessage(`可用工具: ${connectResult.tools.join(', ')}`, 'system');
      }
      
      // 获取最新的服务器列表
      const servers = await window.mcpAPI.getServerList();
      updateServersList(servers);
    } else {
      updateStatus('连接失败', false, isAIReady);
      
      // 处理多行错误消息
      if (connectResult && connectResult.message) {
        const errorLines = connectResult.message.split('\n');
        addMessage(`连接失败：${errorLines[0]}`, 'error');
        
        // 添加额外的错误信息
        if (errorLines.length > 1) {
          const additionalInfo = errorLines.slice(1).join('\n');
          addMessage(additionalInfo, 'error-details');
        }
      } else {
        // 处理没有错误消息的情况
        addMessage('连接失败：未知错误', 'error');
      }
    }
  } catch (error) {
    updateStatus('连接失败', false, isAIReady);
    addMessage(`错误：${error && error.message ? error.message : '未知错误'}`, 'error');
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
          addMessageToSession(sessionContainer, response.message || '收到空回复', 'ai');
        }
        // Agent模式下，实时回调会处理显示
      } else {
        addMessageToSession(sessionContainer, `处理失败：${response.message || '未知错误'}`, 'error');
      }
    } else if (isAIReady) {
      // 直接与AI对话
      response = await window.mcpAPI.chatWithAI(message);
      
      if (response.success) {
        addMessageToSession(sessionContainer, response.message || '收到空回复', 'ai');
      } else {
        addMessageToSession(sessionContainer, `AI回复失败：${response.message || '未知错误'}`, 'error');
      }
    } else {
      addMessageToSession(sessionContainer, '请先等待AI服务就绪或连接到MCP服务器', 'error');
    }
  } catch (error) {
    // 获取当前会话容器
    const currentSession = document.querySelector(`.message-session[data-message-id="${currentMessageId}"]`);
    addMessageToSession(currentSession, `错误：${error && error.message ? error.message : '未知错误'}`, 'error');
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