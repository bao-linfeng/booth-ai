export function useFont() {
  const loadFont = async (fontFamily: string) => {
    try {
      await document.fonts.load(`1rem "${fontFamily}"`)
      document.documentElement.style.setProperty('--font-sans', `"${fontFamily}", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`)
    } catch (error) {
      console.error(`Failed to load font: ${fontFamily}`, error)
    }
  }

  const updateFontLink = (fontFamily: string) => {
    const existingLink = document.querySelector('link[data-font]')
    if (existingLink) {
      existingLink.remove()
    }

    if (fontFamily === 'Microsoft YaHei') return

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${fontFamily}:wght@400;500;600;700&display=swap`
    link.dataset.font = fontFamily
    document.head.appendChild(link)
  }

  return {
    loadFont,
    updateFontLink
  }
}
