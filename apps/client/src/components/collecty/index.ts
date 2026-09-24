import { cva, type VariantProps } from 'class-variance-authority'

export { default as Collecty } from './Collecty.vue'
export { default as CollectyTrigger } from './CollectyTrigger.vue'
export { default as CollectyIndicator } from './CollectyIndicator.vue'

export const collectyVariants = cva(
  'inline-flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'text-muted-foreground hover:text-foreground',
        solid: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        sm: 'h-8 w-8',
        md: 'h-9 w-9',
        lg: 'h-10 w-10',
      },
      state: {
        active: 'text-primary',
        inactive: 'opacity-70',
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
      state: 'inactive'
    }
  }
)

export type CollectyVariants = VariantProps<typeof collectyVariants> 