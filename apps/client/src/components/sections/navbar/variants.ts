import { cva } from 'class-variance-authority'

export const navbarVariants = cva(
  'w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
  {
    variants: {
      position: {
        fixed: 'fixed top-0 left-0 right-0 z-50',
        sticky: 'sticky top-0 z-50',
        relative: 'relative'
      },
      size: {
        sm: 'h-12',
        default: 'h-14',
        lg: 'h-16',
        xl: 'h-[64px]'
      },
      border: {
        none: 'border-none',
        default: 'border-b',
        gradient: 'border-b-[0.5px] border-gradient'
      },
      shadow: {
        none: '',
        default: 'shadow-sm',
        glow: 'shadow-glow'
      }
    },
    defaultVariants: {
      position: 'sticky',
      size: 'default',
      border: 'default',
      shadow: 'none'
    }
  }
)

export const navbarLayerVariants = cva('flex items-center gap-4', {
  variants: {
    position: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
    },
  },
  defaultVariants: {
    position: 'start',
  },
}) 