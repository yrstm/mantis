"use strict";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:\/\//.test(tab.url || "")) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["mantis.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["extension/capture.js"]
    });
  } catch (error) {
    console.warn("Mantis capture failed:", error && error.message ? error.message : error);
  }
});
