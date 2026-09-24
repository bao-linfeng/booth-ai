// Configuration
const CONFIG = {
    // Main settings
    storageKey: 'uiblocksFavourites',
    
    // Visual settings
    styles: {
        section: {
            highlight: 'bg-primary/20',
            activeOpacity: '1',
            inactiveOpacity: '0.5'
        },
        menu: {
            position: { top: '10px', right: '10px' },
            wrapper: 'absolute z-50',
            button: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-9 px-4 py-2 bg-primary text-white hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground`
        }
    },
    formatting: {
        indentSize: 2,
        preserveClassFormatting: true,
        removeComments: false,
        removeEmptyLines: false
    }
};

export { CONFIG };
