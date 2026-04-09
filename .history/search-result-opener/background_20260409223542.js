chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openLinks') {
    openLinksDirectly(request.links, request.partNumber, request.supplier, request.searchEngine, request.createGroup, request.openSidebar)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error opening links:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; 
  } else if (request.action === 'switchToTab') {
    chrome.tabs.update(request.tabId, { active: true }, (tab) => {
      if (tab) {
        chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  } else if (request.action === 'quickOpenFromContent') {
    // 来自 content script 的快捷键触发：直接打开已提取的链接
    const { links, partNumber, searchEngine, createGroup, openSidebar } = request;
    openLinksDirectly(links, partNumber, '', searchEngine, createGroup !== false, openSidebar !== false)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'quick-open-results') {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const url = tab.url || '';
    const isSearchPage = url.includes('bing.com/search') || url.includes('google.com/search');
    if (!isSearchPage) return;

    // 读取用户设置
    const data = await chrome.storage.local.get(['quickOpenCount', 'quickCreateGroup', 'quickOpenSidebar']);
    const count = data.quickOpenCount || 10;
    const createGroup = data.quickCreateGroup !== false;
    const openSidebar = data.quickOpenSidebar !== false;

    // 向 content script 发消息触发提取
    chrome.tabs.sendMessage(tab.id, { action: 'quickExtractAndOpen', count, createGroup, openSidebar }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('quickOpen error:', chrome.runtime.lastError.message);
      }
    });
  }
});

// 直接批量打开链接并进行标签页群组化
async function openLinksDirectly(links, partNumber, supplier, searchEngine, createGroup, openSidebar) {
  try {
    if (!Array.isArray(links)) throw new Error('无效的结果列表');

    const urls = links.map(l => typeof l === 'string' ? l : l.url);
    const resultTabs = [];
    let groupId = null;

    for (let i = 0; i < urls.length; i++) {
        const tab = await chrome.tabs.create({ url: urls[i], active: false });
        resultTabs.push(tab);

        if (createGroup && typeof chrome.tabGroups !== 'undefined') {
            if (i === 0) {
                groupId = await chrome.tabs.group({ tabIds: tab.id });
                await chrome.tabGroups.update(groupId, { title: partNumber || '搜索结果', color: 'blue', collapsed: false });
            } else {
                await chrome.tabs.group({ groupId, tabIds: tab.id });
            }
        }
    }
    
    // 统一保存组信息
    const currentGroupData = {
      groupId: groupId,
      partNumber: partNumber,
      supplier: supplier,
      searchEngine: searchEngine,
      tabIds: resultTabs.map(t => t.id),
      timestamp: Date.now()
    };
    
    await chrome.storage.local.set({ currentGroup: currentGroupData });
    
    if (resultTabs.length > 0) {
        await chrome.tabs.update(resultTabs[0].id, { active: true });
    }

    if (openSidebar && typeof chrome.sidePanel !== 'undefined') {
      const activeTab = resultTabs[0] || (await chrome.tabs.query({active: true, currentWindow: true}))[0];
      if (activeTab) await chrome.sidePanel.open({ windowId: activeTab.windowId });
    }
    
    return true;
  } catch (error) {
    console.error('Error in openLinksDirectly:', error);
    throw error;
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const data = await chrome.storage.local.get('currentGroup');
    if (data.currentGroup && data.currentGroup.tabIds) {
      const updatedTabIds = data.currentGroup.tabIds.filter(id => id !== tabId);
      if (updatedTabIds.length > 0) {
        data.currentGroup.tabIds = updatedTabIds;
        await chrome.storage.local.set({ currentGroup: data.currentGroup });
      } else {
        await chrome.storage.local.remove('currentGroup');
      }
    }
  } catch (error) {
    console.error('Error updating tab list:', error);
  }
});
