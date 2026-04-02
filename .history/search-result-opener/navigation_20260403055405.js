// 导航页面逻辑

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 从storage获取搜索信息
  const data = await chrome.storage.local.get(['navigationData', 'searchResults']);
  
  if (data.navigationData) {
    const navData = data.navigationData;
    
    // 更新页面信息
    document.getElementById('partNumber').textContent = navData.partNumber || '-';
    document.getElementById('supplier').textContent = navData.supplier || '-';
    document.getElementById('searchEngine').textContent = navData.searchEngine || 'Bing';
    document.getElementById('resultCount').textContent = navData.tabIds ? navData.tabIds.length - 1 : 0;
    document.getElementById('totalCount').textContent = navData.tabIds ? navData.tabIds.length - 1 : 0;
    
    // 创建卡片
    if (data.searchResults && data.searchResults.length > 0) {
      createCards(navData, data.searchResults);
    }
  }
});

// 创建卡片
async function createCards(navData, searchResults) {
  const content = document.getElementById('content');
  const grid = document.createElement('div');
  grid.className = 'grid';
  
  // 创建每个结果的卡片
  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const card = createCard(result, i + 2, navData.tabIds[i + 1]);
    grid.appendChild(card);
  }
  
  content.innerHTML = '';
  content.appendChild(grid);
}

// 创建单个卡片
function createCard(result, pageNumber, tabId) {
  const card = document.createElement('div');
  card.className = 'card';
  
  card.innerHTML = `
    <div class="thumbnail-container">
      ${result.screenshot ? 
        `<img src="${result.screenshot}" alt="页面截图">` : 
        `<div class="loading-spinner"></div>`
      }
      <div class="number-badge">${pageNumber}</div>
    </div>
    <div class="card-info">
      <div class="card-title" title="${escapeHtml(result.title)}">${escapeHtml(result.title)}</div>
      <div class="card-url" title="${escapeHtml(result.url)}">${escapeHtml(getHostname(result.url))}</div>
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
  
  return card;
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
  if (request.action === 'updateScreenshot') {
    // 更新截图
    updateScreenshot(request.index, request.screenshot);
    updateProgress(request.index + 1, request.total);
    sendResponse({ success: true });
  }
  return true;
});

// 更新截图
function updateScreenshot(index, screenshot) {
  const cards = document.querySelectorAll('.card');
  if (cards[index]) {
    const container = cards[index].querySelector('.thumbnail-container');
    const spinner = container.querySelector('.loading-spinner');
    
    if (spinner) {
      spinner.remove();
    }
    
    const img = document.createElement('img');
    img.src = screenshot;
    img.alt = '页面截图';
    container.appendChild(img);
  }
}

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
