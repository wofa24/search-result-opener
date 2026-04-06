// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 加载搜索信息
  await loadSearchInfo();
  
  // 加载历史记录
  await loadHistory();
  
  // 设置事件监听器
  setupEventListeners();
});

// 加载搜索信息
async function loadSearchInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 尝试从当前页面获取搜索信息（如果在搜索结果页）
    if (isSearchPage(tab.url)) {
      // 等待一下让content script加载
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 从content script获取搜索信息
      chrome.tabs.sendMessage(tab.id, { action: 'getSearchQuery' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error:', chrome.runtime.lastError);
          return;
        }
        
        if (response && response.query) {
          const words = response.query.trim().split(/\s+/);
          
          // 第一个词作为料号
          document.getElementById('partNumber').value = words[0] || '';
          
          // 其余词作为供应商
          document.getElementById('supplier').value = words.slice(1).join(' ') || '';
        }
      });
    }
    
    // 不再限制必须在搜索页面使用
    showStatus('请输入料号开始搜索', 'info');
  } catch (error) {
    console.error('Error loading search info:', error);
  }
}

// 检查是否是搜索页面
function isSearchPage(url) {
  return url.includes('bing.com') || 
         url.includes('google.com') ||
         url.includes('google.com.hk');
}

// 设置事件监听器
function setupEventListeners() {
  // 自定义数量单选按钮
  const customRadio = document.querySelector('input[value="custom"]');
  const customCountInput = document.getElementById('customCount');
  
  document.querySelectorAll('input[name="count"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      customCountInput.disabled = e.target.value !== 'custom';
    });
  });
  
  // 高级功能折叠/展开
  document.getElementById('advancedToggle').addEventListener('click', () => {
    const options = document.getElementById('advancedOptions');
    const toggle = document.getElementById('advancedToggle');
    const icon = document.querySelector('.toggle-icon');
    
    if (options.style.display === 'none') {
      options.style.display = 'block';
      icon.textContent = '▼';
      toggle.classList.add('expanded');
    } else {
      options.style.display = 'none';
      icon.textContent = '▶';
      toggle.classList.remove('expanded');
    }
  });
  
  // 确认按钮
  document.getElementById('confirmBtn').addEventListener('click', handleConfirm);
}

// 处理确认按钮点击
async function handleConfirm() {
  const partNumber = document.getElementById('partNumber').value.trim();
  const supplier = document.getElementById('supplier').value.trim();
  
  if (!partNumber) {
    showStatus('请输入料号', 'error');
    return;
  }
  
  const count = getSelectedCount();
  const createGroup = document.getElementById('createGroup').checked;
  const openSidebar = document.getElementById('openSidebar').checked;
  
  saveHistory(partNumber, supplier);

  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const searchQuery = buildSearchQuery(partNumber, supplier);
    const searchEngine = document.getElementById('searchEngine').value;
    const searchUrl = buildSearchUrl(searchEngine, searchQuery);

    // 统一逻辑：始终创建一个专用的后台搜索页来提取结果，提取完即关闭
    // 这样不会干扰用户当前的标签页，且能确保流程百分之百执行
    showStatus('正在发起自动化搜索...', 'info');
    const automateTab = await chrome.tabs.create({ 
      url: searchUrl, 
      active: false // 在后台运行，不打扰用户
    });
    
    await waitForTabAndAutomate(automateTab.id, partNumber, supplier, count, createGroup, openSidebar, true);
    
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
}

// 核心功能：自动化流水线，且支持完成后自动清理中间页
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false) {
  return new Promise((resolve) => {
    let extracted = false;
    let attempts = 0;
    const MAX_POLLING = 10;

    const checkAndExtract = async () => {
      if (extracted || attempts > MAX_POLLING) {
        if (!extracted) {
            showStatus('搜索结果加载慢，请在页面显示后手动点击确认', 'error');
            document.getElementById('confirmBtn').disabled = false;
        }
        return;
      }
      attempts++;
      
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          showStatus(`正在抓取结果 (${attempts}/10)...`, 'info');
          
          await new Promise(r => setTimeout(r, 1000));
          
          chrome.tabs.sendMessage(tabId, { 
            action: 'extractLinks', 
            count: count 
          }, (response) => {
            if (chrome.runtime.lastError || !response || !response.links || response.links.length === 0) {
              setTimeout(checkAndExtract, 1500);
              return;
            }
            
            extracted = true;
            showStatus(`成功找到 ${response.links.length} 条结果！`, 'success');
            
            const searchEngine = document.getElementById('searchEngine').value;
            const showThumbnails = document.getElementById('showThumbnails').checked;
            
            chrome.runtime.sendMessage({
              action: 'openLinks',
              links: response.links,
              partNumber: partNumber,
              supplier: supplier,
              searchEngine: searchEngine,
              createGroup: createGroup,
              openSidebar: openSidebar,
              showThumbnails: showThumbnails
            }, () => {
              // 关键优化：如果要求完成后关闭中转页，则清理它
              if (shouldCloseOnFinish) {
                chrome.tabs.remove(tabId);
              }
              window.close();
              resolve();
            });
          });
        } else {
          setTimeout(checkAndExtract, 1000);
        }
      } catch (e) {
        setTimeout(checkAndExtract, 1000);
      }
    };

    checkAndExtract();
  });
}

// 构建直接搜索的 URL
function buildSearchUrl(engine, query) {
  const encodedQuery = encodeURIComponent(query);
  if (engine === 'google') {
    return `https://www.google.com/search?q=${encodedQuery}`;
  }
  return `https://www.bing.com/search?q=${encodedQuery}`;
}

// 构建搜索查询
function buildSearchQuery(partNumber, supplier) {
  const exactMatch = document.getElementById('exactMatch').checked;
  const fileType = document.getElementById('fileType').value;
  const siteLimit = document.getElementById('siteLimit').value;
  const excludeSite = document.getElementById('excludeSite').value;
  
  let query = '';
  if (exactMatch) query = `"${partNumber}"`;
  else query = partNumber;
  
  if (supplier) query += ` ${supplier}`;
  if (fileType && fileType !== 'none') query += ` ${getFileTypeQuery(fileType)}`;
  if (siteLimit) query += ` ${getSiteLimitQuery(siteLimit)}`;
  if (excludeSite) query += ` ${getExcludeSiteQuery(excludeSite)}`;
  
  return query.trim();
}

function getFileTypeQuery(fileType) {
  const typeMap = {
    'pdf': 'filetype:pdf',
    'doc': '(filetype:doc OR filetype:docx)',
    'xls': '(filetype:xls OR filetype:xlsx)',
    'image': '(filetype:jpg OR filetype:png OR filetype:jpeg)'
  };
  return typeMap[fileType] || '';
}

function getSiteLimitQuery(siteStr) {
  if (!siteStr) return '';
  return siteStr.split(/[,，\s]+/).filter(s => s).map(s => `site:${s}`).join(' OR ');
}

function getExcludeSiteQuery(excludeStr) {
  if (!excludeStr) return '';
  return excludeStr.split(/[,，\s]+/).filter(s => s).map(s => `-site:${s}`).join(' ');
}

async function loadHistory() {
  const result = await chrome.storage.local.get(['searchHistory']);
  const history = result.searchHistory || [];
  const historyList = document.getElementById('historyList');
  
  if (history.length === 0) {
    historyList.innerHTML = '<span class="history-item empty">暂无记录</span>';
    return;
  }
  
  historyList.innerHTML = history.map(item => `
    <span class="history-item" title="${item.partNumber} ${item.supplier}">${item.partNumber}</span>
  `).join('');
  
  historyList.querySelectorAll('.history-item:not(.empty)').forEach((el, index) => {
    el.addEventListener('click', () => {
      const item = history[index];
      document.getElementById('partNumber').value = item.partNumber;
      document.getElementById('supplier').value = item.supplier;
    });
  });
}

async function saveHistory(partNumber, supplier) {
  const result = await chrome.storage.local.get(['searchHistory']);
  let history = result.searchHistory || [];
  history = history.filter(item => item.partNumber !== partNumber);
  history.unshift({ partNumber, supplier, time: Date.now() });
  history = history.slice(0, 10);
  await chrome.storage.local.set({ searchHistory: history });
  loadHistory();
}

function getSelectedCount() {
  const selectedRadio = document.querySelector('input[name="count"]:checked');
  if (selectedRadio.value === 'custom') {
    return parseInt(document.getElementById('customCount').value) || 15;
  }
  return parseInt(selectedRadio.value);
}

function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
  }
}
