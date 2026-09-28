/// <reference types="bun-types" />
/// <reference types="vite/client" />
/// <reference types="vue-router" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// Глобальные типы
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_LINGTONG_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}