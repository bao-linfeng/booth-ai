<script setup lang="ts">
import { MainNavigation } from '@/components/sections/navbar'
import { BlogGrid, BlogCardHorizontal } from '@/components/sections/blog'
import { Container } from '@/components/layout'

const placeholderLight = 'https://images.unsplash.com/photo-1542125387-c71274d94f0a?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=560&q=80'
const placeholderDark = 'https://images.unsplash.com/photo-1542125387-c71274d94f0a?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=560&q=80'

const posts = [
  {
    title: 'Building Modern Web Applications',
    description: 'Learn how to create scalable and maintainable web applications using the latest technologies.',
    category: 'Development',
    date: '2024-03-15',
    href: '#',
    imageLight: placeholderLight,
    imageDark: placeholderDark
  },
  {
    title: 'The Future of AI',
    description: 'Exploring the latest advancements in artificial intelligence and machine learning.',
    category: 'Technology',
    date: '2024-03-14',
    href: '#',
    imageLight: placeholderLight,
    imageDark: placeholderDark
  }
]
</script>

<template>
  <MainNavigation />
  <Container>
    <div class="mt-16" />
    <h2 class="text-2xl font-bold mb-8">Square Images Layout</h2>
    <!-- Square Images Layout -->
    <BlogGrid layout="horizontal" :columns="2">
      <BlogCardHorizontal
        v-for="post in posts"
        :key="post.title"
        v-bind="post"
        :imageProps="{
          rounded: true,
          shadow: true,
          aspectRatio: 'square'
        }"
        :badgeProps="{
          show: false
        }"
      />
    </BlogGrid>
    
    <div class="mt-16" />
    <h2 class="text-2xl font-bold mb-8">Full Height Images Layout</h2>
    <!-- Full Height Images Layout -->
    <BlogGrid layout="horizontal" :columns="2">
      <BlogCardHorizontal
        v-for="post in posts"
        :key="post.title"
        v-bind="post"
        :imageProps="{
          rounded: true,
          shadow: true,
          aspectRatio: 'square'
        }"
        :badgeProps="{
          variant: 'outline',
          size: 'sm',
          show: true
        }"
      />
    </BlogGrid>

    <div class="mt-16" />
    <h2 class="text-2xl font-bold mb-8">Rounded Images Layout with Glow Effect</h2>
    <!-- Rounded Images Layout with Glow Effect -->
    <BlogGrid layout="horizontal" :columns="2">
      <BlogCardHorizontal
        v-for="post in posts"
        :key="post.title"
        v-bind="post"
        :imageProps="{
          rounded: true,
          aspectRatio: 'square'
        }"
        :badgeProps="{
          variant: 'outline',
          size: 'sm',
          show: true
        }"
        class="rounded-xl border-glow shadow-sm hover:shadow-lg p-4 md:p-6"
      />
    </BlogGrid>

    <div class="my-16">
    <h2 class="text-2xl font-bold mb-8">Rounded Images Layout with Glow Effect Animation</h2>
    <!-- Rounded Images Layout with Glow Effect Animation -->
    <BlogGrid layout="horizontal" :columns="2">
  <BlogCardHorizontal
    v-for="post in posts"
    :key="post.title"
    v-bind="post"
    :imageProps="{
      rounded: true,
      aspectRatio: 'square'
    }"
    :badgeProps="{
      variant: 'outline',
      size: 'sm',
      show: true
      }"
        class="rounded-xl border-glow-animated shadow-sm hover:shadow-lg p-4 md:p-6"
      />
    </BlogGrid>
    </div>
  </Container>
</template>