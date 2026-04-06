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
    
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let automateTab;
    let shouldClose = true;

    if (currentTab && isSearchPage(currentTab.url)) {
      // 复用当前页面发起搜索
      automateTab = await chrome.tabs.update(currentTab.id, { url: searchUrl });
      shouldClose = true; 
    } else {
      automateTab = await chrome.tabs.create({ url: searchUrl, active: false });
      shouldClose = true;
    }
    
    await waitForTabAndAutomate(automateTab.id, partNumber, supplier, count, createGroup, openSidebar, shouldClose);
    
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
}

// 核心功能：重构的“调度式抓取”逻辑，解决 Frame removed 报错
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false) {
  return new Promise(async (resolve) => {
    let extractedLinks = [];
    let pageAttempts = 0;
    const MAX_PAGES = 5;

    const waitTabReady = (id) => new Promise(res => {
      const startTime = Date.now();
      const check = async () => {
        if (Date.now() - startTime > 30000) return res(null); // 30s 超时
        try {
          const t = await chrome.tabs.get(id);
          if (t.status === 'complete') {
            // 额外多等 500ms 确保页面内部脚本渲染完成
            setTimeout(() => res(t), 500);
          }
          else setTimeout(check, 500);
        } catch(e) { res(null); }
      };
      check();
    });

    while (extractedLinks.length < count && pageAttempts < MAX_PAGES) {
      const currentTab = await waitTabReady(tabId);
      if (!currentTab) break;

      showStatus(`正在抓取第 ${pageAttempts + 1} 页 [已获取: ${extractedLinks.length}/${count}]...`, 'info');
      
      // 每一页都重新注入脚本，确保上下文正确
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: async (limit, currentTotal) => {
            const pageLinks = [];
            const seen = new Set();
            const selectors = [
                '#b_results .b_algo', 
                '.b_algo', 
                '#rso > div > .g', 
                '#rso .g', 
                '.g', 
                '.rc',
                'div[data-hveid] a[href^="http"]:not([href*="google.com"]):not([role="button"])'
            ];
            
            // 内部滚动以加载懒加载项 (增加等待和重试)
            let scrolls = 0;
            while ((currentTotal + pageLinks.length) < limit && scrolls < 5) {
                let items = [];
                for (const s of selectors) {
                    const found = document.querySelectorAll(s);
                    if (found.length > 0) {
                        items = Array.from(found).filter(el => {
                            // 如果选择器直接选中了链接
                            if (el.tagName === 'A') return true;
                            // 否则寻找内部链接
                            const a = el.querySelector('h2 a') || el.querySelector('a[href]');
                            return a && a.href && a.href.startsWith('http');
                        });
                        if (items.length > 0) break;
                    }
                }
                
                for (const item of items) {
                    const a = item.tagName === 'A' ? item : (item.querySelector('h2 a') || item.querySelector('a[href]'));
                    if (!a) continue;
                    
                    const tEl = item.querySelector('h2') || item.querySelector('h3') || a;
                    const url = a.href;
                    if (!seen.has(url)) {
                        // 过滤掉无关链接
                        if (url.includes('google.com') && (url.includes('/search?') || url.includes('/advanced_search'))) continue;
                        if (url.includes('bing.com') && (url.includes('/search?') || url.includes('/rewards'))) continue;
                        if (url.includes('microsoft.com') || url.includes('bingvisualsearch.com')) continue;
                        
                        seen.add(url);
                        pageLinks.push({ 
                            url, 
                            title: tEl ? tEl.textContent.trim() : url, 
                            favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
                        });
                    }
                    if ((currentTotal + pageLinks.length) >= limit) break;
                }
                
                if ((currentTotal + pageLinks.length) < limit) {
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(r => setTimeout(r, 1000)); // 增加滚动等待
                }
                scrolls++;
            }

            // 检查是否有下一页
            let navigated = false;
            if ((currentTotal + pageLinks.length) < limit) {
              const next = document.querySelector('.sb_pagN, #pnnext, [title="下一页"], [aria-label="Next page"]');
              if (next) {
                next.click();
                navigated = true;
              }
            }
            return { links: pageLinks, navigated };
          },
          args: [count, extractedLinks.length]
        });

        const { links, navigated } = results[0].result;
        links.forEach(l => {
          if (!extractedLinks.find(el => el.url === l.url)) extractedLinks.push(l);
        });

        if (extractedLinks.length >= count || !navigated) break;
        
        pageAttempts++;
        // 重要：给页面点时间开始刷新，并重置标签页状态检查
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) {
        console.error('Execute script error:', e);
        break; // 遇到错误则停止抓取，尝试打开现有链接
      }
    }

    if (extractedLinks.length > 0) {
      showStatus(`成功提取 ${extractedLinks.length} 条，准备开启批处理...`, 'success');
      const searchEngine = document.getElementById('searchEngine').value;
      const showThumbnails = document.getElementById('showThumbnails').checked;

      chrome.runtime.sendMessage({
        action: 'openLinks',
        links: extractedLinks,
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
    } else {
      showStatus('未能抓取到结果，请手动检查', 'error');
      document.getElementById('confirmBtn').disabled = false;
      resolve();
    }
  });
}

// 构建 URL
function buildSearchUrl(engine, query) {
  const q = encodeURIComponent(query);
  const count = getSelectedCount();
  if (engine === 'google') return `https://www.google.com/search?q=${q}${count > 10 ? '&num=' + Math.min(count, 100) : ''}`;
  return `https://www.bing.com/search?q=${q}${count > 10 ? '&count=' + Math.min(count, 50) : ''}`;
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
