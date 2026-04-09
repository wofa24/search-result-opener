// Google 搜索 content-script
// 负责：获取搜索关键词（用于自动填充popup）

// 获取搜索关键词
getSearchQuery = function() {
  const selectors = ['input[name="q"]', 'textarea[name="q"]', '#APjFqb'];
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input && input.value) return input.value;
  }
  return new URLSearchParams(window.location.search).get('q') || '';
};

console.log('Google content script loaded');
