// Background extension page - Event page (only runs based on event listeners)
// Console log messages will not be shown (only shown in special console)

async function getCurrentTab() {
  let queryOptions = { active: true, currentWindow: true };
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

function setUpExtensionInstallEvents() {
  if (chrome && chrome.runtime && chrome.runtime.setUninstallURL) {
    // chrome.runtime.setUninstallURL(
    //   "https://find-and-replace-f6588.firebaseapp.com/uninstall"
    // );
  }

  chrome.runtime.onInstalled.addListener((details) => {
    // if (details && details.reason && details.reason == 'install') {
    //   chrome.tabs.create({ url: "help.html" });
    // }
  });
}

function setUpContextMenu() {
  console.info("setUpContextMenu");

  const contextMenuHandlingContentScriptFilepath =
    "src/page-content/context-menu-content-script.js";
  const contextMenuItemId = "find_replace_context_item";

  chrome.contextMenus.create({
    id: contextMenuItemId,
    contexts: ["selection"],
    title: "Find and Replace in Text Selection",
  });

  // Context menu handler
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (!info.selectionText) {
      console.warn("Invalid context menu command.");
      return;
    }
    const selectionText = info.selectionText;
    // Pop-up is closed and cannot be opened - insert content script instead
    console.info("current tab is", await getCurrentTab());

    chrome.scripting.executeScript({
      target: { tabId: (await getCurrentTab()).id },
      files: [contextMenuHandlingContentScriptFilepath],
    });
    // User expects to search in the text selection - update Storage
    const searchStateKey = "search-state"; // fixed ID
    chrome.storage.local.get(searchStateKey, (data) => {
      const isPreviousSaved =
        searchStateKey in data &&
        data[searchStateKey] != null &&
        data[searchStateKey] != undefined;
      const searchState = isPreviousSaved ? data[searchStateKey] : {};
      searchState.advancedSearchExpanded = true;
      searchState.limitToSelectionInput = true;
      chrome.storage.local.set({
        [searchStateKey]: searchState,
      });
    });
  });
}

/**
 * Injects scripts into a web page in a sequence specified by array order
 */
function executeScripts(sources) {
  const executeScriptPromise = (source) =>
    new Promise(async (resolve) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: (await getCurrentTab()).id },
          files: [source],
        },
        resolve
      );
    });
  let promiseSequence = Promise.resolve();
  sources.forEach((source) => {
    promiseSequence = promiseSequence.then(() => executeScriptPromise(source));
  });
}

async function injectContentScripts() {
  // Inject the following sources
  const scripts = [
    "src/page-content/lib/jquery-3.2.1.min.js",
    "src/page-content/lib/jquery.highlight-within-textarea.js",
    "src/page-content/lib/jquery.mark.min.js",
    "src/page-content/content-script.js",
  ];
  chrome.scripting.insertCSS({
    target: { tabId: (await getCurrentTab()).id, allFrames: true },
    files: ["src/page-content/content-script.css"],
  });
  executeScripts(scripts);
}

function sendContentScriptShutdownCmd(contentScriptConnection) {
  const isFirefox = typeof InstallTrigger !== "undefined";

  // (bugfix) Firefox disconnects the port in content script on pop-up close
  if (isFirefox) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "shutdown" });
    });
  } else {
    // Chrome
    if (contentScriptConnection) {
      contentScriptConnection.postMessage({ action: "shutdown" });
    }
  }
}

function setUpMessageConnections() {
  let contentScriptConnection = null;

  chrome.runtime.onConnect.addListener(async (port) => {
    // port.name matches the one defined in the runtime.connect call
    if (port.name == "content-script-connection") {
      contentScriptConnection = port;
      contentScriptConnection.onDisconnect.addListener(() => {
        // Event only fires in Chrome (Firefox bug)
        contentScriptConnection = null;
      });
      return;
    }

    if (port.name == "widget-background-connection") {
      // Widget has been spawn
      // Inject a content script checking if the page has been initialized
      //  (and script triggers port reconnect if it has)
      chrome.scripting.executeScript(
        {
          target: { tabId: (await getCurrentTab()).id },
          files: ["src/page-content/init-content-script.js"],
        },
        ([initialized]) => {
          if (!initialized.result) injectContentScripts();
        }
      );
      // Listen for widget shutdown
      port.onDisconnect.addListener(() => {
        console.log("Widget disconnected");
        // Notify content script to clean up and shut down
        sendContentScriptShutdownCmd(contentScriptConnection);
      });
    }
  });
}

// SET UP
setUpExtensionInstallEvents();
setUpContextMenu();
setUpMessageConnections();

console.log("Background event page just executed.");
