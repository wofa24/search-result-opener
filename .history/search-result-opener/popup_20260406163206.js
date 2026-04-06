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

// 核心功能：极致抓取逻辑
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false) {
  return new Promise(async (resolve) => {
    let extractedLinks = [];
    let attempts = 0;
    const MAX_PAGE_ATTEMPTS = 4; // 增加最大尝试页数

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

        showStatus(`正在抓取第 ${attempts + 1} 页 [已抓取: ${extractedLinks.length}/${count}]...`, 'info');
        
        try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: async (limit, alreadyFoundUrls) => {
                const pageLinks = [];
                const seen = new Set(alreadyFoundUrls);
                
                // 1. 多段式滚动，强制触发所有懒加载
                for (let i = 0; i < 3; i++) {
                    window.scrollTo(0, (document.body.scrollHeight / 3) * (i + 1));
                    await new Promise(r => setTimeout(r, 400));
                }

                // 2. 暴力提取：寻找符合搜索结果的所有 A 标签
                // 排除含有搜索引擎自身特征的 URL
                const isBlacklisted = (url) => {
                    const black = ['google.com/search', 'bing.com/search', 'microsoft.com', 'bingvisualsearch', 'google.com/url', 'support.google', 'accounts.google'];
                    return black.some(b => url.includes(b));
                };

                // 在通常容纳结果的容器中深入搜索
                const containers = ['#b_results', '#rso', 'main', '.results', '#results'];
                let root = document;
                for (const c of containers) {
                    const el = document.querySelector(c);
                    if (el) { root = el; break; }
                }

                const allLinks = root.querySelectorAll('a[href^="http"]');
                for (const a of allLinks) {
                    const url = a.href;
                    if (!seen.has(url) && !isBlacklisted(url)) {
                        // 寻找最可能的标题：向上寻找 H2/H3，或使用本身文字
                        let titleEl = a.closest('.b_algo, .g')?.querySelector('h2, h3') || a.querySelector('h2, h3') || a;
                        let title = titleEl.textContent.split('\n')[0].trim();
                        if (!title || title.length < 3) continue;

                        seen.add(url);
                        pageLinks.push({ 
                            url, 
                            title: title, 
                            favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
                        });
                    }
                    if ((alreadyFoundUrls.length + pageLinks.length) >= limit) break;
                }

                // 3. 翻页探测
                let nextButtonClicked = false;
                if ((alreadyFoundUrls.length + pageLinks.length) < limit) {
                    const nextSelectors = [
                        '#pnnext', '.sb_pagN', 'a[title="下一页"]', 'a[aria-label="Next page"]',
                        'a[title="Next"]', 'a[aria-label="Next"]', '.nb_next', 'a.next'
                    ];
                    for (const s of nextSelectors) {
                        const btn = document.querySelector(s);
                        if (btn) {
                            btn.click();
                            nextButtonClicked = true;
                            break;
                        }
                    }
                }

                return { links: pageLinks, clickedNext: nextButtonClicked };
              },
              args: [count, extractedLinks.map(l => l.url)]
            });

            if (results && results[0] && results[0].result) {
                const { links, clickedNext } = results[0].result;
                extractedLinks.push(...links);

                if (extractedLinks.length >= count || !clickedNext) break;
            } else {
                break;
            }
            
            // 等待页面跳转/加载
            await new Promise(r => setTimeout(r, 1500));
            attempts++;

        } catch (e) {
            console.error('Speed/Deep capture error:', e);
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
        if (shouldCloseOnFinish) chrome.tabs.remove(tabId).catch(() => {});
        window.close();
        resolve();
      });
    } else {
      showStatus('由于搜索引擎限制，未能发现更多结果', 'error');
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
