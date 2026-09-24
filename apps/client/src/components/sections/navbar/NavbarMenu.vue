<script setup lang="ts">
import { 
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Menu } from 'lucide-vue-next'
import { ref } from 'vue'

const isOpen = ref(false)
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetTrigger asChild>
      <Button variant="ghost" size="icon">
        <Menu class="h-5 w-5" />
        <span class="sr-only">Toggle menu</span>
      </Button>
    </SheetTrigger>
    <SheetContent side="left" class="w-[280px] sm:w-[340px]">
      <SheetHeader>
        <SheetTitle>
          <slot name="title">Menu</slot>
        </SheetTitle>
        <SheetDescription>
          <slot name="description">Navigation menu</slot>
        </SheetDescription>
      </SheetHeader>
      <div class="flex-1 overflow-y-auto px-4">
        <slot />
      </div>
      <SheetFooter>
        <slot name="footer" />
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template> 