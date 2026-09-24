export function initializeTheme() {
  const darkMode = localStorage.getItem('darkMode')
  if (darkMode === 'true') {
    document.documentElement.classList.add('dark')
  }
} 