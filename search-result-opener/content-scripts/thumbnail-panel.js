// 缩略图导航面板

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'showThumbnailPanel') {
    createThumbnailPanel(request.tabs);
    sendResponse({ success: true });
  }
  return true;
});

// 创建缩略图面板
function createThumbnailPanel(tabs) {
  // 如果已存在面板，先移除
  const existingPanel = document.getElementById('search-result-thumbnail-panel');
  if (existingPanel) {
    existingPanel.remove();
  }
  
  // 创建面板容器
  const panel = document.createElement('div');
  panel.id = 'search-result-thumbnail-panel';
  panel.className = 'srtp-panel';
  
  // 创建面板内容
  panel.innerHTML = `
    <div class="srtp-header">
      <span class="srtp-title">📑 页面导航 (${tabs.length})</span>
      <div class="srtp-controls">
        <button class="srtp-minimize" title="最小化">−</button>
        <button class="srtp-close" title="关闭">×</button>
      </div>
    </div>
    <div class="srtp-content">
      ${tabs.map((tab, index) => `
        <div class="srtp-item" data-tab-id="${tab.id}">
          <div class="srtp-preview">
            <img src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>'}" 
                 alt="favicon"
                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>'">
            <div class="srtp-number">${index + 2}</div>
          </div>
          <div class="srtp-info">
            <div class="srtp-item-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>
            <div class="srtp-item-url" title="${escapeHtml(getHostname(tab.url))}">${escapeHtml(getHostname(tab.url))}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  // 添加样式
  injectStyles();
  
  // 添加到页面
  document.body.appendChild(panel);
  
  // 设置事件监听
  setupEventListeners(panel);
  
  // 使面板可拖动
  makeDraggable(panel);
}

// 注入样式
function injectStyles() {
  if (document.getElementById('srtp-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'srtp-styles';
  style.textContent = `
    .srtp-panel {
      position: fixed;
      right: 20px;
      top: 100px;
      width: 280px;
      max-height: 70vh;
      background: white;
      border: 2px solid #0078d4;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      z-index: 2147483647;
      font-family: 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif;
      overflow: hidden;
      transition: all 0.3s;
    }
    
    .srtp-panel.minimized {
      height: 48px !important;
      max-height: 48px !important;
    }
    
    .srtp-panel.minimized .srtp-content {
      display: none;
    }
    
    .srtp-header {
      background: linear-gradient(135deg, #0078d4 0%, #005a9e 100%);
      color: white;
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
    }
    
    .srtp-title {
      font-weight: 600;
      font-size: 14px;
    }
    
    .srtp-controls {
      display: flex;
      gap: 8px;
    }
    
    .srtp-minimize,
    .srtp-close {
      background: rgba(255,255,255,0.2);
      border: none;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      transition: background 0.2s;
    }
    
    .srtp-minimize:hover,
    .srtp-close:hover {
      background: rgba(255,255,255,0.3);
    }
    
    .srtp-content {
      max-height: calc(70vh - 48px);
      overflow-y: auto;
      padding: 8px;
    }
    
    .srtp-content::-webkit-scrollbar {
      width: 6px;
    }
    
    .srtp-content::-webkit-scrollbar-track {
      background: #f1f1f1;
    }
    
    .srtp-content::-webkit-scrollbar-thumb {
      background: #c1c1c1;
      border-radius: 3px;
    }
    
    .srtp-item {
      display: flex;
      padding: 10px;
      margin-bottom: 8px;
      background: #f8f9fa;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .srtp-item:hover {
      border-color: #0078d4;
      background: #e3f2fd;
      transform: translateX(-4px);
      box-shadow: 4px 0 8px rgba(0,120,212,0.2);
    }
    
    .srtp-preview {
      position: relative;
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      background: white;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;
      border: 1px solid #ddd;
    }
    
    .srtp-preview img {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }
    
    .srtp-number {
      position: absolute;
      top: -6px;
      right: -6px;
      background: #0078d4;
      color: white;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: bold;
      border: 2px solid white;
    }
    
    .srtp-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    
    .srtp-item-title {
      font-size: 13px;
      font-weight: 500;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 4px;
    }
    
    .srtp-item-url {
      font-size: 11px;
      color: #666;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  
  document.head.appendChild(style);
}

// 设置事件监听
function setupEventListeners(panel) {
  // 关闭按钮
  panel.querySelector('.srtp-close').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.remove();
  });
  
  // 最小化按钮
  panel.querySelector('.srtp-minimize').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('minimized');
    const btn = e.target;
    btn.textContent = panel.classList.contains('minimized') ? '+' : '−';
  });
  
  // 标签页项点击
  panel.querySelectorAll('.srtp-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabId = parseInt(item.dataset.tabId);
      chrome.runtime.sendMessage({
        action: 'switchToTab',
        tabId: tabId
      });
    });
  });
}

// 使面板可拖动
function makeDraggable(panel) {
  const header = panel.querySelector('.srtp-header');
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.srtp-controls')) return;
    
    isDragging = true;
    initialX = e.clientX - panel.offsetLeft;
    initialY = e.clientY - panel.offsetTop;
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    
    panel.style.left = currentX + 'px';
    panel.style.top = currentY + 'px';
    panel.style.right = 'auto';
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// 辅助函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url;
  }
}

console.log('Thumbnail panel script loaded');
