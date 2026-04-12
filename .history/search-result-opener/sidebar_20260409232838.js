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

// 当前 pinnedTabIds（全局，供 renderTabList 使用）
let pinnedTabIds = [];

// 加载标签页组信息
async function loadTabGroup() {
  try {
    const data = await chrome.storage.local.get('currentGroup');
    
    if (!data.currentGroup || !data.currentGroup.tabIds || data.currentGroup.tabIds.length === 0) {
      showEmptyState();
      return;
    }
    
    const groupInfo = data.currentGroup;
    currentGroupId = groupInfo.groupId;
    pinnedTabIds = groupInfo.pinnedTabIds || [];
    
    document.getElementById('partNumber').textContent = groupInfo.partNumber || '-';
    document.getElementById('supplier').textContent = groupInfo.supplier || '-';
    
    const tabPromises = groupInfo.tabIds.map(id => 
      chrome.tabs.get(id).catch(() => null)
    );
    
    const allTabs = await Promise.all(tabPromises);
    const validTabs = allTabs.filter(tab => tab !== null);

    // 排序：被旗帜标记的排在最前，其余按原序
    const pinned = validTabs.filter(t => pinnedTabIds.includes(t.id));
    const unpinned = validTabs.filter(t => !pinnedTabIds.includes(t.id));
    tabs = [...pinned, ...unpinned];
    
    document.getElementById('tabCount').textContent = `${tabs.length}个页面`;
    
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = activeTab ? activeTab.id : null;
    
    renderTabList();
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

// 关闭单个标签页
async function closeTab(tabId, event) {
  event.stopPropagation();
  try {
    await chrome.tabs.remove(tabId);
    // tabs.onRemoved 会触发 loadTabGroup 自动刷新
  } catch (e) {
    console.error('close tab error:', e);
  }
}

// 切换旗帜标记（支持多个，所有被标记的显示在最前）
async function togglePinTab(tabId, event) {
  event.stopPropagation();
  try {
    const data = await chrome.storage.local.get('currentGroup');
    if (!data.currentGroup) return;
    const group = data.currentGroup;
    if (!group.pinnedTabIds) group.pinnedTabIds = [];

    const pinIdx = group.pinnedTabIds.indexOf(tabId);
    if (pinIdx === -1) {
      // 未标记 → 标记
      group.pinnedTabIds.push(tabId);
    } else {
      // 已标记 → 取消标记
      group.pinnedTabIds.splice(pinIdx, 1);
    }

    await chrome.storage.local.set({ currentGroup: group });
    // 立即刷新列表
    await loadTabGroup();
  } catch (e) {
    console.error('pin tab error:', e);
  }
}

// 渲染标签页列表
function renderTabList() {
  const tabList = document.getElementById('tabList');
  
  if (tabs.length === 0) {
    showEmptyState();
    return;
  }
  
  tabList.innerHTML = '';
  let activeItem = null;
  
  tabs.forEach((tab, index) => {
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    const isActive = tab.id === currentTabId;
    if (isActive) {
      tabItem.classList.add('active');
      activeItem = tabItem;
    }
    
    let hostname = '-';
    try {
      hostname = new URL(tab.url).hostname;
    } catch (e) {
      hostname = tab.url;
    }
    
    const favicon = tab.favIconUrl || 
      'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌐</text></svg>';

    // 是否已被旗帜标记
    const isPinned = pinnedTabIds.includes(tab.id);

    tabItem.innerHTML = `
      <div class="tab-favicon">
        <img src="${favicon}" 
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
      <button class="tab-pin-btn${isPinned ? ' pinned' : ''}" title="${isPinned ? '取消标记' : '标记并置顶'}">🚩</button>
      <button class="tab-close-btn" title="关闭此页面">×</button>
    `;
    
    // 点击跳转到标签页
    tabItem.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });

    // 旗帜按钮（切换标记）
    tabItem.querySelector('.tab-pin-btn').addEventListener('click', (e) => {
      togglePinTab(tab.id, e);
    });

    // 关闭按钮
    tabItem.querySelector('.tab-close-btn').addEventListener('click', (e) => {
      closeTab(tab.id, e);
    });
    
    tabList.appendChild(tabItem);
  });

  // active 项滚动到可视区域中间
  if (activeItem) {
    requestAnimationFrame(() => {
      activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}

// 导航到上一个/下一个标签页
async function navigateTab(direction) {
  if (tabs.length === 0) return;
  
  const currentIndex = tabs.findIndex(t => t.id === currentTabId);
  
  if (currentIndex === -1) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  
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
  div.textContent = text || '';
  return div.innerHTML;
}

// 定期刷新
setInterval(() => {
  loadTabGroup();
}, 3000);
