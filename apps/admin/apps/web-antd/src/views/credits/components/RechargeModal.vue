<script setup lang="ts">
import type { RechargeParams } from '#/api/core/credits';
import type { UserRecord } from '#/api/core/user-manage';

import { ref } from 'vue';

import { useVbenModal } from '@vben/common-ui';
import { debounce } from '@vben/utils';

import { message } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { rechargeCreditApi } from '#/api/core/credits';
import { getUserListApi } from '#/api/core/user-manage';

const emit = defineEmits(['reload']);

const userOptions = ref<{ value: string; label: string }[]>([]);
const userFetching = ref(false);

const fetchUsers = async (keyword?: string) => {
  userFetching.value = true;
  try {
    const params: any = { page: 1, pageSize: 50 };
    if (keyword) {
      params.username = keyword;
    }
    const res = await getUserListApi(params);
    userOptions.value = (res.data || []).map((u: UserRecord) => ({
      value: u.id,
      label: u.nickname ? `${u.nickname}（${u.username}）` : u.username,
    }));
  } catch (error) {
    console.error('Fetch users failed', error);
  } finally {
    userFetching.value = false;
  }
};

const debouncedFetchUsers = debounce(fetchUsers, 300);

const [RechargeForm, formApi] = useVbenForm({
  handleSubmit: async (values: Record<string, any>) => {
    try {
      modalApi.setState({ confirmLoading: true });
      const payload: RechargeParams = {
        userId: values.userId,
        amount: values.amount,
        note: values.note,
      };
      await rechargeCreditApi(payload);
      message.success('充值成功');
      emit('reload');
      modalApi.close();
    } catch (error) {
      console.error(error);
      // HTTP request errors are generally handled by request interceptors, but we catch it just in case
      message.error('充值失败');
    } finally {
      modalApi.setState({ confirmLoading: false });
    }
  },
  schema: [
    {
      component: 'Select',
      fieldName: 'userId',
      label: '用户',
      rules: 'required',
      componentProps: {
        allowClear: true,
        showSearch: true,
        filterOption: false,
        placeholder: '搜索用户名',
        options: userOptions,
        loading: userFetching,
        onSearch: (val: string) => debouncedFetchUsers(val),
        onFocus: () => {
          if (userOptions.value.length === 0) fetchUsers();
        },
        class: 'w-full',
      },
    },
    {
      component: 'InputNumber',
      fieldName: 'amount',
      label: '充值额度',
      rules: 'required',
      componentProps: {
        min: 1,
        max: 2_147_483_647,
        precision: 0,
        placeholder: '请输入正整数',
        class: 'w-full',
      },
    },
    {
      component: 'Textarea',
      fieldName: 'note',
      label: '备注',
      componentProps: { placeholder: '选填', rows: 3 },
    },
  ],
  showDefaultActions: false,
  wrapperClass: 'grid-cols-1',
});

const [Modal, modalApi] = useVbenModal({
  onConfirm: async () => {
    await formApi.validateAndSubmitForm();
  },
  onCancel: () => {
    modalApi.close();
  },
  title: '充值积分',
});

const open = () => {
  modalApi.open();
  formApi.resetForm();
  fetchUsers();
};

defineExpose({ open });
</script>

<template>
  <Modal class="w-120">
    <RechargeForm />
  </Modal>
</template>
