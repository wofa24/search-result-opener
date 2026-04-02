// Google搜索结果提取

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
extractSearchResults = function(count, filterAds) {
  const results = [];
  
  // Google搜索结果的多个可能选择器
  const selectors = [
    '#search .g a[href]',
    '#rso .g a[href]',
    '.g a[jsname]'
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
  const seenUrls = new Set();
  
  for (let i = 0; i < links.length && results.length < count; i++) {
    const link = links[i];
    let url = link.href;
    
    // 跳过已经添加的URL
    if (seenUrls.has(url)) {
      continue;
    }
    
    // 验证URL
    if (isValidUrl(url, filterAds)) {
      // 确保不是Google内部链接
      const isGoogleInternal = 
        url.includes('google.com/search') ||
        url.includes('google.com/url') ||
        url.includes('accounts.google.com') ||
        url.includes('support.google.com') ||
        url.includes('webcache.googleusercontent.com');
      
      if (!isGoogleInternal) {
        results.push(url);
        seenUrls.add(url);
      }
    }
  }
  
  // 去重并限制数量
  return uniqueUrls(results).slice(0, count);
};

console.log('Google content script loaded');
