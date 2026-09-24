class BaseDataSetter {
  constructor() {
    this.fields = [];
  }

  loadSavedState() {
    const storedState = localStorage.getItem("currentState");
    let currentState = {};
    if (storedState && storedState !== "undefined") {
      try {
        currentState = JSON.parse(storedState);
      } catch (error) {
        console.error("Error parsing stored state:", error);
      }
    }
    return currentState;
  }

  getSavedValue(key) {
    const currentState = this.loadSavedState();
    return currentState.sceleton?.[key] || "";
  }
}

class PageSkeleton {
  constructor(config) {
    this.config = config;
  }

  generate() {
    return `
<!DOCTYPE html>
<html lang="en"
      data-color-mode="light"
      data-light-theme="light"
      data-dark-theme="dark">
  <head>
    ${this.getHead()}
  </head>
  <body class="${this.getBodyClasses()}">
    ${this.getContent()}
    ${this.getScripts()}
  </body>
</html>
      `;
  }

  getHead() {
    return `
      ${this.getBeforeHead()}
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${this.config.title}</title>
      <script>
        (function() {
          const theme = localStorage.getItem('darkMode');
          const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
          if (theme === 'true' || (!theme && systemTheme)) {
              document.documentElement.classList.add('dark');
          }
        })();
      </script>
      ${this.getAfterTitle()}
      ${this.getAfterHead()}
      <style>
        :root {
          color-scheme: light dark;
        }
        html.dark {
          color-scheme: dark;
        }
      </style>
    `;
  }

  getTailwindStyles() {
    const currentState = JSON.parse(localStorage.getItem('currentState')) || {};
    const styles = currentState.sceleton?.tailwindStyles || tailwindStylesDefault;
    
    return `<style type="text/tailwindcss">${styles}</style>`;
  }

  getAfterTitle() {
    return `
        <meta name="description" content="Create fasty Landing pages with TailwindCSS. Dark Mode and customizer Config included.">
      `;
  }

  getBeforeHead() {
    return ``;
  }

  getAfterHead() {
    if (this.config.useDevStyles) {
      const configObject = typeof this.config.tailwindConfig === 'string' 
        ? JSON.parse(this.config.tailwindConfig)
        : this.config.tailwindConfig;

      configObject.safelist = [
        {
          pattern: /^dark:/,
        }
      ];

      return `
        <script src="https://cdn.tailwindcss.com"></script>
        <script>
          tailwind.config = ${JSON.stringify(configObject)};
        </script>
        <style>
          :root {
            color-scheme: light dark;
          }
          
          html.dark {
            color-scheme: dark;
          }
        </style>`;
    } else {
      return `<style>${this.config.styles || ''}</style>`;
    }
  }

  getBodyClasses() {
    return this.config.bodyClasses || bodyClassesDefault;
  }

  getContent() {
    return this.config.content;
  }

  getScripts() {
    return `
      <script>
        // Check dark mode preference
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
        
        ${this.getDarkModeToggleScript()}
        ${this.getOffCanvasMenuScript()}
      </script>
    `;
  }

  getDarkModeToggleScript() {
    return `
        // Dark mode toggle
        const darkModeToggl = document.createElement('button');
        darkModeToggl.innerHTML = '🌓';
        darkModeToggl.className = 'fixed bottom-4 left-4 bg-slate-200 dark:bg-slate-700 p-2 rounded-full text-xs focus:outline-none transition duration-300 ease-in-out transform hover:scale-110';
        document.body.appendChild(darkModeToggl);
  
        darkModeToggle.addEventListener('click', () => {
          document.documentElement.classList.toggle('dark');
        });
        
        if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
            
        darkModeToggle.addEventListener('click', () => {
          if (document.documentElement.classList.contains('dark')) {
            localStorage.theme = 'dark';
          } else {
            localStorage.theme = 'light';
          }
        });
      `;
  }

  getOffCanvasMenuScript() {
    return `
        // Off-canvas menu functionality
        const menuToggle = document.getElementById('menuToggle');
        const offCanvasMenu = document.getElementById('offCanvasMenu');
        const closeMenu = document.getElementById('closeMenu');
        const menuContent = offCanvasMenu.querySelector('div:last-child');
  
        function openMenu() {
          offCanvasMenu.classList.remove('hidden');
          setTimeout(() => {
            menuContent.classList.remove('-translate-x-full');
          }, 10);
        }
  
        function closeMenuFunction() {
          menuContent.classList.add('-translate-x-full');
          setTimeout(() => {
            offCanvasMenu.classList.add('hidden');
          }, 300);
        }
  
        menuToggle.addEventListener('click', openMenu);
        closeMenu.addEventListener('click', closeMenuFunction);
        offCanvasMenu.addEventListener('click', (e) => {
          if (e.target === offCanvasMenu) {
            closeMenuFunction();
          }
        });
      `;
  }
}

class UniversalDataSetter extends BaseDataSetter {
  constructor(buttonId, modalId, textareaId, saveButtonId, key) {
    super();
    this.button = document.getElementById(buttonId);
    this.modal = document.getElementById(modalId);
    this.textarea = document.getElementById(textareaId);
    this.saveButton = document.getElementById(saveButtonId);
    this.key = key;

    this.initEventListeners();
  }

  initEventListeners() {
    this.button.addEventListener("click", () => this.openModal());
    this.modal.addEventListener("click", (e) => this.handleModalClick(e));
    this.saveButton.addEventListener("click", () => this.saveData());
  }

  openModal() {
    this.modal.classList.remove("hidden");
  }

  handleModalClick(e) {
    if (e.target === this.modal) {
      this.modal.classList.add("hidden");
    }
  }

  loadSavedState() {
    const storedState = localStorage.getItem("currentState");
    let currentState = {};
    if (storedState && storedState !== "undefined") {
      try {
        currentState = JSON.parse(storedState);
      } catch (error) {
        console.error("Error parsing stored state:", error);
      }
    }
    this.fields.forEach((field) => {
      const element = document.getElementById(field.key);
      if (element) {
        let value = currentState.sceleton?.[field.key];
        
        if (field.type === "checkbox") {
          element.checked = value || false;
        } else {
          // Для конфигурации преобразуем объект в строку
          if (field.key === 'config' && typeof value === 'object') {
            value = JSON.stringify(value, null, 2);
          }
          element.value = value || "";
        }
      }
    });
  }

  saveData() {
    const data = this.textarea.value;
    this.updateLocalStorage(data);
    this.modal.classList.add("hidden");
    return data;
  }

  updateLocalStorage(data) {
    let currentState = JSON.parse(localStorage.getItem("currentState")) || {};
    if (!currentState.sceleton) currentState.sceleton = {};
    currentState.sceleton[this.key] = data;
    localStorage.setItem("currentState", JSON.stringify(currentState));
  }

  getSavedValue() {
    const currentState = JSON.parse(localStorage.getItem("currentState")) || {};
    const value = currentState.sceleton?.[this.key];
    
    if (typeof value === 'object') {
      return value;
    }
    
    try {
      return value ? JSON.parse(value) : "";
    } catch (e) {
      return value || "";
    }
  }

  setDefaultValue(defaultValue) {
    let currentState = JSON.parse(localStorage.getItem("currentState")) || {};
    if (!currentState.sceleton) currentState.sceleton = {};
    if (!currentState.sceleton[this.key]) {
      currentState.sceleton[this.key] = defaultValue;
      localStorage.setItem("currentState", JSON.stringify(currentState));
    }
    this.loadSavedState();
  }
}

class PageSceletonSetter {
  constructor(buttonId, modalId, saveButtonId) {
    this.button = document.getElementById(buttonId);
    this.modal = document.getElementById(modalId);
    this.saveButton = document.getElementById(saveButtonId);
    this.fields = [
      { key: "lang", type: "text", label: "Language" },
      { key: "title", type: "text", label: "Title" },
      { key: "description", type: "textarea", label: "Description" },
      { key: "headSnippet", type: "textarea", label: "Head Snippet" },
      { key: "tailwindStyles", type: "textarea", label: "Tailwind Styles" },
      { key: "bodyStartSnippet", type: "textarea", label: "Body Start Snippet" },
      { key: "bodyClasses", type: "text", label: "Body Classes" },
      { key: "useDevStyles", type: "checkbox", label: "Use Development Styles" },
    ];

    this.initModal();
    this.initEventListeners();
    this.loadSavedState();
    this.initializeTailwindStyles();
  }

  initModal() {
    let fieldsHtml = "";
    this.fields.forEach((field) => {
      if (field.type === "checkbox") {
        fieldsHtml += `
          <div class="mb-4">
            <label class="flex items-center">
              <input type="checkbox" id="${field.key}" name="${field.key}" class="mr-2">
              <span>${field.label}</span>
            </label>
          </div>
        `;
      } else {
      const inputType = field.type === "textarea" ? "textarea" : "input";
      fieldsHtml += `
        <div class="mb-4">
          <label for="${field.key}" class="block text-bold text-md mb-2">${field.label}</label>
          <${inputType} id="${field.key}" name="${field.key
        }" class="w-full p-2 mb-4 rounded-[8px] text-[.85em] bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-500"
            ${field.type === "textarea" ? 'rows="4"' : `type="${field.type}"`
        }></${inputType}>
        </div>
      `;
      }
    });

    this.modal.innerHTML = `
      <div class="modal-content relative bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-300 p-6 rounded w-full max-w-3xl h-full overflow-y-auto">
        <h2 class="text-2xl mb-4">Export Page Settings</h2>
        <form id="sceletonForm">
          ${fieldsHtml}
          <div class="mb-8 flex justify-end gap-x-2">
            <button type="submit" class="px-4 py-2 bg-sky-500 text-[.85em] text-white rounded-[8px]">Save Settings</button>
          </div>
        </form>
      </div>
    `;

    this.form = document.getElementById("sceletonForm");
  }

  initEventListeners() {
    this.button.addEventListener("click", () => this.openModal());
    this.modal.addEventListener("click", (e) => this.handleModalClick(e));
    this.form.addEventListener("submit", (e) => this.saveData(e));
  }

  openModal() {
    this.modal.classList.remove("hidden");
  }

  handleModalClick(e) {
    if (e.target === this.modal) {
      this.modal.classList.add("hidden");
    }
  }

  loadSavedState() {
    const storedState = localStorage.getItem("currentState");
    let currentState = {};
    if (storedState && storedState !== "undefined") {
      try {
        currentState = JSON.parse(storedState);
        if (!currentState.sceleton?.tailwindStyles) {
          if (!currentState.sceleton) currentState.sceleton = {};
          currentState.sceleton.tailwindStyles = tailwindStylesDefault;
          localStorage.setItem('currentState', JSON.stringify(currentState));
        }
      } catch (error) {
        console.error("Error parsing stored state:", error);
      }
    }
    
    this.fields.forEach((field) => {
      const element = document.getElementById(field.key);
      if (element) {
        let value = currentState.sceleton?.[field.key];
        
        if (field.type === "checkbox") {
          element.checked = value || false;
        } else {
          if (field.key === 'config' && typeof value === 'object') {
            value = JSON.stringify(value, null, 2);
          }
          element.value = value || "";
        }
      }
    });
  }

  saveData(e) {
    if (e) e.preventDefault();
    let data = {};
    this.fields.forEach((field) => {
      const element = document.getElementById(field.key);
      if (element) {
        if (field.type === "checkbox") {
          data[field.key] = element.checked;
        } else {
          if (field.key === 'config') {
            try {
              data[field.key] = JSON.parse(element.value);
            } catch (error) {
              data[field.key] = element.value;
            }
          } else {
            data[field.key] = element.value;
          }
        }
      }
    });
    this.updateLocalStorage(data);
    this.modal.classList.add("hidden");
    return data;
  }

  updateLocalStorage(data) {
    const storedState = localStorage.getItem("currentState");
    let currentState =
      storedState && storedState !== "undefined" ? JSON.parse(storedState) : {};
    if (!currentState.sceleton) currentState.sceleton = {};
    Object.assign(currentState.sceleton, data);
    localStorage.setItem("currentState", JSON.stringify(currentState));
  }

  getSavedValue(key) {
    const storedState = localStorage.getItem("currentState");
    let currentState = {};
    if (storedState && storedState !== "undefined") {
      try {
        currentState = JSON.parse(storedState);
      } catch (error) {
        console.error("Error parsing stored state:", error);
      }
    }
    return currentState.sceleton?.[key] || "";
  }

  setDefaultValues(defaultValues) {
    const storedState = localStorage.getItem("currentState");
    let currentState = {};
    if (storedState && storedState !== "undefined") {
      try {
        currentState = JSON.parse(storedState);
      } catch (error) {
        console.error("Error parsing stored state:", error);
      }
    }
    if (!currentState.sceleton) currentState.sceleton = {};
    this.fields.forEach((field) => {
      if (!currentState.sceleton[field.key] && defaultValues[field.key]) {
        currentState.sceleton[field.key] = defaultValues[field.key];
      }
    });
    localStorage.setItem("currentState", JSON.stringify(currentState));
    this.loadSavedState();
  }

  initializeTailwindStyles() {
    const storedState = localStorage.getItem('currentState');
    let tailwindStylesValue;
    
    if (storedState) {
      try {
        const parsedState = JSON.parse(storedState);
        tailwindStylesValue = parsedState.sceleton?.tailwindStyles;
      } catch (error) {
        console.error('Error parsing stored tailwindStyles:', error);
      }
    }
    
    if (!tailwindStylesValue) {
      tailwindStylesValue = tailwindStylesDefault;
    }
    
    const tailwindStylesTextarea = document.getElementById('tailwindStyles');
    if (tailwindStylesTextarea) {
      tailwindStylesTextarea.value = tailwindStylesValue;
    }
  }
}