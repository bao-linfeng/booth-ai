<script setup lang="ts">
import { provide } from 'vue'
import { MainNavigation } from '@/components/sections/navbar'
import {
  Hero,
  HeroContent,
  HeroTitle,
  HeroDescription,
  HeroActions,
  HeroMedia
} from '@/components/sections/hero'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

provide('heroTitle', {
  defaultTag: 'h2',
  defaultSize: '3xl'
})

const placeholders = {
  abstract: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMwMEIyRkY7c3RvcC1vcGFjaXR5OjEiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMwMDY2Q0M7c3RvcC1vcGFjaXR5OjEiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cGF0aCBkPSJNMCAwaDgwMHY2MDBIMHoiIGZpbGw9InVybCgjYSkiLz48L3N2Zz4='
}

// Base64 заглушки для изображений
const placeholderLight = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2Q1ZjRkYyIvPjwvc3ZnPg=='
const placeholderDark = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iIzAxMGUwNCIvPjwvc3ZnPg=='
</script>

<template>
  <MainNavigation />
  
  <!-- Hero 1: Medium Hero with abstract background -->
  <Hero sectionKey="50_off_for_early_birds" layout="centered" height="nav" background="gradient">
    <div 
      class="absolute inset-0 bg-cover bg-center opacity-20"
      :style="{ backgroundImage: `url(${placeholders.abstract})` }"
    />
    <HeroContent class="relative container mx-auto z-10" padding="md">
      <Badge>Limited Time Offer</Badge>
      <HeroTitle>50% Off for Early Birds</HeroTitle>
      <HeroDescription>
        Join now and get exclusive access to premium features at half the price.
      </HeroDescription>
      <HeroActions>
        <Button class="md:text-lg py-4 md:py-6 px-8 rounded-full my-8">Claim Offer</Button>
      </HeroActions>
    </HeroContent>
  </Hero>

  <!-- Hero 2: Split with image -->
  <Hero sectionKey="transform_your_workflow" layout="split" height="screen">
      <HeroContent align="left" class="relative container mx-auto z-10" padding="md">
        <HeroTitle>Transform your workflow</HeroTitle>
        <HeroDescription>
          Streamline your development process with our integrated tools and components.
        </HeroDescription>
        <HeroActions class="justify-start">
          <Button size="lg">Try Now</Button>
        </HeroActions>
      </HeroContent>
      
      <HeroMedia rounded="none" aspectRatio="auto" class="h-full">
        <img
          :src="placeholderLight"
          class="object-cover w-full h-full dark:hidden"
          alt="Placeholder"
        />
        <img
          :src="placeholderDark"
          class="object-cover w-full h-full hidden dark:block"
          alt="Placeholder"
        />
      </HeroMedia>
  </Hero>

  <!-- Hero 3: Split with left image -->
  <Hero sectionKey="transform_your_workflow_2" layout="split" height="large" spacing="lg">
      <HeroMedia aspectRatio="video">
        <img
          :src="placeholderLight" 
          class="object-cover w-full h-full dark:hidden"
          alt="Placeholder"
        />
        <img
          :src="placeholderDark"
          class="object-cover w-full h-full hidden dark:block"
          alt="Placeholder"
        />
      </HeroMedia>
      <HeroContent align="left" class="relative container mx-auto z-10" padding="md">
        <HeroTitle>Transform your workflow 2</HeroTitle>
        <HeroDescription>
          Streamline your development process with our integrated tools and components.
        </HeroDescription>
        <HeroActions class="justify-start">
          <Button size="lg">Try Now</Button>
        </HeroActions>
      </HeroContent>
  </Hero>

<!-- Hero 4: with pattern background -->
<Hero sectionKey="designed_for_modern_teams" height="nav" background="gradient" class="flex items-center">
    <div 
      class="absolute inset-0 bg-cover bg-center opacity-20 w-full h-full"
      :style="{ backgroundImage: `url(${placeholders.abstract})` }"
    />
    <div class="container mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 items-center py-12 sm:py-16 lg:py-24 px-6 sm:px-8 lg:px-12">
      <HeroContent align="left" class="relative z-10">
        <HeroTitle>Designed for Modern Teams</HeroTitle>
        <HeroDescription>
          Built with the latest technology stack to ensure maximum performance and scalability.
        </HeroDescription>
        <HeroActions class="justify-start">
          <Button>Learn More</Button>
        </HeroActions>
      </HeroContent>
      <HeroMedia aspectRatio="video" class="relative p-0 sm:p-4 lg:p-8">
        <div class="absolute inset-0 bg-gradient-to-tr from-primary/20 to-primary/5 rounded-lg m-0 sm:m-4 lg:m-8" />
        <img :src="placeholders.abstract" class="object-cover rounded-lg" alt="Abstract" />
      </HeroMedia>
    </div>
</Hero>
</template>