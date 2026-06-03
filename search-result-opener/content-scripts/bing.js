// Bing 搜索 content-script
// 负责：获取搜索关键词（用于自动填充popup）+ 提取搜索结果（用于快捷键功能）

// 获取搜索关键词
getSearchQuery = function () {
  const selectors = ["#sb_form_q", 'input[name="q"]', "#search_box input"];
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input && input.value) return input.value;
  }
  return new URLSearchParams(window.location.search).get("q") || "";
};

// 提取 Bing 搜索结果链接
extractSearchLinks = function (count) {
  const links = [];
  const items = Array.from(
    document.querySelectorAll("#b_results .b_algo, .b_algo"),
  );
  for (const item of items) {
    const anchor = item.querySelector("h2 a, h3 a, a[href]");
    if (!anchor || !anchor.href) continue;
    const url = anchor.href;
    if (!url.startsWith("http")) continue;
    // 跳过图片 URL
    try {
      var pn = new URL(url).pathname.toLowerCase();
      if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|$)/i.test(pn)) continue;
    } catch (e) {}
    if (
      url.includes("googleusercontent.com") ||
      url.includes("encrypted-tbn0.gstatic.com")
    )
      continue;
    if (url.includes("bing.com/th?id=")) continue;
    if (
      url.includes("bing.com/search") ||
      url.includes("bing.com/aclick") ||
      url.includes("microsoft.com")
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

console.log("Bing content script loaded");
