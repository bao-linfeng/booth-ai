// favourites-loader.js
(async function() {
    const FAVOURITES_KEY = 'uiCollection';
    const CURRENT_STATE_KEY = 'currentState';
    const GET_BLOCKS_BTN_ID = 'getBlocksBtn';
    const HIDDEN_BTN_ID = 'letsGoBtn';
    
    const storage = {
        getFavourites() {
            try {
                const data = JSON.parse(localStorage.getItem(FAVOURITES_KEY) || '[]');
                return data;
            } catch (e) {
                console.error('Error parsing favourites:', e);
                return [];
            }
        },
        
        getCurrentState() {
            try {
                return JSON.parse(localStorage.getItem(CURRENT_STATE_KEY) || '{"blocks":{}}');
            } catch (e) {
                console.error('Error parsing current state:', e);
                return { blocks: {} };
            }
        },

        // Обновляем метод очистки, сохраняя остальные объекты
        clearCurrentStateBlocks() {
            try {
                const currentState = this.getCurrentState();
                // Сохраняем текущее состояние, но очищаем blocks
                currentState.blocks = {};
                localStorage.setItem(CURRENT_STATE_KEY, JSON.stringify(currentState));
                console.log('Current state blocks cleared');
            } catch (e) {
                console.error('Error clearing current state blocks:', e);
            }
        }
    };

    // Проверка наличия новых блоков и управление видимостью кнопок
    function checkNewBlocks() {
        const favourites = storage.getFavourites();
        const currentState = storage.getCurrentState();
        
        // Считаем количество неимпортированных блоков
        const newBlocksCount = favourites.filter(item => !currentState.blocks[item.id]).length;
        
        // Управляем видимостью кнопок через классы
        const getBlocksBtn = document.getElementById(GET_BLOCKS_BTN_ID);
        const hiddenBtn = document.getElementById(HIDDEN_BTN_ID);
        
        console.log('New blocks count:', newBlocksCount);
        
        if (newBlocksCount > 0) {
            console.log('Showing Get UI Blocks button');
            // Показываем кнопку импорта и скрываем Let's Go
            getBlocksBtn?.classList.remove('hidden');
            hiddenBtn?.classList.add('hidden');
            
            // Добавляем обработчик только если его еще нет
            if (!getBlocksBtn.hasAttribute('data-handler-attached')) {
                getBlocksBtn.setAttribute('data-handler-attached', 'true');
                getBlocksBtn.addEventListener('click', async () => {
                    getBlocksBtn.disabled = true;
                    try {
                        await processBlocks();
                        window.location.reload();
                    } catch (e) {
                        console.error('Error processing blocks:', e);
                        getBlocksBtn.disabled = false;
                    }
                });
            }
        } else {
            console.log('Showing Let\'s Go button');
            // Скрываем кнопку импорта и показываем Let's Go
            getBlocksBtn?.classList.add('hidden');
            hiddenBtn?.classList.remove('hidden');
        }
    }

    // Основной процесс импорта
    async function processBlocks() {
        const favourites = storage.getFavourites();
        
        // Очищаем только blocks в текущем состоянии
        storage.clearCurrentStateBlocks();
        const currentState = storage.getCurrentState();

        for (const item of favourites) {
            const fullId = item.id;
            
            // Получаем путь из объекта
            const path = item.path.replace(/^\//, '').replace(/\//g, '-') || 'home';
            // Получаем чистый ID без суффикса
            const cleanId = fullId.split('_').slice(0, -1).join('_');
            
            console.log(`Processing: path=${path}, cleanId=${cleanId}`);
            
            try {
                const pageData = await loadPageData(path);
                
                if (!pageData?.blocks) {
                    console.warn(`No blocks found for ${path}`);
                    continue;
                }

                const matchingBlock = Object.values(pageData.blocks)
                    .find(block => {
                        const blockId = block.id.toLowerCase();
                        const searchId = cleanId.toLowerCase();
                        return blockId === searchId;
                    });

                if (matchingBlock) {
                    console.log(`Found matching block:`, matchingBlock);
                    currentState.blocks[fullId] = {
                        id: fullId,
                        title: matchingBlock.title,
                        content: matchingBlock.content
                    };
                } else {
                    console.warn(`No matching block found for ${cleanId} in ${path}`);
                }
            } catch (error) {
                console.error(`Error processing block ${fullId}:`, error);
            }
        }

        localStorage.setItem(CURRENT_STATE_KEY, JSON.stringify(currentState));
    }

    async function loadPageData(url) {
        try {
            const response = await fetch(`/api/pages/${url}.json`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (e) {
            console.error(`Error loading page ${url}:`, e);
            return null;
        }
    }

    // Запускаем проверку когда DOM загружен
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkNewBlocks);
    } else {
        checkNewBlocks();
    }
})();