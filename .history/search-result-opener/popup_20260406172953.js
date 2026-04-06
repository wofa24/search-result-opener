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

// 等待标签页加载完成
function waitTabReady(id, timeout = 20000) {
  return new Promise(res => {
    const startTime = Date.now();
    const check = async () => {
      if (Date.now() - startTime > timeout) return res(null);
      try {
        const t = await chrome.tabs.get(id);
        if (t.status === 'complete') res(t);
        else setTimeout(check, 300);
      } catch(e) { res(null); }
    };
    check();
  });
}

// 向指定标签页发送提取消息，带重试
function extractFromTab(tabId, pageCount) {
  return new Promise((res) => {
    let retries = 0;
    const tryExtract = () => {
      chrome.tabs.sendMessage(tabId, { action: 'extractLinks', count: pageCount, filterAds: true }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (retries < 12) {
            retries++;
            setTimeout(tryExtract, 500);
          } else {
            res([]);
          }
        } else {
          res(response.links || []);
        }
      });
    };
    tryExtract();
  });
}

// 构建翻页URL
function buildPageUrl(baseUrl, engine, page) {
  const url = new URL(baseUrl);
  if (engine === 'bing') {
    // Bing: first=1, first=11, first=21 ...
    url.searchParams.set('first', page === 1 ? '1' : String((page - 1) * 10 + 1));
  } else {
    // Google: start=0, start=10, start=20 ...
    url.searchParams.set('start', page === 1 ? '0' : String((page - 1) * 10));
  }
  return url.toString();
}

// 核心功能：多页提取（在 popup.js 中控制翻页，不依赖 content-script 跨页状态）
// searchUrl: 干净的搜索URL（无会话参数），用于构建翻页URL
// engine: 搜索引擎名称
async function waitForTabAndAutomate(tabId, partNumber, supplier, count, createGroup, openSidebar, shouldCloseOnFinish = false, searchUrl = '', engine = 'bing') {
  return new Promise(async (resolve) => {
    const currentTab = await waitTabReady(tabId);
    if (!currentTab) {
      showStatus('搜索页面加载超时', 'error');
      document.getElementById('confirmBtn').disabled = false;
      return resolve();
    }

    // 使用传入的干净 searchUrl 作为翻页基础（避免用 currentTab.url 中的会话参数干扰翻页）
    const baseUrl = searchUrl || currentTab.url;
    const allLinks = [];
    const seenUrls = new Set();
    let page = 1;
    const maxPages = 5; // 最多翻5页

    showStatus(`正在提取第 ${page} 页...`, 'info');

    while (allLinks.length < count && page <= maxPages) {
      // 第一页直接用已加载的tab，后续翻页导航到新URL
      if (page > 1) {
        const pageUrl = buildPageUrl(baseUrl, engine, page);
        await chrome.tabs.update(tabId, { url: pageUrl });
        await new Promise(r => setTimeout(r, 600)); // 等待导航开始
        const ready = await waitTabReady(tabId, 20000);
        if (!ready) break;
        showStatus(`正在提取第 ${page} 页（已有 ${allLinks.length} 条）...`, 'info');
      }

      // 每页尝试提取尽量多的结果（每页最多50条）
      const pageLinks = await extractFromTab(tabId, 50);

      // 去重合并
      let added = 0;
      for (const link of pageLinks) {
        const url = typeof link === 'string' ? link : link.url;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          allLinks.push(link);
          added++;
          if (allLinks.length >= count) break;
        }
      }

      // 页面没有可用结果时停止（但若是第一页就没有才真的退出）
      if (pageLinks.length === 0) break;

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
