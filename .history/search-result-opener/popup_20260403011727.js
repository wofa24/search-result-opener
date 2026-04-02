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
    
    // 检查是否在搜索结果页
    if (!isSearchPage(tab.url)) {
      showStatus('请在Bing或Google搜索结果页使用此插件', 'error');
      document.getElementById('confirmBtn').disabled = true;
      return;
    }
    
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
  showStatus('正在提取搜索结果...', 'info');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // 从content script提取链接
    chrome.tabs.sendMessage(tab.id, { 
      action: 'extractLinks', 
      count: count,
      filterAds: filterAds
    }, async (response) => {
      if (chrome.runtime.lastError) {
        showStatus('提取失败: ' + chrome.runtime.lastError.message, 'error');
        btn.disabled = false;
        return;
      }
      
      if (response && response.links && response.links.length > 0) {
        showStatus(`找到 ${response.links.length} 个结果，正在打开...`, 'info');
        
        // 发送到background打开链接
        chrome.runtime.sendMessage({
          action: 'openLinks',
          links: response.links,
          partNumber: partNumber,
          supplier: supplier,
          createGroup: createGroup,
          openSidebar: openSidebar
        }, (result) => {
          if (result && result.success) {
            showStatus('成功打开 ' + response.links.length + ' 个页面！', 'success');
            setTimeout(() => window.close(), 1000);
          } else {
            showStatus('打开失败: ' + (result?.error || '未知错误'), 'error');
            btn.disabled = false;
          }
        });
      } else {
        showStatus('未找到搜索结果，请检查页面', 'error');
        btn.disabled = false;
      }
    });
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
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
