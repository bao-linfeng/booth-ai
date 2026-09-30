<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Page } from '@vben/common-ui';
import { formatDateTime } from '@vben/utils';
import { Button,Tag } from 'ant-design-vue';
import { useVbenVxeGrid } from '#/adapter/vxe-table';
import { listProjectsApi,statusLabels,type Project,type ProjectQuery } from '#/api/core/projects';
const router=useRouter();
const [Grid]=useVbenVxeGrid({formOptions:{schema:[
  {component:'Input',fieldName:'projectNo',label:'项目编号'},{component:'Input',fieldName:'schemeCode',label:'方案编号'},
  {component:'Input',fieldName:'customerName',label:'客户/联系人'},{component:'Input',fieldName:'exhibitionName',label:'展会'},
  {component:'Input',fieldName:'city',label:'城市'},{component:'Select',fieldName:'status',label:'处理状态',componentProps:{allowClear:true,options:Object.entries(statusLabels).map(([value,label])=>({value,label}))}},
  {component:'Select',fieldName:'sourceType',label:'来源',componentProps:{allowClear:true,options:[{value:'quote_request',label:'报价申请'},{value:'manual_request',label:'人工需求'}]}},
]},gridOptions:{height:'auto',showOverflow:'tooltip',toolbarConfig:{refresh:true},pagerConfig:{enabled:true,currentPage:1,pageSize:20},columns:[
  {field:'projectNo',title:'项目编号',minWidth:160},{field:'sourceType',title:'来源',width:110,slots:{default:'source'}},
  {field:'schemeCode',title:'方案编号',minWidth:150},{field:'request.contact.name',title:'联系人',minWidth:120},{field:'request.company',title:'企业',minWidth:160},
  {field:'request.exhibition.name',title:'展会',minWidth:180},{field:'request.exhibition.city',title:'城市',minWidth:100},
  {field:'budget',title:'材料预算',minWidth:140,slots:{default:'budget'}},{field:'assigneeName',title:'承接人',minWidth:120},
  {field:'status',title:'状态',width:110,slots:{default:'status'}},{field:'updatedAt',title:'更新时间',minWidth:180,slots:{default:'updated'}},
  {field:'action',title:'操作',width:100,fixed:'right',slots:{default:'action'}},
],proxyConfig:{ajax:{query:async({page}:{page:{currentPage:number;pageSize:number}},values:ProjectQuery={})=>{
  return listProjectsApi({...values,page:page.currentPage,pageSize:page.pageSize});
}}}}});
</script>
<template><Page auto-content-height title="项目承接" description="报价申请与人工需求统一受理、分配和跟进"><Grid>
  <template #source="{row}">{{ (row as Project).sourceType==='quote_request'?'报价申请':'人工需求' }}</template>
  <template #budget="{row}">{{ (row as Project).request.materialBudget ? `${(row as Project).request.materialBudget?.currency} ${(row as Project).request.materialBudget?.amount}`:'待补' }}</template>
  <template #status="{row}"><Tag>{{ statusLabels[(row as Project).status] }}</Tag></template>
  <template #updated="{row}">{{ formatDateTime((row as Project).updatedAt) }}</template>
  <template #action="{row}"><Button type="link" @click="router.push(`/projects/${(row as Project).projectId}`)">处理项目</Button></template>
</Grid></Page></template>
