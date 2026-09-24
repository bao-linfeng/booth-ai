import { cva } from 'class-variance-authority'

export const blogVariants = cva(
  'relative w-full',
  {
    variants: {
      layout: {
        default: '',
        grid: 'grid gap-6',
        featured: 'grid grid-cols-1 md:grid-cols-2 gap-8',
        list: 'space-y-8',
        horizontal: 'grid gap-6'
      },
      padding: {
        none: '',
        sm: 'p-4',
        md: 'p-6',
        lg: 'p-8'
      },
      columns: {
        1: 'grid-cols-1',
        2: 'grid-cols-1 md:grid-cols-2',
        3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
      }
    },
    defaultVariants: {
      layout: 'default',
      padding: 'none',
      columns: 3
    }
  }
)

export interface BlogVariants {
  layout?: 'default' | 'grid' | 'featured' | 'list' | 'horizontal'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  columns?: 1 | 2 | 3 | 4
} 