<script setup lang="ts">
import { MainNavigation } from '@/components/sections/navbar'
import { BlogGrid, BlogCard } from '@/components/sections/blog'
import { Container } from '@/components/layout'

const posts = [
  {
    title: 'Building Modern Web Applications',
    description: 'Learn how to create scalable and maintainable web applications using the latest technologies.',
    category: 'Development',
    date: '2024-03-15',
    href: '#'
  },
  {
    title: 'The Future of AI',
    description: 'Exploring the latest advancements in artificial intelligence and machine learning.',
    category: 'Technology',
    date: '2024-03-14',
    href: '#'
  },
  {
    title: 'Design Systems Evolution',
    description: 'How design systems are changing the way we build and maintain user interfaces.',
    category: 'Design',
    date: '2024-03-13',
    href: '#'
  },
  {
    title: 'The Future of Web Development',
    description: 'Exploring the latest trends in web development and where it is going.',
    category: 'Development',
    date: '2024-03-12',
    href: '#'
  }
]
</script>

<template>
  <MainNavigation />
  <Container>
    <div class="my-16" />
    <h2 class="text-2xl font-bold mb-4">Grid Layout</h2>
    <!-- Grid Layout -->
    <BlogGrid 
      class="min-h-[45vh] mb-16"
    >
      <BlogCard
        v-for="post in posts.slice(0, 3)"
        :key="post.title"
        v-bind="post"
      />
    </BlogGrid>

    <div class="mb-16" />
    <h2 class="text-2xl font-bold mb-4">Featured Layout</h2>
    <!-- Featured Layout -->
    <BlogGrid 
      :columns="2" 
      class="min-h-[40vh] mb-16"
      layout="featured"
    >
      <BlogCard
        v-for="post in posts.slice(0, 2)"
        :key="post.title"
        v-bind="post"
      />
    </BlogGrid>

    <div class="mb-32">
      <h2 class="text-2xl font-bold mb-4">Single Column Layout</h2>
      <!-- Single Column Layout -->
      <BlogGrid 
        :columns="4"
        class="min-h-[50vh]"
    >
      <BlogCard
        v-for="post in posts"
        :key="post.title"
        v-bind="post"
      />
      </BlogGrid>
    </div>
  </Container>
</template> 