<script setup lang="ts">
import type {
  CreditKind,
  CreditListParams,
  CreditTransaction,
} from '#/api/core/credits';
import type { UserRecord } from '#/api/core/user-manage';

import { ref } from 'vue';

import { Page } from '@vben/common-ui';
import { debounce, formatDateTime } from '@vben/utils';

import { Button, Tag } from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { getCreditTransactionsApi } from '#/api/core/credits';
import { getUserListApi } from '#/api/core/user-manage';

import RechargeModal from './components/RechargeModal.vue';

const rechargeModalRef = ref<InstanceType<typeof RechargeModal>>();

const kindLabels: Record<CreditKind, string> = {
  sign_in: '签到',
  recharge: '充值',
  theme_consume: 'AI换主题',
};

const kindColors: Record<CreditKind, string> = {
  sign_in: 'blue',
  recharge: 'green',
  theme_consume: 'orange',
};

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
      { field: 'note', title: '备注', minWidth: 200 },
      { field: 'operatorId', title: '操作人', minWidth: 200 },
    ],
    pagerConfig: { total: 0, currentPage: 1, pageSize: 20, enabled: true },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: { userId?: string; kind?: CreditKind } = {},
        ) => {
          const params: CreditListParams = {
            page: page.currentPage,
            pageSize: page.pageSize,
            ...(formValues.userId ? { userId: formValues.userId } : {}),
            ...(formValues.kind ? { kind: formValues.kind } : {}),
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

function handleReload() {
  gridApi.reload();
}
</script>

<template>
  <Page auto-content-height title="积分流水">
    <Grid>
      <template #toolbar-actions>
        <div class="flex gap-2">
          <Button type="primary" @click="handleRecharge">充值积分</Button>
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
  </Page>
</template>
