let currentGroupId = null;
let tabs = [];
let currentTabId = null;

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  loadTabGroup();
  setupEventListeners();
});

// 设置事件监听器
function setupEventListeners() {
  // 关闭按钮
  document.getElementById('closeBtn').addEventListener('click', () => {
    window.close();
  });
  
  // 上一个/下一个按钮
  document.getElementById('prevBtn').addEventListener('click', () => {
    navigateTab(-1);
  });
  
  document.getElementById('nextBtn').addEventListener('click', () => {
    navigateTab(1);
  });
  
  // 监听标签页激活变化（切换高亮）
  chrome.tabs.onActivated.addListener(() => {
    loadTabGroup();
  });
  
  // 监听存储变化（当新搜索发起时，currentGroup 会更新）
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.currentGroup) {
      loadTabGroup();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.title) {
      loadTabGroup();
    }
  });
  
  chrome.tabs.onRemoved.addListener(() => {
    loadTabGroup();
  });
}

// 加载标签页组信息
async function loadTabGroup() {
  try {
    // 从storage获取当前组信息
    const data = await chrome.storage.local.get('currentGroup');
    
    if (!data.currentGroup || !data.currentGroup.tabIds || data.currentGroup.tabIds.length === 0) {
      showEmptyState();
      return;
    }
    
    const groupInfo = data.currentGroup;
    currentGroupId = groupInfo.groupId;
    
    // 更新信息显示
    document.getElementById('partNumber').textContent = groupInfo.partNumber || '-';
    document.getElementById('supplier').textContent = groupInfo.supplier || '-';
    
    // 获取所有标签页信息
    const tabPromises = groupInfo.tabIds.map(id => 
      chrome.tabs.get(id).catch(() => null)
    );
    
    const allTabs = await Promise.all(tabPromises);
    tabs = allTabs.filter(tab => tab !== null);
    
    // 更新标签页数量
    document.getElementById('tabCount').textContent = `${tabs.length}个页面`;
    
    // 获取当前活动标签页
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTab ? activeTab.id : null;
    
    // 渲染标签页列表
    renderTabList();
    
    // 更新导航按钮状态
    updateNavigationButtons();
  } catch (error) {
    console.error('Error loading tab group:', error);
    showEmptyState();
  }
}

// 显示空状态
function showEmptyState() {
  const tabList = document.getElementById('tabList');
  tabList.innerHTML = `
    <div class="empty-state">
      <p>暂无标签页</p>
      <p class="hint">使用插件打开搜索结果后，这里会显示所有页面</p>
    </div>
  `;
  
  document.getElementById('partNumber').textContent = '-';
  document.getElementById('supplier').textContent = '-';
  document.getElementById('tabCount').textContent = '0个页面';
  
  document.getElementById('prevBtn').disabled = true;
  document.getElementById('nextBtn').disabled = true;
}

// 渲染标签页列表
function renderTabList() {
  const tabList = document.getElementById('tabList');
  
  if (tabs.length === 0) {
    showEmptyState();
    return;
  }
  
  tabList.innerHTML = '';
  
  tabs.forEach((tab, index) => {
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    if (tab.id === currentTabId) {
      tabItem.classList.add('active');
    }
    
    // 获取域名
    let hostname = '-';
    try {
      hostname = new URL(tab.url).hostname;
    } catch (e) {
      hostname = tab.url;
    }
    
    tabItem.innerHTML = `
      <div class="tab-favicon">
        <img src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>'}" 
             alt="favicon"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>'">
      </div>
      <div class="tab-info">
        <div class="tab-header">
          <div class="tab-number">${index + 1}.</div>
          <div class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title)}</div>
        </div>
        <div class="tab-url" title="${escapeHtml(hostname)}">${escapeHtml(hostname)}</div>
      </div>
    `;
    
    // 点击跳转到标签页
    tabItem.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });
    
    tabList.appendChild(tabItem);
  });
}

// 导航到上一个/下一个标签页
async function navigateTab(direction) {
  if (tabs.length === 0) return;
  
  const currentIndex = tabs.findIndex(t => t.id === currentTabId);
  
  if (currentIndex === -1) {
    // 如果当前标签页不在列表中，跳转到第一个
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  
  // 计算下一个索引（循环）
  const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  
  await chrome.tabs.update(nextTab.id, { active: true });
  await chrome.windows.update(nextTab.windowId, { focused: true });
}

// 更新导航按钮状态
function updateNavigationButtons() {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  
  if (tabs.length <= 1) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
  } else {
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
}

// HTML转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 定期刷新（可选）
setInterval(() => {
  loadTabGroup();
}, 3000);
