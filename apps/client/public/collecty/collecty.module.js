import { CONFIG } from './collecty.config.js';

export class SectionCollecty {
    constructor() {
        this.isActive = false;
        this.boundSections = new Set();
        this.boundButtons = new Set();
        this.storedSections = new Set(this.getStorageData());
        
        this.initialize();
    }

    initialize() {
        console.log('Initializing SectionCollecty');
        this.isActive = true;
        this.initializeSections();
        this.observeDOM();
    }

    observeDOM() {
        if (this.domObserver) {
            this.domObserver.disconnect();
        }

        this.domObserver = new MutationObserver((mutations) => {
            let needsReinitialization = false;

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.nodeName === 'SECTION' || node.querySelector('section')) {
                            needsReinitialization = true;
                        }
                    }
                });

                mutation.removedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.nodeName === 'SECTION' || node.querySelector('section')) {
                            this.cleanupSection(node);
                        }
                    }
                });
            });

            if (needsReinitialization) {
                this.initializeSections();
            }
        });

        this.domObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    initializeSections() {
        Array.from(document.getElementsByTagName('section')).forEach(async section => {
            await this.initializeSection(section);
        });
    }

    async initializeSection(section) {
        if (this.boundSections.has(section)) return;

        const heading = section.querySelector('h1, h2, h3')?.textContent.trim() || 'untitled';
        const currentPage = this.identifyCurrentPage();
        
        const isStored = this.isStoredSection(currentPage, heading);
        
        if (isStored) {
            section.style.opacity = CONFIG.styles.section.inactiveOpacity;
            section.dataset.stored = 'true';
            section.dataset.sectionId = this.generateSectionIdFromParts(currentPage, heading);
            
            this.markAsSaved(section);
        } else {
            section.style.opacity = CONFIG.styles.section.activeOpacity;
            section.addEventListener('mouseenter', this.handleMouseEnter.bind(this));
            section.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
            section.addEventListener('click', this.handleMouseEnter.bind(this));
        }
        
        this.boundSections.add(section);
    }

    isStoredSection(page, heading) {
        return Array.from(this.storedSections).some(sectionId => {
            const { page: storedPage, heading: storedHeading } = this.decodeSectionId(sectionId);
            return storedPage === page && 
                   this.normalizeHeading(storedHeading) === this.normalizeHeading(heading);
        });
    }

    normalizeHeading(heading) {
        return heading.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    generateSectionIdFromParts(page, heading) {
        const normalizedHeading = this.normalizeHeading(heading);
        const timestamp = Date.now().toString(36).slice(-4);
        return `${page}_title_${normalizedHeading}_${timestamp}`;
    }

    markAsSaved(section) {
        const savedIndicator = document.createElement('div');
        savedIndicator.className = 'section-saved-indicator ' + CONFIG.styles.menu.wrapper;
        Object.assign(savedIndicator.style, CONFIG.styles.menu.position);
        
        const button = document.createElement('button');
        button.className = CONFIG.styles.menu.button;
        button.disabled = true;
        button.innerHTML = `
            Saved 
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/></svg>
        `;
        
        savedIndicator.appendChild(button);
        section.appendChild(savedIndicator);
    }

    async handleMouseEnter(event) {
        if (event.type === 'click' && event.target !== event.currentTarget) {
            return;
        }

        const section = event.currentTarget;
        const isStored = await this.checkIfStored(section);
        
        if (isStored) {
            section.style.opacity = CONFIG.styles.section.inactiveOpacity;
            return;
        }
        
        section.classList.add(CONFIG.styles.section.highlight);
        const menu = await this.createFloatingMenu(section);
        section.appendChild(menu);
    }

    handleMouseLeave(event) {
        const section = event.currentTarget;
        section.classList.remove(CONFIG.styles.section.highlight);
        
        const menu = section.querySelector('.section-collecty-menu');
        if (menu) menu.remove();
    }

    async createFloatingMenu(section) {
        const menu = document.createElement('div');
        menu.className = 'section-collecty-menu ' + CONFIG.styles.menu.wrapper;
        Object.assign(menu.style, CONFIG.styles.menu.position);

        const isStored = await this.checkIfStored(section);
        const button = document.createElement('button');
        button.className = CONFIG.styles.menu.button;
        
        if (isStored) {
            button.innerHTML = `
                Saved 
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 16 2 2 4-4"/><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"/><path d="m7.5 4.27 9 5.15"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/></svg>
            `;
            button.disabled = true;
        } else {
            button.innerHTML = `
                Save Block
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/></svg>
            `;
            button.addEventListener('click', () => this.saveToStorage(section));
        }
        
        menu.appendChild(button);
        return menu;
    }

    cleanupSection(section) {
        if (!this.boundSections.has(section)) return;
        
        section.removeEventListener('mouseenter', this.handleMouseEnter.bind(this));
        section.removeEventListener('mouseleave', this.handleMouseLeave.bind(this));
        section.removeEventListener('click', this.handleMouseEnter.bind(this));
        
        this.boundSections.delete(section);
    }

    identifyCurrentPage() {
        const segments = window.location.pathname.split('/').filter(Boolean);
        return segments.length === 0 ? 'home' : segments.join('-');
    }

    generateSectionId(section) {
        const currentPage = this.identifyCurrentPage();
        const heading = section.querySelector('h1, h2, h3')?.textContent.trim() || 'untitled';
        
        const normalizedHeading = heading.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        
        const timestamp = Date.now().toString(36).slice(-4);
        
        return `${currentPage}_title_${normalizedHeading}_${timestamp}`;
    }

    getStorageData() {
        try {
            return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]');
        } catch (e) {
            console.error('Error parsing storage data:', e);
            return [];
        }
    }

    async saveToStorage(section) {
        const heading = section.querySelector('h1, h2, h3')?.textContent.trim() || 'untitled';
        const currentPage = this.identifyCurrentPage();
        const sectionId = this.generateSectionIdFromParts(currentPage, heading);
        
        const storageData = this.getStorageData();
        
        if (!storageData.includes(sectionId)) {
            storageData.push(sectionId);
        }
        
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(storageData));
            this.storedSections.add(sectionId);
            
            section.style.opacity = CONFIG.styles.section.inactiveOpacity;
            section.dataset.stored = 'true';
            section.dataset.sectionId = sectionId;
            
            this.cleanupSection(section);
            
            const existingMenu = section.querySelector('.section-collecty-menu');
            if (existingMenu) {
                existingMenu.remove();
            }
            
            this.markAsSaved(section);
        } catch (e) {
            console.error('Error saving to storage:', e);
        }
    }

    async checkIfStored(section) {
        const sectionId = section.dataset.sectionId;
        if (!sectionId) return false;
        
        const storageData = this.getStorageData();
        const { page, heading } = this.decodeSectionId(sectionId);
        
        // Проверяем, существует ли секция в хранилище по заголовку и URL
        return storageData.some(id => {
            const { page: storedPage, heading: storedHeading } = this.decodeSectionId(id);
            return storedPage === page && storedHeading === heading;
        });
    }

    decodeSectionId(sectionId) {
        const [page, , ...rest] = sectionId.split('_');
        const heading = rest.slice(0, -1).join(' ');
        return {
            page,
            heading: heading.replace(/\b\w/g, c => c.toUpperCase())
        };
    }

    destroy() {
        this.domObserver?.disconnect();
        this.boundSections.forEach(section => {
            this.cleanupSection(section);
        });
        this.boundSections.clear();
        this.boundButtons.clear();
    }
}

export default SectionCollecty;