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

// 覆盖common.js中的extractSearchResults函数（单页提取，翻页由 popup.js 控制）
extractSearchResults = async function(count) {
  const results = [];
  const seen = new Set();

  // 滚动触发懒加载
  window.scrollTo(0, document.body.scrollHeight / 2);
  await new Promise(r => setTimeout(r, 300));
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(r => setTimeout(r, 500));

  // Google 搜索结果选择器（兼容新旧版结构）
  const itemSelectors = ['#rso .g', '#search .g', '.g'];
  for (const selector of itemSelectors) {
    const items = document.querySelectorAll(selector);
    if (items.length > 0) {
      for (const item of items) {
        if (results.length >= count) break;
        // 跳过嵌套的 .g 元素（避免重复）
        if (item.closest('.g') !== item) continue;

        const anchor = item.querySelector('a[href]');
        const titleEl = item.querySelector('h3');
        if (!anchor || !titleEl) continue;
        const url = anchor.href;

        // 过滤Google内部链接
        if (!url || !url.startsWith('http')) continue;
        if (url.includes('google.com/search') ||
            url.includes('google.com/aclk') ||
            url.includes('googleadservices.com') ||
            url.includes('google.com/url?')) continue;

        if (!seen.has(url)) {
          seen.add(url);
          const title = titleEl.textContent.trim();
          if (title.length > 2) {
            results.push({
              url: url,
              title: title,
              favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
            });
          }
        }
      }
      break;
    }
  }

  return results.slice(0, count);
};

console.log('Google content script loaded');
