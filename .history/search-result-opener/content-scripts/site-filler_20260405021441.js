// 站内二次搜索与页面识别逻辑

(function() {
  const CHECK_INTERVAL = 1000;
  const MAX_ATTEMPTS = 3;
  let attempts = 0;

  // 1. 监听来自 background 的搜索指令
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.fAction === 'smartFillAndSearch') {
      const partNumber = request.partNumber;
      if (partNumber) {
        startSmartAction(partNumber);
      }
    }
  });

  // 2. 检查页面是否已经是“目标详情页”
  function isDetailPage(partNumber) {
    const text = document.body.innerText.toLowerCase();
    const hasPart = text.includes(partNumber.toLowerCase());
    
    // 详情页特征：包含技术表格、PDF 下载链接、或特定关键词
    const detailSignals = [
      'specification', 'technical data', 'diagram', 'datasheet', 'catalog',
      '.pdf', 'attributes', 'features'
    ];
    
    const hasSignal = detailSignals.some(s => text.includes(s));
    const hasTable = document.querySelectorAll('table').length > 1;
    
    // 如果页面已经包含零件号且具备详情特征，则判定为已打开
    return hasPart && (hasSignal || hasTable);
  }

  // 3. 执行智能填充与搜索
  function startSmartAction(partNumber) {
    if (isDetailPage(partNumber)) {
      console.log('Detected as detail page, skipping search.');
      updateNavStatus('Success: Detail Found');
      return;
    }

    const timer = setInterval(() => {
      attempts++;
      const searchBox = findSearchBox();
      
      if (searchBox) {
        clearInterval(timer);
        performSearch(searchBox, partNumber);
      } else if (attempts >= MAX_ATTEMPTS) {
        clearInterval(timer);
        console.log('No search box found after attempts.');
        updateNavStatus('Warning: No Search Box');
      }
    }, CHECK_INTERVAL);
  }

  // 4. 定位搜索框 (启发式扫描)
  function findSearchBox() {
    const selectors = [
      'input[type="search"]',
      'input[name="q"]',
      'input[name="s"]',
      'input[name="keyword"]',
      'input[id*="search" i]',
      'input[class*="search" i]',
      '.search-input',
      '#searchBox'
    ];
    
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
    }
    
    // 如果通过选择器找不到，尝试通过 placeholder 模糊匹配
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const ph = (input.placeholder || '').toLowerCase();
      if ((ph.includes('search') || ph.includes('find') || ph.includes('搜索')) && 
          input.offsetWidth > 0) {
        return input;
      }
    }
    return null;
  }

  // 5. 填值并提交
  function performSearch(input, value) {
    input.focus();
    input.value = value;
    
    // 触发 input 事件让前端框架感知变化
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // 尝试提交
    const form = input.closest('form');
    if (form) {
      form.submit();
      updateNavStatus('Searching...');
    } else {
      // 如果没有 form，模拟 Enter 键
      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      });
      input.dispatchEvent(enterEvent);
      updateNavStatus('Searching (Keyboard)...');
    }
  }

  // 6. 更新导航页状态 (通知 background)
  function updateNavStatus(status) {
    chrome.runtime.sendMessage({
      action: 'updateTabStatus',
      status: status,
      url: window.location.href
    });
  }

  console.log('Site filler script loaded');
})();
