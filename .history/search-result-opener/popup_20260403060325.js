// 页面加载时初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 加载搜索信息
  await loadSearchInfo();
  
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
  
  // 获取选择的数量
  const count = getSelectedCount();
  
  // 获取选项
  const createGroup = document.getElementById('createGroup').checked;
  const filterAds = document.getElementById('filterAds').checked;
  const openSidebar = document.getElementById('openSidebar').checked;
  
  // 禁用按钮，显示加载状态
  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 检查是否在搜索结果页
    const isOnSearchResultPage = tab.url.includes('/search?q=') || tab.url.includes('/search?');
    
    if (!isOnSearchResultPage) {
      // 不在搜索结果页，先执行搜索
      showStatus('正在搜索...', 'info');
      await performSearch(tab.id, partNumber, supplier, count, createGroup, filterAds, openSidebar);
    } else {
      // 已经在搜索结果页，直接提取
      showStatus('正在提取搜索结果...', 'info');
      await extractAndOpen(tab.id, partNumber, supplier, count, createGroup, filterAds, openSidebar);
    }
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
}

// 构建搜索查询
function buildSearchQuery(partNumber, supplier) {
  // 获取搜索选项
  const exactMatch = document.getElementById('exactMatch').checked;
  const fileType = document.getElementById('fileType').value;
  const siteLimit = document.getElementById('siteLimit').value;
  const excludeSite = document.getElementById('excludeSite').value;
  
  let query = '';
  
  // 1. 处理料号（完全匹配）
  if (exactMatch) {
    query = `"${partNumber}"`;
  } else {
    query = partNumber;
  }
  
  // 2. 添加供应商
  if (supplier) {
    query += ` ${supplier}`;
  }
  
  // 3. 添加文件格式
  if (fileType && fileType !== 'none') {
    query += ` ${getFileTypeQuery(fileType)}`;
  }
  
  // 4. 添加站点限定
  if (siteLimit && siteLimit !== 'none') {
    query += ` ${getSiteLimitQuery(siteLimit)}`;
  }
  
  // 5. 添加排除站点
  if (excludeSite && excludeSite !== 'none') {
    query += ` ${getExcludeSiteQuery(excludeSite)}`;
  }
  
  return query.trim();
}

// 获取文件格式查询
function getFileTypeQuery(fileType) {
  const typeMap = {
    'pdf': 'filetype:pdf',
    'doc': '(filetype:doc OR filetype:docx)',
    'xls': '(filetype:xls OR filetype:xlsx)',
    'image': '(filetype:jpg OR filetype:png OR filetype:jpeg)'
  };
  return typeMap[fileType] || '';
}

// 获取站点限定查询
function getSiteLimitQuery(site) {
  const siteMap = {
    'alibaba': 'site:1688.com',
    'taobao': 'site:taobao.com',
    'jd': 'site:jd.com',
    'tmall': 'site:tmall.com'
  };
  return siteMap[site] || '';
}

// 获取排除站点查询
function getExcludeSiteQuery(exclude) {
  const excludeMap = {
    'forums': '-site:bbs.* -site:forum.* -site:tieba.baidu.com',
    'qa': '-site:zhidao.baidu.com -site:zhihu.com -site:wenda.*'
  };
  return excludeMap[exclude] || '';
}

// 执行搜索
async function performSearch(tabId, partNumber, supplier, count, createGroup, filterAds, openSidebar) {
  const searchQuery = buildSearchQuery(partNumber, supplier);
  
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'performSearch',
      query: searchQuery
    }, async (response) => {
      if (chrome.runtime.lastError) {
        showStatus('搜索失败: ' + chrome.runtime.lastError.message, 'error');
        document.getElementById('confirmBtn').disabled = false;
        reject(chrome.runtime.lastError);
        return;
      }
      
      if (response && response.success) {
        // 等待页面加载和导航完成
        showStatus('等待搜索结果加载...', 'info');
        
        // 监听标签页更新
        const updateListener = (updatedTabId, changeInfo, updatedTab) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(updateListener);
            
            // 再等待一下确保content script加载
            setTimeout(async () => {
              await extractAndOpen(tabId, partNumber, supplier, count, createGroup, filterAds, openSidebar);
              resolve();
            }, 1000);
          }
        };
        
        chrome.tabs.onUpdated.addListener(updateListener);
        
        // 设置超时
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(updateListener);
          showStatus('搜索超时，请重试', 'error');
          document.getElementById('confirmBtn').disabled = false;
          reject(new Error('Timeout'));
        }, 10000);
      } else {
        showStatus('搜索失败，请检查页面', 'error');
        document.getElementById('confirmBtn').disabled = false;
        reject(new Error('Search failed'));
      }
    });
  });
}

// 提取链接并打开
async function extractAndOpen(tabId, partNumber, supplier, count, createGroup, filterAds, openSidebar) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { 
      action: 'extractLinks', 
      count: count,
      filterAds: filterAds
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('提取失败: ' + chrome.runtime.lastError.message, 'error');
        document.getElementById('confirmBtn').disabled = false;
        reject(chrome.runtime.lastError);
        return;
      }
      
      if (response && response.links && response.links.length > 0) {
        showStatus(`找到 ${response.links.length} 个结果，正在打开...`, 'info');
        
        // 获取搜索引擎
        const searchEngine = document.getElementById('searchEngine').value;
        
        // 发送到background打开链接
        chrome.runtime.sendMessage({
          action: 'openLinks',
          links: response.links,
          partNumber: partNumber,
          supplier: supplier,
          searchEngine: searchEngine,
          createGroup: createGroup,
          openSidebar: openSidebar
        }, (result) => {
          if (result && result.success) {
            showStatus('成功打开 ' + response.links.length + ' 个页面！', 'success');
            setTimeout(() => window.close(), 1000);
            resolve();
          } else {
            showStatus('打开失败: ' + (result?.error || '未知错误'), 'error');
            document.getElementById('confirmBtn').disabled = false;
            reject(new Error('Open failed'));
          }
        });
      } else {
        showStatus('未找到搜索结果，请检查页面', 'error');
        document.getElementById('confirmBtn').disabled = false;
        reject(new Error('No results'));
      }
    });
  });
}

// 获取选择的数量
function getSelectedCount() {
  const selectedRadio = document.querySelector('input[name="count"]:checked');
  if (selectedRadio.value === 'custom') {
    return parseInt(document.getElementById('customCount').value) || 15;
  }
  return parseInt(selectedRadio.value);
}

// 显示状态消息
function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;
}
