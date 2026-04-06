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
    let shouldClose = false; 

    if (currentTab && isSearchPage(currentTab.url)) {
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

// 核心功能：极致全能破限抓取逻辑
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false) {
  return new Promise(async (resolve) => {
    let extractedLinks = [];
    let attempts = 0;
    const MAX_PAGE_ATTEMPTS = 5; // 进一步增加深度

    while (extractedLinks.length < count && attempts < MAX_PAGE_ATTEMPTS) {
        const waitTabReady = (id) => new Promise(res => {
          const startTime = Date.now();
          const check = async () => {
            if (Date.now() - startTime > 15000) return res(null);
            try {
              const t = await chrome.tabs.get(id);
              if (t.status === 'complete') res(t);
              else setTimeout(check, 300);
            } catch(e) { res(null); }
          };
          check();
        });

        const currentTab = await waitTabReady(tabId);
        if (!currentTab) break;

        showStatus(`破限模式检索 [${extractedLinks.length}/${count}]...`, 'info');
        
        try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: async (limit, alreadyFoundUrls) => {
                const pageLinks = [];
                const seen = new Set(alreadyFoundUrls);
                
                // 1. 三段式仿真滚动，强制刷新异步数据
                const scrollHeights = [0.3, 0.6, 1.0];
                for (const sh of scrollHeights) {
                    window.scrollTo(0, document.body.scrollHeight * sh);
                    await new Promise(r => setTimeout(r, 500));
                }

                // 2. 暴力扫描：不留死角的选择器 + 计算样式可见性检查
                const isBlacklisted = (url) => {
                  const b = ['google.com/', 'bing.com/', 'microsoft.com/', 'googleadservices.com', 'bingvisualsearch', 'support.google', 'accounts.google'];
                  return b.some(pattern => url.toLowerCase().includes(pattern.toLowerCase()));
                };

                const allLinks = document.querySelectorAll('a[href^="http"]');
                for (const a of allLinks) {
                    const url = a.href;
                    if (!seen.has(url) && !isBlacklisted(url)) {
                        // 寻找最像搜索标题的文本
                        let text = "";
                        const h = a.querySelector('h2, h3') || a.closest('.b_algo, .g')?.querySelector('h2, h3');
                        if (h) text = h.textContent;
                        else {
                          // 如果没有 H 标签，使用自身可见文本中的第一行
                          const rect = a.getBoundingClientRect();
                          if (rect.width > 0 && rect.height > 0) { // 简单检查可见性
                            text = a.innerText || a.textContent;
                          }
                        }
                        
                        let finalTitle = text.split('\n')[0].trim();
                        if (finalTitle && finalTitle.length > 5) {
                            seen.add(url);
                            pageLinks.push({ 
                                url, 
                                title: finalTitle, 
                                favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
                            });
                        }
                    }
                    if ((alreadyFoundUrls.length + pageLinks.length) >= limit) break;
                }

                // 3. 多保险翻页嗅探
                let nextAction = { clicked: false, nextUrl: null };
                
                if ((alreadyFoundUrls.length + pageLinks.length) < limit) {
                    // 方法 A: 点击翻页按钮
                    const nextBtnSelectors = [
                        '#pnnext', '.sb_pagN', 'a[title="下一页"]', 'a[aria-label="Next page"]',
                        'a[title="Next"]', 'a[aria-label="Next"]', '.nb_next', 'a.next', 'a.pagination__next'
                    ];
                    for (const s of nextBtnSelectors) {
                        const btn = document.querySelector(s);
                        if (btn && btn.offsetHeight > 0) {
                            btn.click();
                            nextAction.clicked = true;
                            break;
                        }
                    }

                    // 方法 B: 如果 A 失败，尝试 URL 偏移计算翻页 (针对 Bing)
                    if (!nextAction.clicked && window.location.hostname.includes('bing.com')) {
                        const url = new URL(window.location.href);
                        let first = parseInt(url.searchParams.get('first')) || 1;
                        url.searchParams.set('first', first + 10);
                        nextAction.nextUrl = url.toString();
                    }
                }

                return { links: pageLinks, nextAction };
              },
              args: [count, extractedLinks.map(l => l.url)]
            });

            if (results && results[0] && results[0].result) {
                const { links, nextAction } = results[0].result;
                extractedLinks.push(...links);

                if (extractedLinks.length >= count) break;

                if (nextAction.nextUrl) {
                  await chrome.tabs.update(tabId, { url: nextAction.nextUrl });
                } else if (!nextAction.clicked) {
                  break; // 既点不了也算不出下一页，则停止
                }
            } else {
                break;
            }
            
            await new Promise(r => setTimeout(r, 2000));
            attempts++;

        } catch (e) {
            console.error('Speed/Deep/Stealth capture error:', e);
            break;
        }
    }

    if (extractedLinks.length > 0) {
      showStatus(`成功破限提取 ${extractedLinks.length} 条结果`, 'success');
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
        if (shouldCloseOnFinish) chrome.tabs.remove(tabId).catch(() => {});
        window.close();
        resolve();
      });
    } else {
      showStatus('破限模式尝试完毕，搜索引擎未开放更多公开结果', 'error');
      document.getElementById('confirmBtn').disabled = false;
      resolve();
    }
  });
}

// 构建 URL
function buildSearchUrl(engine, query) {
  const q = encodeURIComponent(query);
  if (engine === 'google') return `https://www.google.com/search?q=${q}&num=50`;
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
