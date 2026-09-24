<script setup lang="ts">
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

// Base64 заглушки для изображений
const placeholderLight = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2Q1ZjRkYyIvPjwvc3ZnPg=='
const placeholderDark = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iIzAxMGUwNCIvPjwvc3ZnPg=='
</script>

<template>
  <MainNavigation />

  <!-- Hero 1: Centered with background -->
  <Hero sectionKey="a_better_way_to_build_your_saas" layout="centered" height="nav" class="bg-gradient-to-b from-muted/50 to-background dark:from-muted/10">
    <HeroContent class="container mx-auto" padding="md">
      <Badge>New Features</Badge>
      <HeroTitle>A better way to build your SaaS</HeroTitle>
      <HeroDescription>
        Create a landing page that converts visitors into customers with our easy-to-use builder.

      </HeroDescription>
      <HeroActions>
        <Button size="lg">Get Started</Button>
        <Button size="lg" variant="outline">Learn More</Button>
      </HeroActions>
    </HeroContent>
  </Hero>

  <!-- Hero 2: Split with image --> 
  <Hero sectionKey="transform_your_workflow_one" layout="split" height="medium" spacing="md">
      <HeroContent align="left" padding="md">
        <HeroTitle>Transform your workflow One</HeroTitle>
        <HeroDescription>
          Streamline your development process with our integrated tools and components.
        </HeroDescription>
        <HeroActions class="justify-start">
          <Button size="lg">Try Now</Button>
        </HeroActions>
      </HeroContent>
      
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
  </Hero>

  <!-- Hero 3: Minimal centered -->
  <Hero sectionKey="simple_fast_secure_" layout="centered" height="medium" spacing="sm">
    <HeroContent class="container mx-auto" padding="md">
      <HeroTitle>
        Simple. Fast. Secure.
      </HeroTitle>
      <HeroDescription class="max-w-xl">
        Everything you need to launch your next project.
      </HeroDescription>
      <HeroActions>
        <Button size="lg">Start Free Trial</Button>
      </HeroActions>
    </HeroContent>
  </Hero>

  <!-- Hero 4: Split with image -->
  <Hero sectionKey="transform_your_workflow_two" layout="split" height="medium" spacing="md">
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
      <HeroContent align="left" padding="md">
        <HeroTitle>Transform your workflow Two</HeroTitle>
        <HeroDescription>
          Streamline your development process with our integrated tools and components.
        </HeroDescription>
        <HeroActions class="justify-start">
          <Button size="lg">Try Now</Button>
        </HeroActions>
      </HeroContent>
  </Hero>

  <!-- Hero 5: Full screen with overlay -->
  <Hero sectionKey="build_the_future" layout="centered" height="screen" class="relative">
    <div class="absolute inset-0">
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
      <div class="absolute inset-0 bg-background/80 backdrop-blur-sm" />
    </div>
    <HeroContent class="relative container mx-auto z-10" padding="md">
      <HeroTitle>Build the future</HeroTitle>
      <HeroDescription>
        Join thousands of developers building the next generation of web applications.
      </HeroDescription>
      <HeroActions>
        <Button size="lg" variant="default">Get Started</Button>
        <Button size="lg" variant="outline">View Demo</Button>
      </HeroActions>
    </HeroContent>
  </Hero>
</template> 