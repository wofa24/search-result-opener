// Google搜索结果提取

// 覆盖common.js中的performSearch函数
performSearch = function(query) {
  try {
    // 尝试多个可能的搜索框选择器
    const selectors = [
      'input[name="q"]',
      'textarea[name="q"]',
      '#APjFqb'
    ];
    
    let searchBox = null;
    for (const selector of selectors) {
      searchBox = document.querySelector(selector);
      if (searchBox) break;
    }
    
    if (searchBox) {
      // 填充搜索框
      searchBox.value = query;
      
      // 尝试提交表单
      const form = searchBox.closest('form');
      if (form) {
        form.submit();
        return true;
      }
      
      // 如果找不到表单，尝试触发搜索按钮
      const searchBtn = document.querySelector('button[type="submit"]') ||
                       document.querySelector('[aria-label="Google 搜索"]') ||
                       document.querySelector('[aria-label="Google Search"]');
      if (searchBtn) {
        searchBtn.click();
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Google search error:', error);
    return false;
  }
};

// 覆盖common.js中的getSearchQuery函数
getSearchQuery = function() {
  // 尝试多个可能的搜索框选择器
  const selectors = [
    'input[name="q"]',
    'textarea[name="q"]',
    '#APjFqb'
  ];
  
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input && input.value) {
      return input.value;
    }
  }
  
  // 如果找不到搜索框，尝试从URL获取
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('q') || '';
};

// 覆盖common.js中的extractSearchResults函数
extractSearchResults = function(count) {
  const results = [];
  
  // Google 搜索结果容器选择器
  const itemSelectors = [
    '#rso .g',
    '.g'
  ];
  
  let items = [];
  for (const selector of itemSelectors) {
    items = document.querySelectorAll(selector);
    if (items.length > 0) break;
  }
  
  // 提取链接、标题和图标
  for (let i = 0; i < items.length && results.length < count; i++) {
    const item = items[i];
    const anchor = item.querySelector('a[href]');
    const titleEl = item.querySelector('h3');
    if (!anchor || !titleEl) continue;

    let url = anchor.href;
    // 基础过滤：确保不是 Google 内部链接
    const isGoogleInternal = 
      url.includes('google.com/search') ||
      url.includes('google.com/url') ||
      url.includes('accounts.google.com');

    if (isGoogleInternal) continue;
    
    if (isValidUrl(url)) {
      results.push({
        url: url,
        title: titleEl.textContent.trim(),
        favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
      });
    }
  }
  
  // 去重
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, count);
};

console.log('Google content script loaded');
