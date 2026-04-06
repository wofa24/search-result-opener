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

// 覆盖common.js中的extractSearchResults函数 (优化：支持多页翻页抓取，突破10条限制)
extractSearchResults = async function(count) {
  const results = [];
  const seen = new Set();

  const extractFromPage = () => {
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
      let url = anchor.href;
      // 过滤Bing内部链接（保留真实结果）
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
  };

  // 先滚动到底部触发懒加载
  window.scrollTo(0, document.body.scrollHeight / 2);
  await new Promise(r => setTimeout(r, 300));
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise(r => setTimeout(r, 500));

  extractFromPage();

  // 如果结果不够，翻页继续抓取
  let attempts = 0;
  while (results.length < count && attempts < 8) {
    const lastCount = results.length;
    const nextBtn = document.querySelector('a.sb_pagN') ||
                    document.querySelector('a[title="Next page"]') ||
                    document.querySelector('a[aria-label="Next page"]') ||
                    document.querySelector('.b_widgetList .sb_pagN_bp');

    if (nextBtn && nextBtn.href) {
      window.location.href = nextBtn.href;
      await new Promise(r => setTimeout(r, 2500));
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      extractFromPage();
      attempts++;
    } else {
      // 没有下一页按钮，退出
      break;
    }

    if (results.length === lastCount) break; // 没有新结果，退出
  }

  return results.slice(0, count);
};

console.log('Bing content script loaded');
