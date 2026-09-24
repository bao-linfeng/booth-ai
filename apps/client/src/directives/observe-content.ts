import type { Directive } from 'vue'

export const vObserveContent: Directive = {
  mounted(el, binding) {
    const observer = new MutationObserver(() => {
      binding.value = el.innerText.trim()
    })
    
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true
    })
    
    // Инициализация начального значения
    binding.value = el.innerText.trim()
  }
} 