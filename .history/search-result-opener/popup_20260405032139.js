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
    if (tab && tab.url && isSearchPage(tab.url)) {
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
    const searchQuery = buildSearchQuery(partNumber, supplier);
    const searchEngine = document.getElementById('searchEngine').value;
    const searchUrl = buildSearchUrl(searchEngine, searchQuery);

    showStatus('正在发起自动化搜索...', 'info');
    const automateTab = await chrome.tabs.create({ 
      url: searchUrl, 
      active: false 
    });
    
    await waitForTabAndAutomate(automateTab.id, partNumber, supplier, count, createGroup, openSidebar, true);
    
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
}

// 核心功能：滚动提取并分批打开
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false) {
  return new Promise((resolve) => {
    let attempts = 0;
    const MAX_POLLING = 15;

    const performExtraction = async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status !== 'complete') {
          if (attempts < MAX_POLLING) {
            attempts++;
            showStatus(`等待页面加载 (${attempts}/${MAX_POLLING})...`, 'info');
            setTimeout(performExtraction, 1000);
          } else {
            showStatus('加载超时，请检查网络或手动确认', 'error');
            document.getElementById('confirmBtn').disabled = false;
            resolve();
          }
          return;
        }

        showStatus('正在触发滚动并抓取结果...', 'info');
        
        // 增强版提取器：支持滚动 + 自动翻页以确保拿够 30/50 条
        let links = [];
        let pageAttempts = 0;
        const MAX_PAGE_ATTEMPTS = 3;

        while (links.length < count && pageAttempts < MAX_PAGE_ATTEMPTS) {
          showStatus(`正在抓取结果 [进度: ${links.length}/${count}]...`, 'info');
          
          const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: async (countLimit, currentLinksCount) => {
              const localLinks = [];
              const seen = new Set();
              const itemSelectors = ['#b_results .b_algo', '.b_algo', '#rso .g', '.g', '.rc'];
              
              let scrollAttempts = 0;
              while ((currentLinksCount + localLinks.length) < countLimit && scrollAttempts < 4) {
                let items = [];
                for (const selector of itemSelectors) {
                  const found = document.querySelectorAll(selector);
                  if (found.length > 0) { items = found; break; }
                }
                
                for (const item of items) {
                  if ((currentLinksCount + localLinks.length) >= countLimit) break;
                  const anchor = item.querySelector('h2 a') || item.querySelector('a[href]');
                  const titleEl = item.querySelector('h2') || item.querySelector('h3') || anchor;
                  if (!anchor || !anchor.href) continue;
                  const url = anchor.href;
                  
                  if (url.startsWith('http') && !seen.has(url)) {
                    if (url.includes('google.com') && !url.includes('google.com/url?')) continue;
                    if (url.includes('bing.com') && !url.includes('bing.com/ck/')) continue;
                    seen.add(url);
                    localLinks.push({
                      url: url,
                      title: titleEl ? titleEl.textContent.trim() : url,
                      favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
                    });
                  }
                }
                
                if ((currentLinksCount + localLinks.length) < countLimit) {
                  window.scrollTo(0, document.body.scrollHeight);
                  await new Promise(r => setTimeout(r, 800));
                  scrollAttempts++;
                }
              }

              // 如果还没够，尝试点击下一页按钮
              if ((currentLinksCount + localLinks.length) < countLimit) {
                const nextBtn = document.querySelector('.sb_pagN, #pnnext, [title="下一页"], [aria-label="Next page"]');
                if (nextBtn) {
                  nextBtn.click();
                  return { links: localLinks, navigated: true };
                }
              }
              return { links: localLinks, navigated: false };
            },
            args: [count, links.length]
          });

          const { links: newLinks, navigated } = results[0].result;
          // 合并新链接，去重
          newLinks.forEach(nl => {
            if (!links.find(l => l.url === nl.url)) links.push(nl);
          });

          if (links.length >= count || !navigated) break;
          
          pageAttempts++;
          await new Promise(r => setTimeout(r, 2000)); // 等待翻页加载完毕
        }

        const links = results[0].result;
        
        if (!links || links.length === 0) {
          if (attempts < MAX_POLLING) {
            attempts++;
            showStatus('未检索到结果，重试中...', 'info');
            setTimeout(performExtraction, 2000);
          } else {
            showStatus('未找到有效结果，请手动搜索', 'error');
            document.getElementById('confirmBtn').disabled = false;
            resolve();
          }
          return;
        }

        showStatus(`成功提取 ${links.length} 条结果，准备打开...`, 'success');
        
        const searchEngine = document.getElementById('searchEngine').value;
        const showThumbnails = document.getElementById('showThumbnails').checked;
        
        chrome.runtime.sendMessage({
          action: 'openLinks',
          links: links,
          partNumber: partNumber,
          supplier: supplier,
          searchEngine: searchEngine,
          createGroup: createGroup,
          openSidebar: openSidebar,
          showThumbnails: showThumbnails
        }, () => {
          if (shouldCloseOnFinish) chrome.tabs.remove(tabId);
          window.close();
          resolve();
        });

      } catch (e) {
        console.error('Extraction error:', e);
        if (attempts < MAX_POLLING) {
          attempts++;
          setTimeout(performExtraction, 1000);
        } else {
          showStatus('提取失败: ' + e.message, 'error');
          document.getElementById('confirmBtn').disabled = false;
          resolve();
        }
      }
    };

    performExtraction();
  });
}

// 构建直接搜索的 URL
function buildSearchUrl(engine, query) {
  const encodedQuery = encodeURIComponent(query);
  const count = getSelectedCount();
  
  if (engine === 'google') {
    return `https://www.google.com/search?q=${encodedQuery}${count > 10 ? '&num=' + Math.min(count, 100) : ''}`;
  }
  return `https://www.bing.com/search?q=${encodedQuery}${count > 10 ? '&count=' + Math.min(count, 50) : ''}`;
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
  if (selectedRadio && selectedRadio.value === 'custom') {
    return parseInt(document.getElementById('customCount').value) || 15;
  }
  return selectedRadio ? parseInt(selectedRadio.value) : 10;
}

function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('status');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
  }
}
