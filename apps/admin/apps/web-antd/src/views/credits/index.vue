<script setup lang="ts">
import type {
  CreditKind,
  CreditListParams,
  CreditTransaction,
} from '#/api/core/credits';
import type { UserRecord } from '#/api/core/user-manage';

import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { debounce, formatDateTime } from '@vben/utils';

import { Button, message, Tag, Tooltip } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { getCreditTransactionsApi } from '#/api/core/credits';
import { getUserListApi } from '#/api/core/user-manage';

import RechargeModal from './components/RechargeModal.vue';
import SignInConfigModal from './components/SignInConfigModal.vue';

const route = useRoute();
const router = useRouter();
const { hasAccessByCodes } = useAccess();
const rechargeModalRef = ref<InstanceType<typeof RechargeModal>>();
const signInConfigModalRef = ref<InstanceType<typeof SignInConfigModal>>();

const kindLabels: Record<CreditKind, string> = {
  sign_in: '签到',
  recharge: '充值',
  theme_consume: 'AI换主题',
  artwork_consume: '四面平面素材',
};

const kindColors: Record<CreditKind, string> = {
  sign_in: 'blue',
  recharge: 'green',
  theme_consume: 'orange',
  artwork_consume: 'blue',
};

const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// 从生成任务详情跳转过来时带 ?jobId=，直接筛出该任务的扣费流水。
const linkedJobId =
  typeof route.query.jobId === 'string' ? route.query.jobId : undefined;

function openJob(jobId: string) {
  router.push({ path: '/generation-jobs', query: { jobId } });
}

const kindOptions = Object.entries(kindLabels).map(([value, label]) => ({
  value,
  label,
}));

// 用户下拉搜索
const userOptions = ref<{ value: string; label: string }[]>([]);
const userFetching = ref(false);

async function fetchUsers(keyword?: string) {
  userFetching.value = true;
  try {
    const res = await getUserListApi({
      page: 1,
      pageSize: 50,
      ...(keyword ? { username: keyword } : {}),
    });
    userOptions.value = res.data.map((u: UserRecord) => ({
      value: u.id,
      label: u.nickname ? `${u.nickname}（${u.username}）` : u.username,
    }));
  } finally {
    userFetching.value = false;
  }
}

const debouncedFetchUsers = debounce(fetchUsers, 300);

// 初始加载一批用户
fetchUsers();

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Select',
        fieldName: 'userId',
        label: '用户',
        componentProps: {
          options: userOptions,
          allowClear: true,
          showSearch: true,
          filterOption: false,
          loading: userFetching,
          placeholder: '搜索用户名',
          onSearch: (val: string) => debouncedFetchUsers(val),
          onFocus: () => {
            if (userOptions.value.length === 0) fetchUsers();
          },
        },
      },
      {
        component: 'Select',
        fieldName: 'kind',
        label: '类型',
        componentProps: {
          options: kindOptions,
          allowClear: true,
          placeholder: '全部',
        },
      },
      {
        component: 'Input',
        fieldName: 'jobId',
        label: '任务ID',
        defaultValue: linkedJobId,
        componentProps: { allowClear: true, placeholder: '完整的生成任务ID' },
      },
    ],
  },
  gridOptions: {
    height: 'auto',
    showOverflow: 'tooltip',
    toolbarConfig: { refresh: true },
    columns: [
      {
        field: 'createdAt',
        title: '创建时间',
        width: 170,
        slots: { default: 'createdAt' },
      },
      {
        field: 'username',
        title: '用户名',
        minWidth: 140,
        slots: { default: 'username' },
      },
      { field: 'kind', title: '类型', width: 120, slots: { default: 'kind' } },
      {
        field: 'amount',
        title: '变动数量',
        width: 120,
        slots: { default: 'amount' },
        align: 'right',
      },
      {
        field: 'jobId',
        title: '关联任务',
        width: 140,
        slots: { default: 'job' },
      },
      { field: 'note', title: '备注', minWidth: 200 },
      {
        field: 'operatorName',
        title: '操作人',
        minWidth: 140,
        slots: { default: 'operator' },
      },
    ],
    pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: {
            jobId?: string;
            kind?: CreditKind;
            userId?: string;
          } = {},
        ) => {
          const jobId = formValues.jobId?.trim();
          if (jobId && !UUID_PATTERN.test(jobId)) {
            message.warning('请输入完整的任务ID');
            return { items: [], total: 0 };
          }
          const params: CreditListParams = {
            page: page.currentPage,
            pageSize: page.pageSize,
            ...(formValues.userId ? { userId: formValues.userId } : {}),
            ...(formValues.kind ? { kind: formValues.kind } : {}),
            ...(jobId ? { jobId } : {}),
          };
          const result = await getCreditTransactionsApi(params);
          return { items: result.data, total: result.total };
        },
      },
    },
  },
});

function handleRecharge() {
  rechargeModalRef.value?.open();
}

function handleSignInConfig() {
  signInConfigModalRef.value?.open();
}

function handleReload() {
  gridApi.reload();
}
</script>

<template>
  <Page auto-content-height>
    <Grid>
      <template #toolbar-actions>
        <div class="flex gap-2">
          <Button
            v-access:code="['credits.recharge']"
            type="primary"
            @click="handleRecharge"
          >
            充值积分
          </Button>
          <Button
            v-access:code="['credits.sign_in_config']"
            @click="handleSignInConfig"
          >
            签到配置
          </Button>
        </div>
      </template>

      <template #username="{ row }">
        <span>{{
          (row as CreditTransaction).nickname ||
          (row as CreditTransaction).username ||
          (row as CreditTransaction).userId
        }}</span>
      </template>
      <template #createdAt="{ row }">
        {{ formatDateTime((row as CreditTransaction).createdAt) }}
      </template>
      <template #kind="{ row }">
        <Tag :color="kindColors[(row as CreditTransaction).kind]">
          {{
            kindLabels[(row as CreditTransaction).kind] ||
            (row as CreditTransaction).kind
          }}
        </Tag>
      </template>
      <template #job="{ row }">
        <template v-if="(row as CreditTransaction).jobId">
          <Tooltip :title="(row as CreditTransaction).jobId">
            <Button
              v-if="hasAccessByCodes(['generation.detail'])"
              type="link"
              size="small"
              class="px-0"
              @click="openJob((row as CreditTransaction).jobId!)"
            >
              {{ (row as CreditTransaction).jobId!.substring(0, 8) }}
            </Button>
            <span v-else>
              {{ (row as CreditTransaction).jobId!.substring(0, 8) }}
            </span>
          </Tooltip>
        </template>
        <span v-else class="text-gray-400">—</span>
      </template>
      <template #operator="{ row }">
        {{
          (row as CreditTransaction).operatorName ??
          (row as CreditTransaction).operatorId ??
          '—'
        }}
      </template>
      <template #amount="{ row }">
        <span
          :class="[
            (row as CreditTransaction).amount > 0 ? 'text-green-600' : '',
            (row as CreditTransaction).amount < 0 ? 'text-red-500' : '',
          ]"
        >
          {{ (row as CreditTransaction).amount > 0 ? '+' : ''
          }}{{ (row as CreditTransaction).amount }}
        </span>
      </template>
    </Grid>

    <RechargeModal ref="rechargeModalRef" @reload="handleReload" />
    <SignInConfigModal ref="signInConfigModalRef" />
  </Page>
</template>
