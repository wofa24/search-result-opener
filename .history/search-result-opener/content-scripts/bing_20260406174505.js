// Bing 搜索 content-script
// 负责：获取搜索关键词（用于自动填充popup）

// 获取搜索关键词
getSearchQuery = function() {
  const selectors = ['#sb_form_q', 'input[name="q"]', '#search_box input'];
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input && input.value) return input.value;
  }
  return new URLSearchParams(window.location.search).get('q') || '';
};

console.log('Bing content script loaded');
