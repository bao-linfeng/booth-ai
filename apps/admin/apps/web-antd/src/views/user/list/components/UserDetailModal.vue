<script setup lang="ts">
import type { CreditTransaction } from '#/api/core/credits';
import type { UserRecord } from '#/api/core/user-manage';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';

import {
  Descriptions,
  DescriptionsItem,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  getCreditTransactionsApi,
  getUserCreditBalanceApi,
} from '#/api/core/credits';
import { getUserDetailApi } from '#/api/core/user-manage';

const currentUserId = ref('');
const currentUser = ref<null | UserRecord>(null);
const currentBalance = ref<null | number>(null);
const activeTab = ref('info');

const [Modal, modalApi] = useVbenModal({ footer: false });

const [CreditGrid, creditGridApi] = useVbenVxeGrid<CreditTransaction>({
  gridOptions: {
    showOverflow: 'tooltip' as const,
    height: 380,
    toolbarConfig: { custom: false, refresh: false, zoom: false },
    columns: [
      { field: 'kind', title: '类型', width: 140, slots: { default: 'kind' } },
      {
        field: 'amount',
        title: '金额',
        width: 120,
        slots: { default: 'amount' },
      },
      { field: 'note', title: '备注', minWidth: 160 },
      { field: 'createdAt', title: '时间', width: 180 },
    ],
    pagerConfig: { total: 0, currentPage: 1, pageSize: 10, enabled: true },
    proxyConfig: {
      enabled: true,
      autoLoad: true,
      ajax: {
        query: async ({
          page,
        }: {
          page: { currentPage: number; pageSize: number };
        }) => {
          if (!currentUserId.value) return { items: [], total: 0 };
          const result = await getCreditTransactionsApi({
            page: page.currentPage,
            pageSize: page.pageSize,
            userId: currentUserId.value,
          });
          return { items: result.data, total: result.total };
        },
      },
    },
  },
});

const open = async (userId: string) => {
  currentUserId.value = userId;
  currentUser.value = null;
  currentBalance.value = null;
  activeTab.value = 'info';
  creditGridApi.setGridOptions({ pagerConfig: { currentPage: 1 } });

  modalApi.open();
  modalApi.setState({ title: '用户详情', confirmLoading: true });

  try {
    const [detail, balance] = await Promise.all([
      getUserDetailApi(userId),
      getUserCreditBalanceApi(userId),
    ]);
    currentUser.value = detail;
    currentBalance.value = balance.balance;
  } finally {
    modalApi.setState({ confirmLoading: false });
  }
};

defineExpose({ open });

const kindMap: Record<string, string> = {
  artwork_consume: '消耗(方案)',
  recharge: '充值',
  sign_in: '签到',
  theme_consume: '消耗(主题)',
};
</script>

<template>
  <Modal class="w-[760px]">
    <div v-if="!currentUser" class="py-12 text-center text-gray-500">
      加载中...
    </div>
    <div v-else class="mt-2">
      <Tabs v-model:active-key="activeTab">
        <TabPane key="info" tab="基本信息">
          <div class="py-2">
            <Descriptions :column="2" bordered size="small">
              <DescriptionsItem label="用户名">
                {{ currentUser.username || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="昵称">
                {{ currentUser.nickname || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="手机号">
                {{ currentUser.mobile || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="邮箱">
                {{ currentUser.email || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="公司">
                {{ currentUser.company || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="国家/城市">
                {{
                  [currentUser.country, currentUser.city]
                    .filter(Boolean)
                    .join(' / ') || '-'
                }}
              </DescriptionsItem>
              <DescriptionsItem label="当前积分">
                <span class="text-lg font-bold text-green-600">{{
                  currentBalance ?? '-'
                }}</span>
              </DescriptionsItem>
              <DescriptionsItem label="状态">
                <Tag :color="currentUser.enabled ? 'success' : 'error'">
                  {{ currentUser.enabled ? '正常' : '禁用' }}
                </Tag>
              </DescriptionsItem>
              <DescriptionsItem label="最后登录">
                {{ currentUser.lastLoginAt || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="创建时间">
                {{ currentUser.createdAt || '-' }}
              </DescriptionsItem>
            </Descriptions>
          </div>
        </TabPane>

        <TabPane key="credits" tab="积分流水">
          <div class="h-[380px] py-2">
            <CreditGrid :key="currentUserId">
              <template #kind="{ row }">
                {{ kindMap[row.kind] || row.kind }}
              </template>
              <template #amount="{ row }">
                <span
                  :class="row.amount > 0 ? 'text-green-600' : 'text-red-500'"
                >
                  {{ row.amount > 0 ? '+' : '' }}{{ row.amount }}
                </span>
              </template>
            </CreditGrid>
          </div>
        </TabPane>
      </Tabs>
    </div>
  </Modal>
</template>
