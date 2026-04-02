// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openLinks') {
    openLinksInGroup(request.links, request.partNumber, request.supplier, request.createGroup, request.openSidebar)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error opening links:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  }
});

// 批量打开链接并创建标签页组
async function openLinksInGroup(links, partNumber, supplier, createGroup, openSidebar) {
  try {
    const tabIds = [];
    
    // 按顺序创建标签页（保持搜索引擎排序）
    for (const url of links) {
      const tab = await chrome.tabs.create({ 
        url: url, 
        active: false 
      });
      tabIds.push(tab.id);
      
      // 添加小延迟，避免浏览器卡顿
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    let groupId = -1;
    
    // 创建标签页组
    if (createGroup && tabIds.length > 0) {
      groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: partNumber,
        color: 'blue',
        collapsed: false
      });
    }
    
    // 激活第一个标签页
    if (tabIds.length > 0) {
      await chrome.tabs.update(tabIds[0], { active: true });
    }
    
    // 保存组信息到storage
    await chrome.storage.local.set({
      currentGroup: {
        groupId: groupId,
        partNumber: partNumber,
        supplier: supplier,
        tabIds: tabIds,
        timestamp: Date.now()
      }
    });
    
    // 打开侧边栏
    if (openSidebar && tabIds.length > 0) {
      // 获取当前窗口
      const tab = await chrome.tabs.get(tabIds[0]);
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
    
    return true;
  } catch (error) {
    console.error('Error in openLinksInGroup:', error);
    throw error;
  }
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
        // 所有标签页都关闭了，清除存储
        await chrome.storage.local.remove('currentGroup');
      }
    }
  } catch (error) {
    console.error('Error updating tab list:', error);
  }
});
