<script setup lang="ts">
import type { SchemeSearchStatistics } from '#/api/core/scheme-searches';

import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

import { Alert, Button, Card, Skeleton } from 'ant-design-vue';

import { getSchemeSearchStatisticsApi } from '#/api/core/scheme-searches';

const router = useRouter();
const statistics = ref<SchemeSearchStatistics>();
const loading = ref(false);
const failed = ref(false);

async function load() {
  if (loading.value) return;
  loading.value = true;
  failed.value = false;
  statistics.value = undefined;
  try {
    statistics.value = await getSchemeSearchStatisticsApi();
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Card title="AI 智选概览">
    <template #extra>
      <Button size="small" :loading="loading" @click="load">
        刷新智选统计
      </Button>
    </template>
    <Alert
      v-if="failed"
      type="error"
      show-icon
      message="智选统计加载失败"
      description="请点击“刷新智选统计”重试。"
    />
    <Skeleton v-else-if="loading" active />
    <template v-else-if="statistics">
      <dl class="mb-0 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <div>
          <dt class="text-muted-foreground text-sm">累计检索</dt>
          <dd class="mb-0 mt-2 text-2xl font-semibold tabular-nums">
            {{ statistics.overview.searches.toLocaleString() }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm">独立访客</dt>
          <dd class="mb-0 mt-2 text-2xl font-semibold tabular-nums">
            {{ statistics.overview.uniqueVisitors.toLocaleString() }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm">命中检索</dt>
          <dd class="mb-0 mt-2 text-2xl font-semibold tabular-nums">
            {{ statistics.overview.matchedSearches.toLocaleString() }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-sm">无匹配检索</dt>
          <dd class="mb-0 mt-2 text-2xl font-semibold tabular-nums">
            {{ statistics.overview.noMatchSearches.toLocaleString() }}
          </dd>
        </div>
      </dl>
      <p class="text-muted-foreground mb-0 mt-5 text-sm">
        统计范围：全部已记录的智选检索。
        <RouterLink
          v-if="router.hasRoute('AiSelectionAnalytics')"
          :to="{ name: 'AiSelectionAnalytics' }"
          class="text-primary underline underline-offset-4"
        >
          查看趋势与统计
        </RouterLink>
      </p>
    </template>
  </Card>
</template>
