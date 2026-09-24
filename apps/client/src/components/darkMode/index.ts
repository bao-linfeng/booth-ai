import { cva, type VariantProps } from 'class-variance-authority'

export { default as DarkMode } from './DarkMode.vue'

export const darkModeVariants = cva(
  'inline-flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 w-10',
        sm: 'h-9 w-9',
        lg: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'default',
    },
  },
)

export type DarkModeVariants = VariantProps<typeof darkModeVariants> 