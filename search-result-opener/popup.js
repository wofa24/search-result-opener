// 从搜索词解析料号和供应商：
// - 恰好 2 个词 → 第1个=料号，第2个=供应商
// - 3+ 个词且最后一个词含中文(CJK)字符 → 最后一个词=供应商，前面=料号（如 "cer 001 100 三菱"）
// - 其余情况（1 个词 或 3+ 个纯英文/数字词）→ 整体作为料号
function parsePartAndSupplier(query) {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 2) {
    return { partNumber: words[0], supplier: words[1] };
  }
  if (words.length >= 3) {
    const lastWord = words[words.length - 1];
    // 检测最后一个词是否包含中文/日文/韩文字符
    const hasCJK = /[一-鿿㐀-䶿぀-ゟ゠-ヿ가-힯]/.test(lastWord);
    if (hasCJK) {
      return { partNumber: words.slice(0, -1).join(" "), supplier: lastWord };
    }
  }
  return { partNumber: trimmed, supplier: "" };
}

// 页面加载时初始化
document.addEventListener("DOMContentLoaded", async () => {
  await loadSearchInfo();
  await loadHistory();
  checkFeatureAvailability();
  await loadQuickOpenCount();
  await loadCurrentShortcut();
  setupEventListeners();
});

// 检测功能可用性（createGroup 始终为 true，无需 UI 控制）
function checkFeatureAvailability() {
  // 保留函数以兼容调用，无实际逻辑
}

// 加载当前快捷键显示
async function loadCurrentShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "quick-open-results");
    const el = document.getElementById("currentShortcut");
    if (el) {
      if (cmd && cmd.shortcut) {
        el.textContent = cmd.shortcut.replace(/\+/g, " + ");
        el.className = "shortcut-key-display set";
      } else {
        el.textContent = "未设置";
        el.className = "shortcut-key-display unset";
      }
    }
  } catch (e) {
    const el = document.getElementById("currentShortcut");
    if (el) el.textContent = "读取失败";
  }
}

// 加载搜索信息
async function loadSearchInfo() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab && tab.url && isSearchPage(tab.url)) {
      // 优先从 URL 的 ?q= 参数直接提取，最可靠
      let filled = false;
      try {
        const urlObj = new URL(tab.url);
        const q = urlObj.searchParams.get("q");
        if (q && q.trim()) {
          const { partNumber, supplier } = parsePartAndSupplier(q);
          document.getElementById("partNumber").value = partNumber;
          document.getElementById("supplier").value = supplier;
          filled = true;
        }
      } catch (e) {}

      // 如果 URL 没有 q 参数，尝试从 content script 读取搜索框当前内容
      if (!filled) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        chrome.tabs.sendMessage(
          tab.id,
          { action: "getSearchQuery" },
          (response) => {
            if (chrome.runtime.lastError) return;
            if (response && response.query) {
              const { partNumber, supplier } = parsePartAndSupplier(
                response.query,
              );
              document.getElementById("partNumber").value = partNumber;
              document.getElementById("supplier").value = supplier;
            }
          },
        );
      }
    }
    showStatus("", "info");
  } catch (error) {
    console.error("Error loading search info:", error);
  }
}

// 检查是否是搜索页面
function isSearchPage(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return (
      host.includes("bing.com") ||
      host.includes("google.com") ||
      host.includes("google.com.hk")
    );
  } catch (e) {
    return false;
  }
}

// 设置事件监听器
function setupEventListeners() {
  const customCountInput = document.getElementById("customCount");
  document.querySelectorAll('input[name="count"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      customCountInput.disabled = e.target.value !== "custom";
    });
  });

  document
    .getElementById("confirmBtn")
    .addEventListener("click", handleConfirm);

  // 快捷键打开数量变更时自动保存（input + change 双重保证）
  const quickOpenCountEl = document.getElementById("quickOpenCount");
  if (quickOpenCountEl) {
    const saveQuickOpenCount = () => {
      const val = parseInt(quickOpenCountEl.value);
      if (!isNaN(val) && val >= 1 && val <= 50) {
        chrome.storage.local.set({ quickOpenCount: val });
      }
    };
    quickOpenCountEl.addEventListener("input", saveQuickOpenCount);
    quickOpenCountEl.addEventListener("change", saveQuickOpenCount);
  }

  // 前往 Chrome 快捷键设置
  const shortcutsBtn = document.getElementById("openShortcutsBtn");
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    });
  }
}

// 加载快捷键打开数量设置
async function loadQuickOpenCount() {
  const data = await chrome.storage.local.get("quickOpenCount");
  const el = document.getElementById("quickOpenCount");
  if (el) el.value = data.quickOpenCount || 10;
}

// 获取选中的数量
function getSelectedCount() {
  const selectedRadio = document.querySelector('input[name="count"]:checked');
  if (selectedRadio && selectedRadio.value === "custom") {
    return parseInt(document.getElementById("customCount").value) || 15;
  }
  return selectedRadio ? parseInt(selectedRadio.value) : 10;
}

// 处理确认按钮点击
async function handleConfirm() {
  const partNumber = document.getElementById("partNumber").value.trim();
  const supplier = document.getElementById("supplier").value.trim();

  if (!partNumber) {
    showStatus("请输入料号", "error");
    return;
  }

  const count = getSelectedCount();
  // 创建标签页组始终开启
  const createGroup = true;
  // 侧边栏始终自动打开
  const openSidebar = true;

  saveHistory(partNumber, supplier);

  const btn = document.getElementById("confirmBtn");
  btn.disabled = true;

  try {
    const searchQuery = buildSearchQuery(partNumber, supplier);
    const searchEngine = document.getElementById("searchEngine").value;
    const searchUrl = buildSearchUrl(searchEngine, searchQuery);

    showStatus("正在发起搜索...", "info");

    const [currentTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    let automateTab;
    let shouldClose = false;

    // 优先复用当前标签页导航到搜索URL，避免新建active标签页导致popup失焦关闭
    // 这样点击一次"确认打开"即可完成 搜索→提取→批量打开 的完整流程
    try {
      automateTab = await chrome.tabs.update(currentTab.id, { url: searchUrl });
      shouldClose = false;
    } catch (e) {
      // 当前标签页无法导航（如chrome://特权页面），新建后台标签页
      automateTab = await chrome.tabs.create({ url: searchUrl, active: false });
      shouldClose = false;
    }

    await waitForTabAndAutomate(
      automateTab.id,
      partNumber,
      supplier,
      count,
      createGroup,
      openSidebar,
      shouldClose,
      searchUrl,
      searchEngine,
    );
  } catch (error) {
    showStatus("发生错误: " + error.message, "error");
    btn.disabled = false;
  }
}

// 等待标签页加载完成
function waitTabReady(id, timeout = 20000, extraDelay = 800) {
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

// 构建翻页URL
function buildPageUrl(baseUrl, engine, page) {
  const originUrl = new URL(baseUrl);
  if (engine === "bing") {
    const q = originUrl.searchParams.get("q") || "";
    const newUrl = new URL("https://www.bing.com/search");
    newUrl.searchParams.set("q", q);
    if (page > 1) newUrl.searchParams.set("first", String((page - 1) * 10 + 1));
    return newUrl.toString();
  } else {
    const q = originUrl.searchParams.get("q") || "";
    const newUrl = new URL("https://www.google.com/search");
    newUrl.searchParams.set("q", q);
    newUrl.searchParams.set("num", "10");
    if (page > 1) newUrl.searchParams.set("start", String((page - 1) * 10));
    return newUrl.toString();
  }
}

// 用 executeScript 直接注入提取代码
async function extractFromTabDirect(tabId, engine) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
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
          const anchor = item.querySelector("h2 a, h3 a, a[href]");
          if (!anchor || !anchor.href) continue;
          const url = anchor.href;
          if (!url.startsWith("http")) continue;
          // 跳过图片 URL
          try { var pn = new URL(url).pathname.toLowerCase(); if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?|$)/i.test(pn)) continue; } catch(e) {}
          if (url.includes("googleusercontent.com") || url.includes("encrypted-tbn0.gstatic.com")) continue;
          if (url.includes("bing.com/th?id=")) continue;
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
    console.error("executeScript error:", e);
    return [];
  }
}

// 核心功能：多页提取
async function waitForTabAndAutomate(
  tabId,
  partNumber,
  supplier,
  count,
  createGroup,
  openSidebar,
  shouldCloseOnFinish = false,
  searchUrl = "",
  engine = "bing",
) {
  return new Promise(async (resolve) => {
    const currentTab = await waitTabReady(tabId);
    if (!currentTab) {
      showStatus("搜索页面加载超时", "error");
      document.getElementById("confirmBtn").disabled = false;
      return resolve();
    }

    const baseUrl = searchUrl || currentTab.url;
    const allLinks = [];
    let page = 1;
    const maxPages = 5;

    showStatus(`正在提取第 ${page} 页...`, "info");

    while (allLinks.length < count && page <= maxPages) {
      if (page > 1) {
        const pageUrl = buildPageUrl(baseUrl, engine, page);
        await chrome.tabs.update(tabId, { url: pageUrl });
        await new Promise((r) => setTimeout(r, 600));
        const ready = await waitTabReady(tabId, 20000);
        if (!ready) break;
        showStatus(
          `正在提取第 ${page} 页（已有 ${allLinks.length} 条）...`,
          "info",
        );
      }
      const pageLinks = await extractFromTabDirect(tabId, engine);
      if (pageLinks.length === 0) break;
      for (const link of pageLinks) {
        allLinks.push(link);
        if (allLinks.length >= count) break;
      }
      page++;
    }

    if (allLinks.length > 0) {
      showStatus(`成功提取 ${allLinks.length} 条结果`, "success");
      chrome.runtime.sendMessage(
        {
          action: "openLinks",
          links: allLinks.slice(0, count),
          partNumber,
          supplier,
          searchEngine: engine,
          createGroup,
          openSidebar,
        },
        () => {
          if (shouldCloseOnFinish) chrome.tabs.remove(tabId).catch(() => {});
          window.close();
          resolve();
        },
      );
    } else {
      showStatus("未能发现有效结果，请手动检查", "error");
      document.getElementById("confirmBtn").disabled = false;
      resolve();
    }
  });
}

// 构建 URL
function buildSearchUrl(engine, query) {
  const q = encodeURIComponent(query);
  if (engine === "google") return `https://www.google.com/search?q=${q}&num=10`;
  return `https://www.bing.com/search?q=${q}`;
}

// 构建 Search Query
function buildSearchQuery(p, s) {
  const exact = document.getElementById("exactMatch").checked;
  const f = document.getElementById("fileType").value;
  let q = exact ? `"${p}"` : p;
  if (s) q += ` ${s}`;
  if (f && f !== "none") q += ` ${getFileTypeQuery(f)}`;
  return q.trim();
}

function getFileTypeQuery(t) {
  const m = {
    pdf: "filetype:pdf",
    doc: "(filetype:doc OR filetype:docx)",
    xls: "(filetype:xls OR filetype:xlsx)",
    image: "(filetype:jpg OR filetype:png)",
  };
  return m[t] || "";
}

async function loadHistory() {
  const r = await chrome.storage.local.get(["searchHistory"]);
  const h = r.searchHistory || [];
  const list = document.getElementById("historyList");
  if (h.length === 0) {
    list.innerHTML = '<span class="history-item empty">暂无记录</span>';
    return;
  }
  list.innerHTML = h
    .map(
      (i) =>
        `<span class="history-item" title="${i.partNumber} ${i.supplier}">${i.partNumber}</span>`,
    )
    .join("");
  list.querySelectorAll(".history-item:not(.empty)").forEach((el, idx) => {
    el.addEventListener("click", () => {
      document.getElementById("partNumber").value = h[idx].partNumber;
      document.getElementById("supplier").value = h[idx].supplier;
    });
  });
}

async function saveHistory(p, s) {
  const r = await chrome.storage.local.get(["searchHistory"]);
  let h = r.searchHistory || [];
  h = h.filter((i) => i.partNumber !== p);
  h.unshift({ partNumber: p, supplier: s, time: Date.now() });
  await chrome.storage.local.set({ searchHistory: h.slice(0, 10) });
  loadHistory();
}

function showStatus(m, t = "info") {
  const s = document.getElementById("status");
  if (s) {
    s.textContent = m;
    s.className = "status " + t;
  }
}
