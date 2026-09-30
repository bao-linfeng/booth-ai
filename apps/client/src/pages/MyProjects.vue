<script setup lang="ts">
import { onMounted,reactive,ref,watch } from 'vue'
import { useRoute,useRouter } from 'vue-router'
import { ArrowLeft,ArrowRight,BriefcaseBusiness,Loader2 } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Card,CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import SelectionShell from '@/features/selection/SelectionShell.vue'
import { useAuthStore } from '@/stores/auth'
import { getMyProject,getMyProjects,statusLabels,type MyProjectDetail,type ProjectPage } from '@/services/api/projects'
const route=useRoute();const router=useRouter();const auth=useAuthStore()
const list=ref<ProjectPage>();const detail=ref<MyProjectDetail>();const loading=ref(false);const error=ref('');const page=ref(1)
const filters=reactive({projectNo:'',status:'',sourceType:'',exhibitionName:''})
const date=(value:string)=>new Date(value).toLocaleString('zh-CN')
const materialLabels:Record<string,string>={available:'已固定',pending:'待补充',missing:'暂无资料'}
async function load(next=page.value) {
  if(!auth.isLoggedIn)return
  loading.value=true;error.value='';page.value=next
  try{
    if(route.params.projectId)detail.value=await getMyProject(String(route.params.projectId))
    else list.value=await getMyProjects({...filters,page:next,pageSize:10})
  }catch(failure:unknown){const status=(failure as {response?:{status?:number}}).response?.status;error.value=status===404?'项目不存在或不属于当前账户。':'项目读取失败，请重试。'}
  finally{loading.value=false}
}
function login(){void router.push({path:'/auth/sign-in',query:{redirect:route.fullPath}})}
onMounted(()=>load())
watch(()=>route.params.projectId,()=>{detail.value=undefined;list.value=undefined;void load(1)})
</script>
<template><SelectionShell><main class="container mx-auto max-w-5xl space-y-6 px-4 py-8">
  <header class="flex flex-wrap items-center justify-between gap-4"><div class="space-y-2"><p class="text-sm text-primary">展会项目 / 申请记录</p><h1 class="text-3xl font-semibold">{{ route.params.projectId?'项目详情':'我的项目' }}</h1><p class="text-sm text-muted-foreground">查看本人提交的报价申请和人工需求，以及公开处理结果。</p></div><Button variant="outline" as-child><RouterLink :to="route.params.projectId?'/my-projects':'/ai-selection'"><ArrowLeft class="mr-2 size-4" />{{ route.params.projectId?'返回项目列表':'继续选方案' }}</RouterLink></Button></header>
  <Card v-if="!auth.isLoggedIn"><CardContent class="space-y-4 p-8"><BriefcaseBusiness class="size-8 text-primary" /><p>登录后查看您的申请记录。</p><Button @click="login">登录并返回</Button></CardContent></Card>
  <template v-else>
    <form v-if="!route.params.projectId" class="grid items-end gap-4 rounded-xl border p-5 sm:grid-cols-2 lg:grid-cols-5" @submit.prevent="load(1)">
      <div class="space-y-2"><Label for="project-number">项目编号</Label><Input id="project-number" v-model="filters.projectNo" maxlength="200" /></div>
      <div class="space-y-2"><Label for="exhibition-filter">展会名称</Label><Input id="exhibition-filter" v-model="filters.exhibitionName" maxlength="200" /></div>
      <div class="space-y-2"><Label for="status-filter">状态</Label><select id="status-filter" v-model="filters.status" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">全部状态</option><option v-for="(label,status) in statusLabels" :key="status" :value="status">{{ label }}</option></select></div>
      <div class="space-y-2"><Label for="source-filter">来源</Label><select id="source-filter" v-model="filters.sourceType" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">全部来源</option><option value="quote_request">报价申请</option><option value="manual_request">人工需求</option></select></div>
      <Button :disabled="loading" type="submit">查询项目</Button>
    </form>
    <div v-if="loading" role="status" class="flex items-center gap-3 p-6"><Loader2 class="size-5 animate-spin" />正在读取项目…</div>
    <Card v-if="error" role="alert"><CardContent class="space-y-3 p-6"><p class="text-destructive">{{ error }}</p><Button variant="outline" @click="load()">重新加载</Button></CardContent></Card>
    <template v-if="!route.params.projectId && list && !error">
      <Card v-if="!list.items.length"><CardContent class="space-y-3 p-8"><BriefcaseBusiness class="size-8 text-muted-foreground" /><h2 class="text-lg font-medium">暂无符合条件的项目</h2><p class="text-sm text-muted-foreground">您提交报价申请或人工需求后，项目会出现在这里。</p><Button as-child><RouterLink to="/ai-selection">开始选方案</RouterLink></Button></CardContent></Card>
      <RouterLink v-for="project in list.items" :key="project.projectId" :to="`/my-projects/${project.projectId}`" class="block rounded-xl border p-5 transition-colors hover:bg-muted/40">
        <div class="flex items-center justify-between gap-3"><span class="font-mono text-base font-semibold">{{ project.projectNo }}</span><span class="rounded-full bg-muted px-3 py-1 text-xs">{{ statusLabels[project.status] }}</span></div>
        <h2 class="mt-3 text-lg font-medium">{{ project.exhibition?.name ?? '历史人工需求' }}</h2><p class="mt-2 text-sm text-muted-foreground">{{ project.sourceType==='quote_request'?'报价申请':'人工需求' }} · {{ project.schemeCode ?? '尚未关联方案' }} · {{ project.exhibition?.city }}</p>
        <div class="mt-4 flex justify-between text-xs text-muted-foreground"><span>更新于 {{ date(project.updatedAt) }}</span><span class="flex items-center gap-1">查看公开进展<ArrowRight class="size-3" /></span></div>
      </RouterLink>
      <div class="flex items-center justify-between"><span class="text-sm text-muted-foreground">共 {{ list.total }} 个项目 · 第 {{ page }} 页</span><div class="flex gap-2"><Button variant="outline" :disabled="page===1 || loading" @click="load(page-1)">上一页</Button><Button variant="outline" :disabled="page*10>=list.total || loading" @click="load(page+1)">下一页</Button></div></div>
    </template>
    <template v-if="route.params.projectId && detail && !error">
      <Card><CardContent class="space-y-5 p-6"><div class="flex flex-wrap justify-between gap-3"><span class="font-mono text-lg">{{ detail.projectNo }}</span><span class="text-sm font-medium text-primary">{{ statusLabels[detail.status] }}</span></div>
        <h2 class="text-2xl font-semibold">{{ detail.request.exhibition?.name ?? '历史人工需求' }}</h2><dl class="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt class="text-muted-foreground">展会地点</dt><dd>{{ detail.request.exhibition?.countryCode }} / {{ detail.request.exhibition?.city ?? '待补充' }}</dd></div><div><dt class="text-muted-foreground">展会日期</dt><dd>{{ detail.request.exhibition?.startDate ?? '待补充' }} — {{ detail.request.exhibition?.endDate }}</dd></div>
          <div><dt class="text-muted-foreground">客户 / 联系人</dt><dd>{{ detail.request.company }} / {{ detail.request.contact.name }}</dd></div><div><dt class="text-muted-foreground">联系方式</dt><dd>{{ detail.request.contact.email }} {{ detail.request.contact.phone }} {{ detail.request.contact.legacyDetail }}</dd></div>
          <div><dt class="text-muted-foreground">材料预算</dt><dd>{{ detail.request.materialBudget ? `${detail.request.materialBudget.currency} ${detail.request.materialBudget.amount}`:'待补充' }}</dd></div><div><dt class="text-muted-foreground">申请时间</dt><dd>{{ date(detail.createdAt) }}</dd></div>
        </dl><p class="whitespace-pre-wrap text-sm">{{ detail.request.originalDescription ?? detail.request.notes }}</p><p class="text-sm">需求范围：{{ detail.request.scopeCodes.join('、') }} {{ detail.request.scopeNotes }}</p>
        <details v-if="detail.request.confirmedRequirements" class="text-sm"><summary class="cursor-pointer text-muted-foreground">查看已提交的确认条件</summary><pre class="mt-3 whitespace-pre-wrap text-xs">{{ JSON.stringify(detail.request.confirmedRequirements,null,2) }}</pre></details>
      </CardContent></Card>
      <Card><CardContent class="space-y-4 p-6"><h2 class="text-lg font-medium">方案与资料摘要</h2><p v-if="detail.schemeSnapshot">{{ detail.schemeSnapshot.code }} / {{ detail.schemeSnapshot.name }} · 固定修订 {{ detail.schemeSnapshot.revision }}</p><p v-else class="text-sm text-muted-foreground">尚未关联方案，管理人员将与您沟通确认。</p>
        <img v-if="detail.selectedThemeSummary" :src="detail.selectedThemeSummary.previewUrl" alt="本项目固定的选定主题效果" class="max-h-80 w-full rounded-lg object-contain" />
        <div class="grid gap-3 sm:grid-cols-3"><div v-for="(value,type) in detail.materialsStatus" :key="type" class="rounded-md bg-muted p-4 text-sm">{{ {bom:'清单',drawings:'图纸',artworks:'平面素材'}[type] }}：{{ materialLabels[value] ?? value }}</div></div>
        <p class="text-xs text-muted-foreground">此处展示申请时固定的资料状态，历史原件由管理人员按项目交付。</p>
      </CardContent></Card><Card><CardContent class="space-y-3 p-6"><h2 class="text-lg font-medium">公开处理结果</h2><p class="whitespace-pre-wrap text-sm">{{ detail.publicResult ?? '管理人员正在处理，尚未发布结果。' }}</p><p class="text-xs text-muted-foreground">最近更新：{{ date(detail.updatedAt) }}</p><Button variant="outline" @click="load()">刷新进展</Button></CardContent></Card>
    </template>
  </template>
</main></SelectionShell></template>
