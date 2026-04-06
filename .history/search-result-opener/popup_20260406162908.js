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
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host.includes('bing.com') || 
           host.includes('google.com') ||
           host.includes('google.com.hk');
  } catch(e) {
    return false;
  }
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

// 获取选中的数量
function getSelectedCount() {
  const selectedRadio = document.querySelector('input[name="count"]:checked');
  if (selectedRadio && selectedRadio.value === 'custom') {
    return parseInt(document.getElementById('customCount').value) || 15;
  }
  return selectedRadio ? parseInt(selectedRadio.value) : 10;
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
    
    // 获取当前活动标签页
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let automateTab;
    let shouldClose = false; // 默认不关闭，如果复用则不关，如果是新开且抓取完毕则根据需求定

    if (currentTab && isSearchPage(currentTab.url)) {
      // 智能环境复用：在搜索结果页进行的新搜索，都在原页面更新
      automateTab = await chrome.tabs.update(currentTab.id, { url: searchUrl });
      shouldClose = false; 
    } else {
      automateTab = await chrome.tabs.create({ url: searchUrl, active: true });
      shouldClose = true;
    }
    
    await waitForTabAndAutomate(automateTab.id, partNumber, supplier, count, createGroup, openSidebar, shouldClose);
    
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
}

// 核心功能：重火力抓取逻辑
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false) {
  return new Promise(async (resolve) => {
    let extractedLinks = [];
    let attempts = 0;
    const MAX_PAGE_ATTEMPTS = 3; // 如果一页不够，最多翻3页

    while (extractedLinks.length < count && attempts < MAX_PAGE_ATTEMPTS) {
        // 快速等待页面加载
        const waitTabReady = (id) => new Promise(res => {
          const startTime = Date.now();
          const check = async () => {
            if (Date.now() - startTime > 15000) return res(null);
            try {
              const t = await chrome.tabs.get(id);
              if (t.status === 'complete') res(t);
              else setTimeout(check, 200);
            } catch(e) { res(null); }
          };
          check();
        });

        const currentTab = await waitTabReady(tabId);
        if (!currentTab) break;

        showStatus(`正在深度捕获 [已获取: ${extractedLinks.length}/${count}]...`, 'info');
        
        try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: async (limit, alreadyFoundUrls) => {
                const pageLinks = [];
                const seen = new Set(alreadyFoundUrls);
                
                // 1. 主动滚动触发渲染
                window.scrollTo(0, document.body.scrollHeight / 2);
                await new Promise(r => setTimeout(r, 300));
                window.scrollTo(0, document.body.scrollHeight);
                await new Promise(r => setTimeout(r, 300));

                const selectors = [
                    '#b_results .b_algo', 
                    '#rso .g', 
                    '.g', 
                    'li.b_algo',
                    '.b_algo',
                    'div.b_tpcn',
                    'div[data-hveid] a[href^="http"]:not([href*="google.com"]):not([role="button"])'
                ];
                
                const items = [];
                selectors.forEach(s => {
                    document.querySelectorAll(s).forEach(el => {
                        if (!items.includes(el)) items.push(el);
                    });
                });

                for (const item of items) {
                    const a = item.tagName === 'A' ? item : (item.querySelector('h2 a') || item.querySelector('a[href]') || item.querySelector('a'));
>>>>>>>------- SEARCH
                // 2. 如果还是不够，尝试发现“下一页”按钮并准备点击
                let nextButton = null;
                if ((alreadyFoundUrls.length + pageLinks.length) < limit) {
                    nextButton = document.querySelector('#pnnext') || document.querySelector('.sb_pagN') || document.querySelector('a[title="Next"]');
                    if (nextButton) {
                        nextButton.click();
                    }
                }
                // 2. 深度尝试：如果结果非常少（只有几个），强制触发一次滚动并再等一下
                if (pageLinks.length < 5) {
                    window.scrollBy(0, 500);
                    await new Promise(r => setTimeout(r, 200));
                }

                // 3. 如果还是不够，尝试发现“下一页”按钮并准备点击
                let nextButton = null;
                if ((alreadyFoundUrls.length + pageLinks.length) < limit) {
                    nextButton = document.querySelector('#pnnext') || document.querySelector('.sb_pagN') || document.querySelector('a[title="下一页"]') || document.querySelector('a[aria-label="Next page"]') || document.querySelector('a[aria-label="Next"]');
                    if (nextButton) {
                        nextButton.click();
                    }
                }
                    if (!a || !a.href || !a.href.startsWith('http')) continue;
                    
                    const url = a.href;
                    if (!seen.has(url)) {
                        if (url.includes('google.com/search') || url.includes('bing.com/search')) continue;
                        
                        seen.add(url);
                        pageLinks.push({ 
                            url, 
                            title: (item.querySelector('h2') || item.querySelector('h3') || a).textContent.split('\n')[0].trim(), 
                            favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
                        });
                    }
                    if ((alreadyFoundUrls.length + pageLinks.length) >= limit) break;
                }

                // 2. 如果还是不够，尝试发现“下一页”按钮并准备点击
                let nextButton = null;
                if ((alreadyFoundUrls.length + pageLinks.length) < limit) {
                    nextButton = document.querySelector('#pnnext') || document.querySelector('.sb_pagN') || document.querySelector('a[title="Next"]');
                    if (nextButton) {
                        nextButton.click();
                    }
                }

                return { links: pageLinks, clickedNext: !!nextButton };
              },
              args: [count, extractedLinks.map(l => l.url)]
            });

            const { links, clickedNext } = results[0].result;
            extractedLinks.push(...links);

            if (extractedLinks.length >= count || !clickedNext) break;
            
            // 如果点击了下一页，等待一页加载的时间
            await new Promise(r => setTimeout(r, 1000));
            attempts++;

        } catch (e) {
            console.error('Deep capture error:', e);
            break;
        }
    }

    if (extractedLinks.length > 0) {
      showStatus(`成功提取 ${extractedLinks.length} 条结果`, 'success');
      const searchEngine = document.getElementById('searchEngine').value;

      chrome.runtime.sendMessage({
        action: 'openLinks',
        links: extractedLinks,
        partNumber: partNumber,
        supplier: supplier,
        searchEngine: searchEngine,
        createGroup: createGroup,
        openSidebar: openSidebar
      }, () => {
        // 如果是新开的搜索页且抓取完毕，则关闭它以保持整洁；如果是复用的则保留
        if (shouldCloseOnFinish) chrome.tabs.remove(tabId).catch(() => {});
        window.close();
        resolve();
      });
    } else {
      showStatus('未发现结果，请检查搜索词', 'error');
      document.getElementById('confirmBtn').disabled = false;
      resolve();
    }
  });
}

// 构建 URL：强制单页加载参数
function buildSearchUrl(engine, query) {
  const q = encodeURIComponent(query);
  if (engine === 'google') return `https://www.google.com/search?q=${q}&num=20`;
  return `https://www.bing.com/search?q=${q}&count=50`;
}

// 构建 Search Query
function buildSearchQuery(p, s) {
  const exact = document.getElementById('exactMatch').checked;
  const f = document.getElementById('fileType').value;
  const sL = document.getElementById('siteLimit').value;
  const eS = document.getElementById('excludeSite').value;
  
  let q = exact ? `"${p}"` : p;
  if (s) q += ` ${s}`;
  if (f && f !== 'none') q += ` ${getFileTypeQuery(f)}`;
  if (sL) q += ` ${sL.split(/[,，\s]+/).filter(x=>x).map(x=>`site:${x}`).join(' OR ')}`;
  if (eS) q += ` ${eS.split(/[,，\s]+/).filter(x=>x).map(x=>`-site:${x}`).join(' ')}`;
  return q.trim();
}

function getFileTypeQuery(t) {
  const m = {'pdf': 'filetype:pdf', 'doc': '(filetype:doc OR filetype:docx)', 'xls': '(filetype:xls OR filetype:xlsx)', 'image': '(filetype:jpg OR filetype:png)'};
  return m[t] || '';
}

async function loadHistory() {
  const r = await chrome.storage.local.get(['searchHistory']);
  const h = r.searchHistory || [];
  const list = document.getElementById('historyList');
  if (h.length === 0) { list.innerHTML = '<span class="history-item empty">暂无记录</span>'; return; }
  list.innerHTML = h.map(i => `<span class="history-item" title="${i.partNumber} ${i.supplier}">${i.partNumber}</span>`).join('');
  list.querySelectorAll('.history-item:not(.empty)').forEach((el, idx) => {
    el.addEventListener('click', () => {
      const item = h[idx];
      document.getElementById('partNumber').value = item.partNumber;
      document.getElementById('supplier').value = item.supplier;
    });
  });
}

async function saveHistory(p, s) {
  const r = await chrome.storage.local.get(['searchHistory']);
  let h = r.searchHistory || [];
  h = h.filter(i => i.partNumber !== p);
  h.unshift({ partNumber: p, supplier: s, time: Date.now() });
  await chrome.storage.local.set({ searchHistory: h.slice(0, 10) });
  loadHistory();
}

function showStatus(m, t = 'info') {
  const s = document.getElementById('status');
  if (s) { s.textContent = m; s.className = 'status ' + t; }
}
