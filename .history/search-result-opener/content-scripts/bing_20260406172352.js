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

// 覆盖common.js中的extractSearchResults函数（单页提取，翻页由 popup.js 控制）
extractSearchResults = async function(count) {
  const results = [];
  const seen = new Set();

  // 滚动触发懒加载
  window.scrollTo(0, document.body.scrollHeight / 2);
  await new Promise(r => setTimeout(r, 300));
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(r => setTimeout(r, 500));

  const itemSelectors = ['#b_results .b_algo', '.b_algo'];
  let items = [];
  for (const selector of itemSelectors) {
    items = document.querySelectorAll(selector);
    if (items.length > 0) break;
  }

  for (const item of items) {
    if (results.length >= count) break;
    const anchor = item.querySelector('h2 a') || item.querySelector('a[href]');
    if (!anchor) continue;
    const url = anchor.href;
    if (!url || !url.startsWith('http')) continue;
    if (url.includes('bing.com/search') || url.includes('microsoft.com') || url.includes('bing.com/aclick')) continue;

    if (!seen.has(url)) {
      seen.add(url);
      const titleEl = item.querySelector('h2') || anchor;
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

  return results.slice(0, count);
};

console.log('Bing content script loaded');
