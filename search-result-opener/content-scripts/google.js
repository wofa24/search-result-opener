// Google 搜索 content-script
// 负责：获取搜索关键词（用于自动填充popup）+ 提取搜索结果（用于快捷键功能）

// 获取搜索关键词
getSearchQuery = function () {
  const selectors = ['input[name="q"]', 'textarea[name="q"]', "#APjFqb"];
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input && input.value) return input.value;
  }
  return new URLSearchParams(window.location.search).get("q") || "";
};

// 提取 Google 搜索结果链接
extractSearchLinks = function (count) {
  const links = [];
  const items = [];
  const candidates = document.querySelectorAll("#rso .g, #search .g, .g");
  candidates.forEach((el) => {
    if (el.closest(".g") === el) items.push(el);
  });
  for (const item of items) {
    const anchor = item.querySelector("h2 a, h3 a");
    if (!anchor || !anchor.href) continue;
    const url = anchor.href;
    if (!url.startsWith("http")) continue;
    if (
      url.includes("google.com/search") ||
      url.includes("google.com/aclk") ||
      url.includes("googleadservices.com")
    )
      continue;
    const titleEl = item.querySelector("h2, h3") || anchor;
    const title = titleEl.textContent.trim();
    if (title.length < 2) continue;
    links.push({
      url: url,
      title: title,
      favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`,
    });
    if (links.length >= count) break;
  }
  return links;
};

console.log("Google content script loaded");
