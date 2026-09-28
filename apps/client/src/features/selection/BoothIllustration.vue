<script setup lang="ts">
import { useId } from 'vue'
withDefaults(defineProps<{ variant?: number; view?: number }>(), { variant: 0, view: 0 })
const gridId = useId()
</script>

<template>
  <svg viewBox="0 0 960 540" role="img" aria-label="展位空间示意图，非真实方案效果图" class="booth-illustration">
    <defs>
      <pattern :id="gridId" width="48" height="27" patternUnits="userSpaceOnUse"><path d="M 48 0 L 0 0 0 27" fill="none" stroke="currentColor" stroke-width=".5" opacity=".1" /></pattern>
    </defs>
    <rect width="960" height="540" fill="hsl(var(--muted))" />
    <rect width="960" height="540" :fill="`url(#${gridId})`" />
    <g :transform="view === 1 ? 'translate(930 0) scale(-1 1)' : view === 2 ? 'translate(65 20) scale(.87)' : ''" stroke-linejoin="round">
      <path d="M145 362 490 187 844 353 502 527Z" fill="hsl(var(--foreground) / .08)" />
      <path d="M124 337 464 168 826 332 487 503Z" fill="hsl(var(--background))" stroke="hsl(var(--border))" stroke-width="2" />
      <path d="M124 337V347L487 513V503Z" fill="hsl(var(--muted-foreground) / .3)" />
      <path d="M487 503 826 332V342L487 513Z" fill="hsl(var(--muted-foreground) / .18)" />
      <path d="M153 325V115L467 36V182Z" fill="hsl(var(--primary) / .88)" />
      <path d="M467 36 796 176V320L467 182Z" fill="hsl(var(--primary) / .65)" />
      <path d="M153 115 467 36 796 176 779 185 465 53 170 129Z" fill="hsl(var(--primary))" />
      <path d="M171 317V149L449 80V187Z" fill="hsl(var(--background) / .92)" />
      <path d="M488 84 757 198V311L488 198Z" fill="hsl(var(--background) / .93)" />
      <path d="M507 120 640 177V249L507 193Z" fill="hsl(var(--primary) / .16)" />
      <path d="M518 131 629 178V228L518 183Z" fill="hsl(var(--primary) / .75)" />
      <path d="M202 163 348 126" stroke="hsl(var(--primary))" stroke-width="9" />
      <path d="M202 184 305 158" stroke="hsl(var(--muted-foreground) / .35)" stroke-width="3" />
      <path d="M202 201 326 170" stroke="hsl(var(--muted-foreground) / .22)" stroke-width="3" />
      <g v-if="variant !== 2">
        <path d="M260 275 347 234 414 264 327 307Z" fill="hsl(var(--background))" stroke="hsl(var(--border))" />
        <path d="M260 275V343L327 375V307Z" fill="hsl(var(--primary) / .75)" />
        <path d="M327 307 414 264V330L327 375Z" fill="hsl(var(--primary) / .45)" />
        <path d="M275 295 310 311" stroke="hsl(var(--primary-foreground))" stroke-width="4" />
      </g>
      <g v-else>
        <path d="M246 232 354 183 425 214 318 267Z" fill="hsl(var(--background))" />
        <path d="M246 232V346L318 378V267Z" fill="hsl(var(--primary) / .65)" />
        <path d="M318 267 425 214V325L318 378Z" fill="hsl(var(--primary) / .3)" />
      </g>
      <ellipse cx="553" cy="337" rx="75" ry="32" fill="hsl(var(--foreground) / .08)" />
      <path d="M551 310V367M508 371 551 349 590 367" stroke="hsl(var(--muted-foreground))" stroke-width="5" />
      <ellipse cx="551" cy="303" rx="65" ry="27" fill="hsl(var(--background))" stroke="hsl(var(--border))" stroke-width="2" />
      <path d="M460 321V368M460 340 482 350V385M605 321V369M605 339 625 349V385" fill="none" stroke="hsl(var(--primary) / .6)" stroke-width="7" />
      <path d="M687 289 716 301 710 348 692 340Z" fill="hsl(var(--muted-foreground) / .3)" />
      <path d="M702 305V240M702 285Q670 251 686 239M702 270Q732 252 724 231M702 261Q685 229 702 213" fill="none" stroke="hsl(var(--primary))" stroke-width="9" stroke-linecap="round" />
      <path d="M153 115V325M467 36V182M796 176V320" stroke="hsl(var(--background) / .6)" stroke-width="4" />
    </g>
    <text x="30" y="505" font-size="11" letter-spacing="3" fill="hsl(var(--muted-foreground))">SPATIAL STUDY / {{ String(variant + 1).padStart(2, '0') }}</text>
    <text x="930" y="505" text-anchor="end" font-size="12" fill="hsl(var(--muted-foreground))">空间示意 · 非真实效果图</text>
  </svg>
</template>
