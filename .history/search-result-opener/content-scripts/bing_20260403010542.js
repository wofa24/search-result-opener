// Bing搜索结果提取

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
extractSearchResults = function(count, filterAds) {
  const results = [];
  
  // Bing搜索结果的多个可能选择器
  const selectors = [
    '#b_results .b_algo h2 a',
    '#b_results .b_algo a[href]',
    '.b_algo h2 a'
  ];
  
  let links = [];
  
  // 尝试每个选择器
  for (const selector of selectors) {
    links = document.querySelectorAll(selector);
    if (links.length > 0) {
      break;
    }
  }
  
  // 提取链接
  for (let i = 0; i < links.length && results.length < count; i++) {
    const link = links[i];
    let url = link.href;
    
    // 验证URL
    if (isValidUrl(url, filterAds)) {
      // 确保不是Bing内部链接
      if (!url.includes('bing.com') || url.includes('bing.com/ck/')) {
        results.push(url);
      }
    }
  }
  
  // 去重
  return uniqueUrls(results).slice(0, count);
};

console.log('Bing content script loaded');
