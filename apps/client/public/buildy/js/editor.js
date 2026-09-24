const preview = document.getElementById("preview"), previewContainer = document.getElementById("preview"), modalOverlay = document.getElementById("modal-overlay"); let currentElement = null, currentState = JSON.parse(localStorage.getItem("currentState")) || { blocks: {}, layout: [], sceleton: { config: defaultConfig }, editory: {} }; currentState.blocks && 0 !== Object.keys(currentState.blocks).length || (currentState.blocks = defaultBlocks), currentState.sceleton && currentState.sceleton.config || (currentState.sceleton = currentState.sceleton || {}, currentState.sceleton.config = defaultConfig); let blocks = currentState.blocks; const savedConfig = currentState.sceleton?.config || defaultConfig; function applyBodyClasses() { document.body.className = currentState.sceleton.bodyClasses; } function applyTailwindConfig(config) {
  if (!config) {
      console.warn('No config provided, using default');
      config = defaultConfig;
  }

  let configStr;
  try {
      if (typeof config === 'string') {
          const parsedConfig = JSON.parse(config);
          configStr = JSON.stringify(parsedConfig);
      } else if (typeof config === 'object' && config !== null) {
          configStr = JSON.stringify(config);
      } else {
          console.error('Invalid config format:', typeof config, config);
          configStr = JSON.stringify(defaultConfig);
      }

      let scriptElement = document.querySelector("script[data-tailwind-config]");
      if (scriptElement) {
          scriptElement.textContent = `tailwind.config = ${configStr};`;
      } else {
          scriptElement = document.createElement("script");
          scriptElement.setAttribute("data-tailwind-config", "");
          scriptElement.textContent = `tailwind.config = ${configStr};`;
          document.head.appendChild(scriptElement);
      }
  } catch (error) {
      console.error('Error applying Tailwind config:', error);
      applyTailwindConfig(defaultConfig);
  }
} 

function initializeBlockList() { Object.entries(blocks).forEach(([e, { content: t, title: n }]) => { const r = document.createElement("div"), o = document.createElement("div"); o.className = "relative w-full h-full"; const i = document.createElement("div"), c = document.createElement("div"); c.innerHTML = t || e, i.appendChild(c), o.appendChild(i), r.appendChild(o) }) } function getBlockType(e) { for (const [t, n] of Object.entries(blocks)) { const r = document.createElement("div"); r.innerHTML = n.content.trim(); const o = r.firstElementChild; if (o.id && e.id && o.id === e.id) return t; if (o.outerHTML.trim() === e.outerHTML.trim()) return t } return "unknown" } function saveCurrentState() { currentState.layout = Array.from(preview.children).map((element, index) => {
      const existingBlock = currentState.layout[index] || {};
      
      return {
          type: existingBlock.type || getBlockType(element.firstElementChild),
          content: element.firstElementChild.outerHTML,
          editory: {
              revision: new Date().toISOString()
          }
      };
  });
  
  localStorage.setItem("currentState", JSON.stringify(currentState));
  applyTailwindStyles();
} 

function loadSavedState() {
  const savedState = JSON.parse(localStorage.getItem("currentState"));
  if (savedState) {
      currentState = savedState;
      blocks = currentState.blocks;
      initializeBlockList();

      currentState.layout.forEach(item => {
          if (blocks[item.type]) {
              const wrapper = document.createElement("div");
              wrapper.className = "block-wrapper relative border border-gray-200 dark:border-gray-800";
              wrapper.innerHTML = item.content;
              preview.appendChild(wrapper);
          }
      });

      // Apply both config and styles
      applyTailwindConfig(currentState.sceleton?.config || defaultConfig);
      applyTailwindStyles();
  }
} 
  
applyTailwindConfig(savedConfig);

document.addEventListener("DOMContentLoaded", () => { 
const e = new Quill("#editor-area", { 
  theme: "snow", 
  formats: [], 
  modules: { 
    toolbar: false, 
    keyboard: { 
      bindings: { 
        enter: { 
          key: 13, 
          handler: function () { 
            return !0 
          } 
        } 
      } 
    } 
  } 
});

function t(t) { 
  let n; 
  currentElement = t;
  n = t.nodeType === Node.TEXT_NODE ? t.textContent : t.innerHTML;
  e.setText(n);
  modalOverlay.classList.remove("hidden");
} 

function n() { 
  modalOverlay.classList.add("hidden");
} 

function r(e) { 
  e && e.nodeType !== Node.TEXT_NODE && e.classList.remove("highlight-border");
} 

function o() { 
  document.querySelectorAll(".prose").forEach(function (e) { 
    e.addEventListener("click", function (n) { 
      currentElement = e;
      t(e.innerHTML);
    });
  });
} 

(function (e) { 
  e.addEventListener("mouseover", function (t) { 
    const n = t.target; 
    if (!(n === e || n.nodeType === Node.TEXT_NODE && !n.classList.contains("prose"))) {
      n && n.nodeType !== Node.TEXT_NODE && n.classList.add("highlight-border");
    }
  });

  e.addEventListener("mouseout", function (t) { 
    const n = t.target; 
    if (!(n === e || n.nodeType === Node.TEXT_NODE && !n.classList.contains("prose"))) {
      r(n);
    }
  });
})(previewContainer);

previewContainer.addEventListener("click", function (e) { 
  const n = e.target; 
  if (n !== previewContainer) {
    n.nodeType !== Node.TEXT_NODE && n.classList.contains("prose");
    t(n);
    r(n);
  }
});

document.getElementById("save-edit").addEventListener("click", function () { 
  if (currentElement) { 
    let t = e.getText().trim(); 
    currentElement.nodeType === Node.TEXT_NODE ? 
      currentElement.textContent = t : 
      currentElement.innerHTML = t;
    console.log("Saved content:", 
      currentElement.nodeType === Node.TEXT_NODE ? 
        currentElement.textContent : 
        currentElement.innerHTML
    );
    saveLog(t);
  } 
  saveCurrentState();
  n();
});

e.clipboard.addMatcher(Node.ELEMENT_NODE, function (e, t) { 
  let n = e.textContent || e.innerText; 
  return (new Delta).insert(n);
});

document.getElementById("cancel-edit").addEventListener("click", function () { 
  n();
});

new MutationObserver(function (e) { 
  e.forEach(function (e) { 
    if (e.type === "childList" && e.addedNodes.length > 0) {
      o();
    }
  });
}).observe(previewContainer, { 
  childList: true, 
  subtree: true 
});

o();

window.addEventListener("message", function (e) { 
  if (e.data.type === "init" && e.data.darkMode) {
    document.documentElement.classList.add("dark");
  }
});

if (localStorage.getItem("darkMode") === "true") {
  document.documentElement.classList.add("dark");
}

loadSavedState();
applyBodyClasses();
});

function saveLog(notification) {
  const logs = JSON.parse(localStorage.getItem("editLogs")) || [];
  const newLog = {
      timestamp: new Date().toISOString(),
      notification: notification
  };
  logs.push(newLog);
  localStorage.setItem("editLogs", JSON.stringify(logs));
}