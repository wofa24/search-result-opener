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

// 覆盖common.js中的extractSearchResults函数 (优化：支持多页滚动抓取以支持50个结果)
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
      if (url.includes('bing.com') && !url.includes('bing.com/ck/')) continue;
      
      if (isValidUrl(url) && !seen.has(url)) {
        seen.add(url);
        results.push({
          url: url,
          title: anchor.textContent.trim(),
          favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`
        });
      }
    }
  };

  extractFromPage();

  // 如果结果不够，尝试点击“下一页”或滚动加载 (针对 Bing 50个的需求)
  let attempts = 0;
  while (results.length < count && attempts < 5) {
    const nextBtn = document.querySelector('.sb_pagN') || document.querySelector('a[title="下一页"]');
    if (nextBtn) {
      nextBtn.click();
      await new Promise(r => setTimeout(r, 2000)); // 等待翻页加载
      extractFromPage();
      attempts++;
    } else {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 1000));
      extractFromPage();
      attempts++;
      if (items.length === lastLength) break; // 没新内容了
    }
  }

  return results.slice(0, count);
};

console.log('Bing content script loaded');
