// 通用功能模块
// 监听来自 popup 的消息（目前仅用于获取搜索关键词自动填充）

// 获取搜索关键词（由 bing.js 或 google.js 覆盖实现）
function getSearchQuery() {
  return '';
}

// 提取当前页搜索结果链接（由 bing.js 或 google.js 覆盖实现）
function extractSearchLinks(count) {
  return [];
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSearchQuery') {
    sendResponse({ query: getSearchQuery() });
    return true;
  }

  if (request.action === 'quickExtractAndOpen') {
    const count = request.count || 10;
    const createGroup = request.createGroup !== false;
    const openSidebar = request.openSidebar !== false;
    try {
      const links = extractSearchLinks(count);
      if (links.length === 0) {
        sendResponse({ success: false, error: '未提取到搜索结果' });
        return true;
      }
      // 获取搜索词作为 partNumber
      const partNumber = getSearchQuery() || '搜索结果';
      // 判断搜索引擎
      const host = window.location.hostname;
      const searchEngine = host.includes('bing.com') ? 'bing' : 'google';

      chrome.runtime.sendMessage({
        action: 'quickOpenFromContent',
        links: links.slice(0, count),
        partNumber: partNumber,
        searchEngine: searchEngine,
        createGroup: createGroup,
        openSidebar: openSidebar
      }, (resp) => {
        sendResponse(resp || { success: true });
      });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});
