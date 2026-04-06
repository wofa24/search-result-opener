// 监听来自popup的消息
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
    return true; // 保持消息通道开放
  } else if (request.action === 'switchToTab') {
    // 切换到指定标签页
    chrome.tabs.update(request.tabId, { active: true }, (tab) => {
      if (tab) {
        chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }
});

// 直接批量打开链接并进行标签页群组化
async function openLinksDirectly(links, partNumber, supplier, searchEngine, createGroup, openSidebar) {
  try {
    if (!Array.isArray(links)) throw new Error('无效的结果列表');

    const urls = links.map(l => typeof l === 'string' ? l : l.url);
    const resultTabs = [];
    let groupId = null;

    // 1. 批量创建标签页
    for (let i = 0; i < urls.length; i++) {
        const tab = await chrome.tabs.create({ url: urls[i], active: false });
        resultTabs.push(tab);

        // 标签页分组
        if (createGroup) {
            if (i === 0) {
                groupId = await chrome.tabs.group({ tabIds: tab.id });
                await chrome.tabGroups.update(groupId, { title: partNumber, color: 'blue', collapsed: false });
            } else {
                await chrome.tabs.group({ groupId, tabIds: tab.id });
            }
        }
        
        // 自动填表逻辑保持异步注入
        (async (id) => {
            await waitForTabLoad(id);
            chrome.tabs.sendMessage(id, { fAction: 'smartFillAndSearch', partNumber }).catch(() => {});
        })(tab.id);
    }
    
    // 2. 保存组信息以便侧边栏读取
    const currentGroupData = {
      groupId: groupId,
      partNumber: partNumber,
      supplier: supplier,
      searchEngine: searchEngine,
      tabIds: resultTabs.map(t => t.id),
      timestamp: Date.now()
    };
    
    await chrome.storage.local.set({ currentGroup: currentGroupData });
    
    // 3. 激活第一个结果页
    if (resultTabs.length > 0) {
        await chrome.tabs.update(resultTabs[0].id, { active: true });
    }

    // 4. 打开侧边栏
    if (openSidebar) {
      const activeTab = resultTabs[0] || (await chrome.tabs.query({active: true, currentWindow: true}))[0];
      if (activeTab) await chrome.sidePanel.open({ windowId: activeTab.windowId });
    }
    
    return true;
  } catch (error) {
    console.error('Error in openLinksDirectly:', error);
    throw error;
  }
}

// 等待标签页加载完成
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkTab = async () => {
      if (Date.now() - startTime > timeout) {
        resolve();
        return;
      }
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) {
          resolve();
          return;
        }
        if (tab.status === 'complete') {
          setTimeout(resolve, 500);
        } else {
          setTimeout(checkTab, 200);
        }
      } catch (e) {
        resolve();
      }
    };
    checkTab();
  });
}

// 监听标签页关闭事件，更新存储的组信息
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
