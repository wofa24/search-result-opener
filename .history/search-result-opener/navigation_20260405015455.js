// 导航页面逻辑

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 从storage获取搜索信息
  const data = await chrome.storage.local.get('navigationData');
  
  if (data.navigationData) {
    const navData = data.navigationData;
    
    // 更新页面信息
    document.getElementById('partNumber').textContent = navData.partNumber || '-';
    document.getElementById('supplier').textContent = navData.supplier || '-';
    document.getElementById('searchEngine').textContent = navData.searchEngine || 'Bing';
    document.getElementById('resultCount').textContent = navData.resultTabIds ? navData.resultTabIds.length : 0;
    document.getElementById('totalCount').textContent = navData.resultTabIds ? navData.resultTabIds.length : 0;
    
    // 创建空的网格
    createGrid();
  }
});

// 创建网格容器
function createGrid() {
  const content = document.getElementById('content');
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.id = 'grid';
  content.innerHTML = '';
  content.appendChild(grid);
}

// 添加卡片
function addCard(index, screenshot, title, url, tabId, total, favIconUrl = '') {
  let grid = document.getElementById('grid');
  
  if (!grid) {
    grid = createGrid();
  }
  
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.index = index;
  
  const placeholder = favIconUrl ? 
    `<div class="fav-placeholder"><img src="${favIconUrl}" class="card-favicon"></div>` : 
    `<div class="loading-spinner"></div>`;

  card.innerHTML = `
    <div class="thumbnail-container" id="thumb-${index}">
      ${screenshot ? 
        `<img src="${screenshot}" alt="页面截图">` : 
        placeholder
      }
      <div class="number-badge">${index + 2}</div>
    </div>
    <div class="card-info">
      <div class="card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
      <div class="card-url" title="${escapeHtml(url)}">${escapeHtml(getHostname(url))}</div>
      <button class="card-button">打开页面 →</button>
    </div>
  `;
  
  // 添加点击事件
  card.querySelector('.card-button').addEventListener('click', () => {
    switchToTab(tabId);
  });
  
  card.addEventListener('click', (e) => {
    if (e.target !== card.querySelector('.card-button')) {
      switchToTab(tabId);
    }
  });
  
  grid.appendChild(card);
  
  // 更新进度
  updateProgress(index + 1, total);
}

// 切换到指定标签页
function switchToTab(tabId) {
  chrome.tabs.update(tabId, { active: true }, (tab) => {
    if (tab) {
      chrome.windows.update(tab.windowId, { focused: true });
    }
  });
}

// 接收来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addScreenshot') {
    // 添加或更新卡片基本信息
    addCard(request.index, request.screenshot, request.title, request.url, request.tabId, request.total, request.favIconUrl);
    sendResponse({ success: true });
  } else if (request.action === 'updateScreenshot') {
    // 异步更新截图
    const thumbContainer = document.getElementById(`thumb-${request.index}`);
    if (thumbContainer) {
      const img = document.createElement('img');
      img.src = request.screenshot;
      img.alt = '页面截图';
      // 渐显效果
      img.style.opacity = '0';
      img.onload = () => {
        const oldContent = thumbContainer.querySelector('.fav-placeholder, .loading-spinner');
        if (oldContent) oldContent.remove();
        thumbContainer.insertBefore(img, thumbContainer.firstChild);
        img.style.transition = 'opacity 0.5s';
        img.style.opacity = '1';
      };
    }
    sendResponse({ success: true });
  }
  return true;
});

// 更新进度
function updateProgress(current, total) {
  document.getElementById('loadingProgress').textContent = current;
  document.getElementById('totalCount').textContent = total;
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

console.log('Navigation page loaded');
