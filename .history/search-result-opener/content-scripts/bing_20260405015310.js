// Bing搜索结果提取

// 覆盖common.js中的performSearch函数
performSearch = function(query) {
  try {
    // 尝试多个可能的搜索框选择器
    const selectors = [
      '#sb_form_q',
      'input[name="q"]',
      '#search_box input'
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
      const form = document.querySelector('#sb_form') || searchBox.closest('form');
      if (form) {
        form.submit();
        return true;
      }
      
      // 如果找不到表单，尝试触发搜索按钮
      const searchBtn = document.querySelector('#search_icon') || 
                       document.querySelector('button[type="submit"]');
      if (searchBtn) {
        searchBtn.click();
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Bing search error:', error);
    return false;
  }
};

// 覆盖common.js中的getSearchQuery函数
getSearchQuery = function() {
  // 尝试多个可能的搜索框选择器
  const selectors = [
    '#sb_form_q',
    'input[name="q"]',
    '#search_box input'
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
  
  // Bing搜索结果的容器选择器
  const itemSelectors = [
    '#b_results .b_algo',
    '.b_algo'
  ];
  
  let items = [];
  for (const selector of itemSelectors) {
    items = document.querySelectorAll(selector);
    if (items.length > 0) break;
  }
  
  // 提取链接、标题和图标
  for (let i = 0; i < items.length && results.length < count; i++) {
    const item = items[i];
    const anchor = item.querySelector('h2 a') || item.querySelector('a[href]');
    if (!anchor) continue;

    let url = anchor.href;
    // 基础过滤：确保不是Bing内部链接
    if (url.includes('bing.com') && !url.includes('bing.com/ck/')) continue;
    
    if (isValidUrl(url)) {
      results.push({
        url: url,
        title: anchor.textContent.trim(),
        // 尝试获取站点图标，Bing 通常在引文旁边有图标
        favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
      });
    }
  }
  
  // 去重（基于URL）
  const seen = new Set();
  return results.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, count);
};

console.log('Bing content script loaded');
