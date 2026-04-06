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

    showStatus('正在发起搜索...', 'info');
    
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
    
    await waitForTabAndAutomate(automateTab.id, partNumber, supplier, count, createGroup, openSidebar, shouldClose, searchUrl, searchEngine);
    
  } catch (error) {
    showStatus('发生错误: ' + error.message, 'error');
    btn.disabled = false;
  }
}

// 等待标签页加载完成，complete 后再额外等待 DOM 渲染
function waitTabReady(id, timeout = 20000, extraDelay = 800) {
  return new Promise(res => {
    const startTime = Date.now();
    const check = async () => {
      if (Date.now() - startTime > timeout) return res(null);
      try {
        const t = await chrome.tabs.get(id);
        if (t.status === 'complete') {
          // 额外等待 DOM 完全渲染
          setTimeout(() => res(t), extraDelay);
        } else {
          setTimeout(check, 300);
        }
      } catch(e) { res(null); }
    };
    check();
  });
}

// 构建翻页URL（重新构建干净的URL，只保留必要参数）
function buildPageUrl(baseUrl, engine, page) {
  const originUrl = new URL(baseUrl);
  if (engine === 'bing') {
    // Bing 翻页只需要 q + first，去掉 count 等多余参数
    const q = originUrl.searchParams.get('q') || '';
    const newUrl = new URL('https://www.bing.com/search');
    newUrl.searchParams.set('q', q);
    if (page > 1) {
      newUrl.searchParams.set('first', String((page - 1) * 10 + 1)); // 第2页=11, 第3页=21
    }
    return newUrl.toString();
  } else {
    // Google 翻页: start=0, start=10, start=20 ...
    const q = originUrl.searchParams.get('q') || '';
    const newUrl = new URL('https://www.google.com/search');
    newUrl.searchParams.set('q', q);
    newUrl.searchParams.set('num', '10');
    if (page > 1) {
      newUrl.searchParams.set('start', String((page - 1) * 10));
    }
    return newUrl.toString();
  }
}

// 用 executeScript 直接注入提取代码（比 sendMessage 更可靠）
async function extractFromTabDirect(tabId, engine) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (eng) => {
        const links = [];
        let items = [];

        if (eng === 'bing') {
          items = Array.from(document.querySelectorAll('#b_results .b_algo, .b_algo'));
        } else {
          // Google
          const candidates = document.querySelectorAll('#rso .g, #search .g, .g');
          candidates.forEach(el => {
            // 跳过嵌套的 .g 元素
            if (el.closest('.g') === el) items.push(el);
          });
        }

        for (const item of items) {
          const anchor = item.querySelector('h2 a, h3 a, a[href]');
          if (!anchor || !anchor.href) continue;
          const url = anchor.href;
          if (!url.startsWith('http')) continue;
          // 过滤搜索引擎自身链接
          if (url.includes('bing.com/search') || url.includes('bing.com/aclick') ||
              url.includes('google.com/search') || url.includes('google.com/aclk') ||
              url.includes('microsoft.com') || url.includes('googleadservices.com')) continue;

          const titleEl = item.querySelector('h2, h3') || anchor;
          const title = titleEl.textContent.trim();
          if (title.length < 2) continue;

          links.push({
            url: url,
            title: title,
            favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
          });
        }
        return links;
      },
      args: [engine]
    });
    return results[0].result || [];
  } catch (e) {
    console.error('executeScript error:', e);
    return [];
  }
}

// 核心功能：多页提取，每页结果直接累加（不跨页去重），用 executeScript 直接注入
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false, searchUrl = '', engine = 'bing') {
  return new Promise(async (resolve) => {
    const currentTab = await waitTabReady(tabId);
    if (!currentTab) {
      showStatus('搜索页面加载超时', 'error');
      document.getElementById('confirmBtn').disabled = false;
      return resolve();
    }

    const baseUrl = searchUrl || currentTab.url;
    const allLinks = [];
    let page = 1;
    const maxPages = 5;

    showStatus(`正在提取第 ${page} 页...`, 'info');

    while (allLinks.length < count && page <= maxPages) {
      // 第2页起导航到新URL
      if (page > 1) {
        const pageUrl = buildPageUrl(baseUrl, engine, page);
        await chrome.tabs.update(tabId, { url: pageUrl });
        await new Promise(r => setTimeout(r, 600));
        const ready = await waitTabReady(tabId, 20000);
        if (!ready) break;
        showStatus(`正在提取第 ${page} 页（已有 ${allLinks.length} 条）...`, 'info');
      }

      // 直接注入脚本提取当前页结果
      const pageLinks = await extractFromTabDirect(tabId, engine);

      if (pageLinks.length === 0) break; // 页面没结果就停

      // 直接累加，不做跨页去重
      for (const link of pageLinks) {
        allLinks.push(link);
        if (allLinks.length >= count) break;
      }

      page++;
    }

    if (allLinks.length > 0) {
      showStatus(`成功提取 ${allLinks.length} 条结果`, 'success');
      chrome.runtime.sendMessage({
        action: 'openLinks',
        links: allLinks.slice(0, count),
        partNumber: partNumber,
        supplier: supplier,
        searchEngine: engine,
        createGroup: createGroup,
        openSidebar: openSidebar
      }, () => {
        if (shouldCloseOnFinish) chrome.tabs.remove(tabId).catch(() => {});
        window.close();
        resolve();
      });
    } else {
      showStatus('未能发现有效结果，请手动检查', 'error');
      document.getElementById('confirmBtn').disabled = false;
      resolve();
    }
  });
}

// 构建 URL（Bing 不用 count 参数，翻页用 first 控制）
function buildSearchUrl(engine, query) {
  const q = encodeURIComponent(query);
  if (engine === 'google') return `https://www.google.com/search?q=${q}&num=10`;
  return `https://www.bing.com/search?q=${q}`;
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
