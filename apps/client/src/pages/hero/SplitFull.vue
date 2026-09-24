<script setup lang="ts">
import { MainNavigation } from '@/components/sections/navbar'
import {
  Hero,
  HeroContent,
  HeroTitle,
  HeroDescription,
  HeroMedia,
  HeroActions
} from '@/components/sections/hero'
import { Button } from '@/components/layers/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

// Заглушки изображений
const placeholderLight = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2Q1ZjRkYyIvPjwvc3ZnPg=='
const placeholderDark = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iIzAxMGUwNCIvPjwvc3ZnPg=='
</script>

<template>
  <MainNavigation />

  <!-- Секция 1: Дашборд Preview -->
  <Hero sectionKey="powerful_analytics" layout="split" height="nav">
    <HeroContent 
      align="left" 
      padding="md"
      width="lg"
      class="space-y-8"
    >
      <Badge variant="outline">Dashboard</Badge>
      <HeroTitle size="3xl">Powerful Analytics</HeroTitle>
      <HeroDescription>
        Get real-time insights into your business performance with our advanced analytics dashboard.
      </HeroDescription>
      <div class="grid grid-cols-2 gap-4">
        <Card class="p-4 space-y-2">
          <div class="text-2xl font-bold text-primary">84%</div>
          <p class="text-xs text-muted-foreground">Conversion Rate: this is a test</p>
        </Card>
        <Card class="p-4 space-y-2">
          <div class="text-2xl font-bold text-primary">12.5k</div>
          <p class="text-xs text-muted-foreground">Active Users: this is a test</p>
        </Card>
      </div>
    </HeroContent>
    <HeroMedia 
      rounded="none"
      aspectRatio="auto"
      class="h-full bg-gradient-to-br from-primary/5 to-primary/10"
    >
    <img
        :src="placeholderLight"
        class="object-cover w-full h-full dark:hidden"
        alt="Enterprise"
      />
      <img
        :src="placeholderDark"
        class="object-cover w-full h-full hidden dark:block"
        alt="Enterprise"
      />
    </HeroMedia>
  </Hero> 

  <!-- Секция 2: Feature Comparison -->
  <Hero sectionKey="basic_plan" layout="split" height="nav">
    <HeroMedia 
      rounded="none"
      class="relative h-full bg-secondary/50"
    >
      <div class="absolute inset-0 bg-gradient-to-tr from-primary/20 to-primary/5" />
      <div class="relative h-full flex items-center">
        <div class="w-full max-w-2xl mx-auto grid grid-cols-2 gap-4 p-8">
          <Card class="p-6 space-y-4 bg-background/80 backdrop-blur-sm">
            <h3 class="font-semibold">Basic Plan</h3>
            <ul class="space-y-2 text-sm">
              <li class="flex items-center gap-2">
                <div class="h-2 w-2 rounded-full bg-primary" />
                <span>5 Projects</span>
              </li>
              <li class="flex items-center gap-2">
                <div class="h-2 w-2 rounded-full bg-primary" />
                <span>Basic Analytics</span>
              </li>
            </ul>
          </Card>
          <Card class="p-6 space-y-4 bg-background/80 backdrop-blur-sm">
            <h3 class="font-semibold">Pro Plan</h3>
            <ul class="space-y-2 text-sm">
              <li class="flex items-center gap-2">
                <div class="h-2 w-2 rounded-full bg-primary" />
                <span>Unlimited Projects</span>
              </li>
              <li class="flex items-center gap-2">
                <div class="h-2 w-2 rounded-full bg-primary" />
                <span>Advanced Analytics</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </HeroMedia>
    <HeroContent 
      align="left"
      padding="md"
      width="lg"
    >
      <HeroTitle>Choose Your Plan</HeroTitle>
      <HeroDescription>
        Select the perfect plan for your needs. Upgrade or downgrade at any time.
      </HeroDescription>
      <div class="mt-8 space-y-4">
        <Button class="w-full" size="lg">Start Free Trial</Button>
        <p class="text-sm text-center text-muted-foreground">No credit card required</p>
      </div>
    </HeroContent>
  </Hero>

  <!-- Секция 3: Testimonial Split -->
  <Hero sectionKey="hero_3" layout="split" height="nav">
    <HeroContent 
      align="left"
      padding="md"
      width="lg"
      class="space-y-8"
    >
      <div class="space-y-4">
        <Badge class="dark:text-secondary-foreground">Success Story</Badge>
        <blockquote class="text-2xl font-serif italic">
          "This platform has transformed how we handle our analytics. The insights we've gained are invaluable."
        </blockquote>
      </div>
      <div class="flex items-center gap-4">
        <Avatar class="h-12 w-12">
          <AvatarImage src="https://github.com/shadcn.png" />
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
        <div>
          <div class="font-semibold">Jane Cooper</div>
          <div class="text-sm text-muted-foreground">CEO at TechCorp</div>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-4">
        <Card class="p-4 text-center">
          <div class="text-2xl font-bold text-primary">250%</div>
          <p class="text-sm text-muted-foreground">ROI Increase</p>
        </Card>
        <Card class="p-4 text-center">
          <div class="text-2xl font-bold text-primary">10x</div>
          <p class="text-sm text-muted-foreground">Faster Analysis</p>
        </Card>
        <Card class="p-4 text-center">
          <div class="text-2xl font-bold text-primary">24/7</div>
          <p class="text-sm text-muted-foreground">Support</p>
        </Card>
      </div>
    </HeroContent>
    <HeroMedia 
      rounded="none"
      class="relative h-full"
    >
      <div class="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent" />
      <div class="relative h-full flex items-center justify-center p-12">
        <div class="relative w-full max-w-lg">
          <div class="absolute -inset-4 bg-primary/5 blur-2xl rounded-[2rem]" />
          <img
            :src="placeholderLight"
            class="relative dark:hidden rounded-2xl shadow-2xl"
            alt="Product Screenshot"
          />
          <img
            :src="placeholderDark"
            class="relative hidden dark:block rounded-2xl shadow-2xl"
            alt="Product Screenshot"
          />
        </div>
      </div>
    </HeroMedia>
  </Hero>
</template> 