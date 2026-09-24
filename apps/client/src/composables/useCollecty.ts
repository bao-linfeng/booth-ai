import { ref, watch, computed } from 'vue'

interface CollectyItem {
  id: string
  path: string
  timestamp: number
}

// Создаем глобальное состояние вне функции
const STORAGE_KEY = 'uiCollection'
const globalCollection = ref<CollectyItem[]>([])
let isInitialized = false

// Функция для форматирования ID
const formatCollectionId = (id: string): string => {
  // Очищаем ID от префикса hero__
  const cleanId = id.replace('hero__', '')
  // Добавляем случайный суффикс для уникальности
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${cleanId}_${suffix}`
}

export function useCollecty() {
  const loadCollection = () => {
    if (isInitialized) {
      console.log('Collection already initialized')
      return
    }

    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const items = JSON.parse(saved) as CollectyItem[]
        console.log('Loading collection:', items)
        // Проверяем, что items это массив и все элементы имеют необходимые поля
        if (Array.isArray(items) && items.every(item => item && item.id)) {
          globalCollection.value = items
        } else {
          console.warn('Invalid collection format, resetting to empty array')
          globalCollection.value = []
        }
      }
    } catch (error) {
      console.error('Failed to load collection:', error)
      globalCollection.value = []
    }
    isInitialized = true
  }

  const saveCollection = () => {
    console.log('Saving collection:', globalCollection.value)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(globalCollection.value))
  }

  watch(
    globalCollection,
    () => {
      saveCollection()
    },
    { deep: true }
  )

  const isInCollection = (id: string): boolean => {
    if (!id) return false
    
    // Очищаем ID для сравнения
    const cleanId = id.replace('hero__', '')
    const exists = globalCollection.value.some(item => {
      if (!item || !item.id) return false
      // Очищаем ID элемента от суффикса для сравнения
      const itemBaseId = item.id.split('_').slice(0, -1).join('_')
      return itemBaseId === cleanId
    })
    console.log(`Checking if ${cleanId} is in collection:`, exists)
    return exists
  }

  const addToCollection = (id: string, path: string) => {
    if (!id || !path) {
      console.warn('Invalid id or path provided')
      return
    }

    console.log('Current collection:', [...globalCollection.value])
    
    const formattedId = formatCollectionId(id)
    console.log(`Adding to collection:`, { id: formattedId, path })

    if (!isInCollection(id)) {
      globalCollection.value = [
        ...globalCollection.value,
        {
          id: formattedId,
          path,
          timestamp: Date.now()
        }
      ]
      console.log('Collection after add:', [...globalCollection.value])
    } else {
      console.log(`Item ${id} already exists in collection`)
    }
  }

  const removeFromCollection = (id: string) => {
    if (!id) return

    console.log('Current collection:', [...globalCollection.value])
    console.log(`Removing from collection: ${id}`)
    
    const cleanId = id.replace('hero__', '')
    globalCollection.value = globalCollection.value.filter(item => {
      if (!item || !item.id) return false
      const itemBaseId = item.id.split('_').slice(0, -1).join('_')
      return itemBaseId !== cleanId
    })
    console.log('Collection after remove:', [...globalCollection.value])
  }

  // Загружаем коллекцию при первой инициализации
  loadCollection()

  return {
    collection: computed(() => globalCollection.value),
    isInCollection,
    addToCollection,
    removeFromCollection
  }
} 