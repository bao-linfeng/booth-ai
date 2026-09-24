const defaultConfig = `{
    "darkMode": "class",
    "theme": {
        "fontFamily": {
            "sans": ["Nunito", "sans-serif"]
        },
        "container": {
            "center": true,
            "padding": "2rem"
        },
        "extend": {
            "colors": {
                "border": "hsl(var(--border))",
                "input": "hsl(var(--input))",
                "ring": "hsl(var(--ring))",
                "background": "hsl(var(--background))",
                "foreground": "hsl(var(--foreground))",
                "primary": {
                    "DEFAULT": "hsl(var(--primary))",
                    "foreground": "hsl(var(--primary-foreground))"
                },
                "secondary": {
                    "DEFAULT": "hsl(var(--secondary))",
                    "foreground": "hsl(var(--secondary-foreground))"
                },
                "destructive": {
                    "DEFAULT": "hsl(var(--destructive))",
                    "foreground": "hsl(var(--destructive-foreground))"
                },
                "muted": {
                    "DEFAULT": "hsl(var(--muted))",
                    "foreground": "hsl(var(--muted-foreground))"
                },
                "accent": {
                    "DEFAULT": "hsl(var(--accent))",
                    "foreground": "hsl(var(--accent-foreground))"
                },
                "popover": {
                    "DEFAULT": "hsl(var(--popover))",
                    "foreground": "hsl(var(--popover-foreground))"
                },
                "card": {
                    "DEFAULT": "hsl(var(--card))",
                    "foreground": "hsl(var(--card-foreground))"
                }
            },
            "borderRadius": {
                "xl": "calc(var(--radius) + 4px)",
                "lg": "var(--radius)",
                "md": "calc(var(--radius) - 2px)",
                "sm": "calc(var(--radius) - 4px)"
            }
        }
    }
}`;

const tailwindStylesDefault = `@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 142.1 76.2% 36.3%;
    --primary-foreground: 355.7 100% 97.3%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --accent: 240 4.8% 95.9%;
    --accent-foreground: 240 5.9% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 142.1 76.2% 36.3%;
    --radius: 0.75rem;
  }

  .dark {
    --background: 20 14.3% 4.1%;
    --foreground: 0 0% 95%;
    --popover: 0 0% 9%;
    --popover-foreground: 0 0% 95%;
    --card: 24 9.8% 10%;
    --card-foreground: 0 0% 95%;
    --primary: 142.1 70.6% 45.3%;
    --primary-foreground: 144.9 80.4% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 15%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 12 6.5% 15.1%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 85.7% 97.3%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 142.4 71.8% 29.2%;
    --border-color-dark: 240 3.7% 21.9%;
  }

  .dark .border {
    border: 1px solid hsl(var(--border-color-dark));
  }
}`;

const bodyClassesDefault = `font-sans bg-background text-foreground antialiased`;

const headSnippetDefault = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NyA0MCIgZmlsbD0iIzBlYTVlOSI+DQogICAgPHBhdGggZD0iTTIzLjUgNi41QzE3LjUgNi41IDEzLjc1IDkuNSAxMi4yNSAxNS41QzE0LjUgMTIuNSAxNy4xMjUgMTEuMzc1IDIwLjEyNSAxMi4xMjVDMjEuODM2NyAxMi41NTI5IDIzLjA2MDEgMTMuNzk0NyAyNC40MTQyIDE1LjE2OTJDMjYuNjIwMiAxNy40MDg0IDI5LjE3MzQgMjAgMzQuNzUgMjBDNDAuNzUgMjAgNDQuNSAxNyA0NiAxMUM0My43NSAxNCA0MS4xMjUgMTUuMTI1IDM4LjEyNSAxNC4zNzVDMzYuNDEzMyAxMy45NDcxIDM1LjE4OTkgMTIuNzA1MyAzMy44MzU3IDExLjMzMDhDMzEuNjI5NyA5LjA5MTU4IDI5LjA3NjYgNi41IDIzLjUgNi41Wk0xMi4yNSAyMEM2LjI1IDIwIDIuNSAyMyAxIDI5QzMuMjUgMjYgNS44NzUgMjQuODc1IDguODc1IDI1LjYyNUMxMC41ODY3IDI2LjA1MjkgMTEuODEwMSAyNy4yOTQ3IDEzLjE2NDIgMjguNjY5M0MxNS4zNzAyIDMwLjkwODQgMTcuOTIzNCAzMy41IDIzLjUgMzMuNUMyOS41IDMzLjUgMzMuMjUgMzAuNSAzNC43NSAyNC41QzMyLjUgMjcuNSAyOS44NzUgMjguNjI1IDI2Ljg3NSAyNy44NzVDMjUuMTYzMyAyNy40NDcxIDIzLjkzOTkgMjYuMjA1MyAyMi41ODU4IDI0LjgzMDdDMjAuMzc5OCAyMi41OTE2IDE3LjgyNjYgMjAgMTIuMjUgMjBaIj48L3BhdGg+DQo8L3N2Zz4=">`;
  
const bodyScriptDefault = `<script>const darkModeToggl=document.createElement('button');darkModeToggl.innerHTML='🌓';darkModeToggl.className='fixed bottom-4 left-4 bg-slate-200 dark:bg-slate-700 p-2 rounded-full text-xs focus:outline-none transition duration-300 ease-in-out transform hover:scale-110';document.body.appendChild(darkModeToggl);darkModeToggl.addEventListener('click',()=>{document.documentElement.classList.toggle('dark')});if(localStorage.theme==='dark'||(!('theme' in localStorage)&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')} darkModeToggl.addEventListener('click',()=>{if(document.documentElement.classList.contains('dark')){localStorage.theme='dark'}else{localStorage.theme='light'}})<\/script>`;

const defaultBlocks = {
    hero: {
      title: `Welcome Section`,
      content: `
<section class="relative min-h-[60vh] py-12 md:py-24">
  <!-- Background Icon -->
  <div class="absolute inset-0 flex items-end justify-start p-2 md:p-6 opacity-20 pointer-events-none">
    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4YzhjOGMiIHN0cm9rZS13aWR0aD0iMC41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWJsb2NrcyI+PHJlY3Qgd2lkdGg9IjciIGhlaWdodD0iNyIgeD0iMTQiIHk9IjMiIHJ4PSIxIi8+PHBhdGggZD0iTTEwIDIxVjhhMSAxIDAgMCAwLTEtMUg0YTEgMSAwIDAgMC0xIDF2MTJhMSAxIDAgMCAwIDEgMWgxMmExIDEgMCAwIDAgMS0xdi01YTEgMSAwIDAgMC0xLTFIMyIvPjwvc3ZnPg==" 
      class="w-48 md:w-72 h-48 md:h-72" alt="Background Icon">
  </div>

  <div class="absolute inset-0 flex top-0 justify-end p-2 md:p-12 opacity-20 pointer-events-none">
    <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0OCIgaGVpZ2h0PSI0OCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4YzhjOGMiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1wYWNrYWdlLWNoZWNrIj48cGF0aCBkPSJtMTYgMTYgMiAyIDQtNCIvPjxwYXRoIGQ9Ik0yMSAxMFY4YTIgMiAwIDAgMC0xLTEuNzNsLTctNGEyIDIgMCAwIDAtMiAwbC03IDRBMiAyIDAgMCAwIDMgOHY4YTIgMiAwIDAgMCAxIDEuNzNsNyA0YTIgMiAwIDAgMCAyIDBsMi0xLjE0Ii8+PHBhdGggZD0ibTcuNSA0LjI3IDkgNS4xNSIvPjxwb2x5bGluZSBwb2ludHM9IjMuMjkgNyAxMiAxMiAyMC43MSA3Ii8+PGxpbmUgeDE9IjEyIiB4Mj0iMTIiIHkxPSIyMiIgeTI9IjEyIi8+PC9zdmc+" 
      class="w-16 md:w-32 h-16 md:h-32" alt="Background Icon">
  </div>

  <!-- Content -->
  <div class="relative z-10 flex min-h-[inherit] items-center justify-center">
    <div class="flex flex-col text-foreground items-center text-center gap-4 sm:gap-6 p-6 sm:p-8 lg:p-12 container mx-auto">
      <p class="text-lg font-bold text-muted-foreground dark:text-muted-foreground/90 sm:text-xl max-w-4xl">
        Everything you need to start your next project
      </p>
      <h2 class="font-bold tracking-tight text-foreground text-3xl sm:text-4xl md:text-7xl">
        SimplY. <span class="text-primary">FastY.</span> SafetY.
      </h2>
      <p class="text-lg text-secondary-foreground dark:text-secondary-foreground/90 sm:text-xl max-w-4xl">Just click the button: Build LeGo<br />and build with blocks that click together flawlessly</p>
      <div class="flex flex-wrap items-center justify-center gap-4">
        <button type="button" onclick="window.location.href='/?'+new URLSearchParams({lets:'go'}).toString()" class="inline-flex items-center justify-center gap-2 whitespace-nowrap font bold font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background/50 shadow-sm hover:bg-accent hover:text-accent-foreground h-12 rounded-lg px-12">
          Build a LeGo
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="!w-5 !h-5 inline animate-pulse inline"><rect width="18" height="7" x="3" y="3" rx="1"/><rect width="9" height="7" x="3" y="14" rx="1"/><rect width="5" height="7" x="16" y="14" rx="1"/></svg>
        </button>
      </div>
    </div>
  </div>
</section>
  `,
    }
  };