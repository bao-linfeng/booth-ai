<script setup lang="ts">
import { MainNavigation } from '@/components/sections/navbar'
import {
  Hero,
  HeroContent,
  HeroTitle,
  HeroDescription,
  HeroActions
} from '@/components/sections/hero'
import { Button } from '@/components/ui/button'
</script>

<template>
  <main>
    <MainNavigation />
    <router-view />
    <Hero sectionKey="build_your_next_landing_page_with_shadcn_vue" layout="centered" height="nav">
      <HeroContent class="container mx-auto" padding="md">
        <HeroTitle as="h1">
          Build your next <br>
          <span class="text-primary">Landing Page</span><br>
          with Shadcn Vue
        </HeroTitle>
        <HeroDescription>
          Beautiful and accessible components that you can copy and paste into your apps.
        </HeroDescription>
        <HeroActions>
          <a href="#">
            <Button size="lg" class="text-white">Get Started</Button>
          </a>
          <a href="#">
            <Button size="lg" variant="outline">Get UI Blocks</Button>
          </a>
        </HeroActions>
      </HeroContent>
    </Hero>
  </main>
</template>