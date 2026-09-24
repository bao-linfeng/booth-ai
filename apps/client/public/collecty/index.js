import { SectionCollecty } from './collecty.module.js';

// Функция для проверки URL параметров
function shouldAutoStart() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.has('lets') && urlParams.get('lets') === 'go';
}

// Ждем полной загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    let collecty = null;
    
    if (shouldAutoStart()) {
        collecty = new SectionCollecty();
        return;
    }
    
    const checkButton = () => {
        const getStartedBtn = document.getElementById('getStarted');
        if (getStartedBtn) {
            getStartedBtn.addEventListener('click', () => {
                if (collecty) {
                    collecty.destroy();
                }
                collecty = new SectionCollecty();
            });
        } else {
            requestAnimationFrame(checkButton);
        }
    };

    checkButton();
}); 