// 通用功能模块
// 监听来自 popup 的消息（目前仅用于获取搜索关键词自动填充）

// 获取搜索关键词（由 bing.js 或 google.js 覆盖实现）
function getSearchQuery() {
  return '';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSearchQuery') {
    sendResponse({ query: getSearchQuery() });
  }
  return true;
});
