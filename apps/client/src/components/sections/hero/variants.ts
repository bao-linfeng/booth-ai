import { cva } from 'class-variance-authority'

export const heroVariants = cva(
  'relative overflow-hidden',
  {
    variants: {
      align: {
        left: 'text-left',
        center: 'text-center',
        right: 'text-right'
      },
      layout: {
        default: '',
        split: 'grid grid-cols-1 md:grid-cols-2 gap-0 items-center',
        splitBox: 'grid grid-cols-1 md:grid-cols-2 gap-0 items-center',
        centered: 'flex min-h-[inherit] items-center justify-center',
        asymmetric: 'grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-8 items-center'
      },
      container: {
        none: '',
        box: 'container mx-auto',
        full: 'w-full'
      },
      height: {
        auto: '',
        screen: 'min-h-screen',
        large: 'min-h-[80vh]',
        medium: 'min-h-[60vh]',
        nav: 'min-h-[calc(100vh-64px)]'
      },
      background: {
        none: '',
        gradient: 'bg-gradient-to-b from-muted/50 to-background dark:from-muted/10',
        pattern: 'bg-grid-white/10',
        overlay: 'bg-background/80 backdrop-blur-sm'
      },
      spacing: {
        none: '',
        sm: 'py-6 sm:py-8 lg:py-12',
        md: 'py-8 sm:py-12 lg:py-16',
        lg: 'py-12 sm:py-16 lg:py-24'
      }
    },
    defaultVariants: {
      align: 'center',
      layout: 'default',
      container: 'full',
      height: 'auto',
      background: 'none',
      spacing: 'none'
    }
  }
)

export interface HeroVariants {
  align?: 'left' | 'center' | 'right'
  layout?: 'default' | 'split' | 'splitBox' | 'centered' | 'asymmetric'
  container?: 'none' | 'box' | 'full'
  height?: 'auto' | 'screen' | 'large' | 'medium' | 'nav'
  background?: 'none' | 'gradient' | 'pattern' | 'overlay'
  spacing?: 'none' | 'sm' | 'md' | 'lg'
} 