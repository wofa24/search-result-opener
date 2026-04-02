// 通用功能模块

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSearchQuery') {
    const query = getSearchQuery();
    sendResponse({ query: query });
  } else if (request.action === 'extractLinks') {
    const links = extractSearchResults(request.count, request.filterAds);
    sendResponse({ links: links });
  }
  return true;
});

// 获取搜索关键词（由具体的搜索引擎脚本实现）
function getSearchQuery() {
  // 这个函数会被bing.js或google.js覆盖
  return '';
}

// 提取搜索结果（由具体的搜索引擎脚本实现）
function extractSearchResults(count, filterAds) {
  // 这个函数会被bing.js或google.js覆盖
  return [];
}

// 通用的URL过滤函数
function isValidUrl(url, filterAds) {
  if (!url || !url.startsWith('http')) {
    return false;
  }
  
  // 过滤广告链接
  if (filterAds) {
    const adPatterns = [
      '/aclk',
      '/aclick',
      'googleadservices.com',
      'doubleclick.net',
      'bing.com/aclick',
      'bing.com/acli'
    ];
    
    for (const pattern of adPatterns) {
      if (url.includes(pattern)) {
        return false;
      }
    }
  }
  
  return true;
}

// 去重函数
function uniqueUrls(urls) {
  const seen = new Set();
  return urls.filter(url => {
    if (seen.has(url)) {
      return false;
    }
    seen.add(url);
    return true;
  });
}
