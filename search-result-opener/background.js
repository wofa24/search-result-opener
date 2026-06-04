chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openLinks") {
    openLinksDirectly(
      request.links,
      request.partNumber,
      request.supplier,
      request.searchEngine,
      request.createGroup,
      request.openSidebar,
    )
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("Error opening links:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (request.action === "switchToTab") {
    chrome.tabs.update(request.tabId, { active: true }, (tab) => {
      if (tab) {
        chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  } else if (request.action === "quickOpenFromContent") {
    // 来自 content script 的快捷键触发：直接打开已提取的链接
    const { links, partNumber, searchEngine, createGroup, openSidebar } =
      request;
    openLinksDirectly(
      links,
      partNumber,
      "",
      searchEngine,
      createGroup !== false,
      openSidebar !== false,
    )
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (request.action === "downloadImage") {
    // 图片捕捉器下载请求
    chrome.downloads.download(
      {
        url: request.url,
        filename: request.filename,
        saveAs: true,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      },
    );
    return true;
  } else if (request.action === "captureViewport") {
    // 后台截屏：由永远在线的 Service Worker 调用高权限 API
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl: dataUrl });
      }
    });
    return true;
  }
});

// 监听快捷键命令（多页提取模式，与 popup 点击确认打开逻辑一致）
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "quick-open-results") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;

    const url = tab.url || "";
    const isBing = url.includes("bing.com/search");
    const isGoogle = url.includes("google.com/search");
    if (!isBing && !isGoogle) return;

    // 读取用户设置
    const data = await chrome.storage.local.get(["quickOpenCount"]);
    const count = data.quickOpenCount || 10;
    const createGroup = true;
    const openSidebar = true;
    const engine = isBing ? "bing" : "google";

    // 从当前 URL 解析搜索词（与 popup.js parsePartAndSupplier 逻辑一致）：
    // - 恰好 2 个词 → 第1个=料号
    // - 3+ 个词且最后一个词含中文字符 → 最后一个词=供应商，前面=料号
    // - 其余 → 整体作为料号
    let partNumber = "搜索结果";
    try {
      const urlObj = new URL(url);
      const q = urlObj.searchParams.get("q") || "";
      if (q.trim()) {
        const words = q.trim().split(/\s+/).filter(Boolean);
        if (words.length === 2) {
          partNumber = words[0];
        } else if (words.length >= 3) {
          const lastWord = words[words.length - 1];
          const hasCJK = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/.test(lastWord);
          partNumber = hasCJK ? words.slice(0, -1).join(" ") : q.trim();
        } else {
          partNumber = q.trim();
        }
      }
    } catch (e) {
      partNumber = "搜索结果";
    }

    // 在当前标签页直接进行多页提取
    await quickMultiPageExtract(
      tab.id,
      url,
      engine,
      count,
      partNumber,
      createGroup,
      openSidebar,
    );
  }
});

// 构建翻页 URL（与 popup.js 保持一致）
function buildPageUrl(baseUrl, engine, page) {
  try {
    const originUrl = new URL(baseUrl);
    if (engine === "bing") {
      const q = originUrl.searchParams.get("q") || "";
      const newUrl = new URL("https://www.bing.com/search");
      newUrl.searchParams.set("q", q);
      if (page > 1)
        newUrl.searchParams.set("first", String((page - 1) * 10 + 1));
      return newUrl.toString();
    } else {
      const q = originUrl.searchParams.get("q") || "";
      const newUrl = new URL("https://www.google.com/search");
      newUrl.searchParams.set("q", q);
      newUrl.searchParams.set("num", "10");
      if (page > 1) newUrl.searchParams.set("start", String((page - 1) * 10));
      return newUrl.toString();
    }
  } catch (e) {
    return baseUrl;
  }
}

// 等待标签页加载完成
function waitTabReadyBg(id, timeout = 20000, extraDelay = 800) {
  return new Promise((res) => {
    const startTime = Date.now();
    const check = async () => {
      if (Date.now() - startTime > timeout) return res(null);
      try {
        const t = await chrome.tabs.get(id);
        if (t.status === "complete") {
          setTimeout(() => res(t), extraDelay);
        } else {
          setTimeout(check, 300);
        }
      } catch (e) {
        res(null);
      }
    };
    check();
  });
}

// 从标签页直接提取搜索结果（executeScript 注入）
async function extractFromTabBg(tabId, engine) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (eng) => {
        const links = [];
        let items = [];
        if (eng === "bing") {
          items = Array.from(
            document.querySelectorAll("#b_results .b_algo, .b_algo"),
          );
        } else {
          const candidates = document.querySelectorAll(
            "#rso .g, #search .g, .g",
          );
          candidates.forEach((el) => {
            if (el.closest(".g") === el) items.push(el);
          });
        }
        for (const item of items) {
          const anchor = item.querySelector("h2 a, h3 a");
          if (!anchor || !anchor.href) continue;
          const url = anchor.href;
          if (!url.startsWith("http")) continue;
          if (
            url.includes("bing.com/search") ||
            url.includes("bing.com/aclick") ||
            url.includes("google.com/search") ||
            url.includes("google.com/aclk") ||
            url.includes("microsoft.com") ||
            url.includes("googleadservices.com")
          )
            continue;
          const titleEl = item.querySelector("h2, h3") || anchor;
          const title = titleEl.textContent.trim();
          if (title.length < 2) continue;
          links.push({
            url,
            title,
            favIconUrl: `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`,
          });
        }
        return links;
      },
      args: [engine],
    });
    return results[0].result || [];
  } catch (e) {
    console.error("extractFromTabBg error:", e);
    return [];
  }
}

// 快捷键多页提取主函数
async function quickMultiPageExtract(
  tabId,
  baseUrl,
  engine,
  count,
  partNumber,
  createGroup,
  openSidebar,
) {
  try {
    const allLinks = [];
    let page = 1;
    const maxPages = 5;

    // 确保第一页加载完成
    await waitTabReadyBg(tabId, 20000, 500);

    while (allLinks.length < count && page <= maxPages) {
      if (page > 1) {
        const pageUrl = buildPageUrl(baseUrl, engine, page);
        await chrome.tabs.update(tabId, { url: pageUrl });
        await new Promise((r) => setTimeout(r, 600));
        const ready = await waitTabReadyBg(tabId, 20000);
        if (!ready) break;
      }
      const pageLinks = await extractFromTabBg(tabId, engine);
      if (pageLinks.length === 0) break;
      for (const link of pageLinks) {
        allLinks.push(link);
        if (allLinks.length >= count) break;
      }
      page++;
    }

    if (allLinks.length > 0) {
      await openLinksDirectly(
        allLinks.slice(0, count),
        partNumber,
        "",
        engine,
        createGroup,
        openSidebar,
      );
    }
  } catch (e) {
    console.error("quickMultiPageExtract error:", e);
  }
}

// 直接批量打开链接并进行标签页群组化
async function openLinksDirectly(
  links,
  partNumber,
  supplier,
  searchEngine,
  createGroup,
  openSidebar,
) {
  try {
    if (!Array.isArray(links)) throw new Error("无效的结果列表");

    const urls = links.map((l) => (typeof l === "string" ? l : l.url));
    const resultTabs = [];
    let groupId = null;

    for (let i = 0; i < urls.length; i++) {
      const tab = await chrome.tabs.create({ url: urls[i], active: false });
      resultTabs.push(tab);

      if (createGroup && typeof chrome.tabGroups !== "undefined") {
        if (i === 0) {
          groupId = await chrome.tabs.group({ tabIds: tab.id });
          await chrome.tabGroups.update(groupId, {
            title: partNumber || "搜索结果",
            color: "blue",
            collapsed: false,
          });
        } else {
          await chrome.tabs.group({ groupId, tabIds: tab.id });
        }
      }
    }

    // 统一保存组信息（支持多个群组并存）
    const currentGroupData = {
      groupId: groupId,
      partNumber: partNumber,
      supplier: supplier,
      searchEngine: searchEngine,
      tabIds: resultTabs.map((t) => t.id),
      pinnedTabIds: [],
      timestamp: Date.now(),
    };

    // 追加到群组列表，而非覆盖，使侧边栏能在多群组间正确切换
    const stored = await chrome.storage.local.get("tabGroups");
    const tabGroups = stored.tabGroups || [];
    // 如果已有相同 groupId 的群组，先移除（更新场景）
    const existIdx = tabGroups.findIndex((g) => g.groupId === groupId);
    if (existIdx !== -1) tabGroups.splice(existIdx, 1);
    tabGroups.push(currentGroupData);
    // 保留最近 10 个群组，避免数据膨胀
    const trimmed = tabGroups.length > 10 ? tabGroups.slice(-10) : tabGroups;
    await chrome.storage.local.set({
      tabGroups: trimmed,
      currentGroup: currentGroupData,
    });

    if (resultTabs.length > 0) {
      await chrome.tabs.update(resultTabs[0].id, { active: true });
    }

    if (openSidebar && typeof chrome.sidePanel !== "undefined") {
      const activeTab =
        resultTabs[0] ||
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (activeTab)
        await chrome.sidePanel.open({ windowId: activeTab.windowId });
    }

    return true;
  } catch (error) {
    console.error("Error in openLinksDirectly:", error);
    throw error;
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const data = await chrome.storage.local.get(["currentGroup", "tabGroups"]);

    // 更新 currentGroup（当前活跃群组）
    if (data.currentGroup && data.currentGroup.tabIds) {
      const updatedTabIds = data.currentGroup.tabIds.filter(
        (id) => id !== tabId,
      );
      if (updatedTabIds.length > 0) {
        data.currentGroup.tabIds = updatedTabIds;
        await chrome.storage.local.set({ currentGroup: data.currentGroup });
      } else {
        await chrome.storage.local.remove("currentGroup");
      }
    }

    // 同步更新 tabGroups 数组中对应的群组
    if (data.tabGroups && data.tabGroups.length > 0) {
      let changed = false;
      const updatedGroups = data.tabGroups
        .map((g) => {
          if (g.tabIds && g.tabIds.includes(tabId)) {
            changed = true;
            const filtered = g.tabIds.filter((id) => id !== tabId);
            if (filtered.length === 0) return null; // 移除空群组
            return { ...g, tabIds: filtered };
          }
          return g;
        })
        .filter(Boolean);
      if (changed) {
        await chrome.storage.local.set({ tabGroups: updatedGroups });
      }
    }
  } catch (error) {
    console.error("Error updating tab list:", error);
  }
});
