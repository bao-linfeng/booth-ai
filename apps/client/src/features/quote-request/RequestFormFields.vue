<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DatePickerInput from '@/components/ui/DatePickerInput.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { getScopeOptions } from '@/features/projects/labels'
import type { RequestForm } from './form'
import type { RequestFieldErrors } from './useRequestValidation'
import { useLocationOptions } from './useLocationOptions'

// 展会信息、范围预算、联系人三段公共表单；form 是草稿中的响应式对象，直接原地编辑
const props = defineProps<{ form: RequestForm; errors: RequestFieldErrors; frozen: boolean; loggedIn: boolean }>()
const { t } = useI18n()
const scopes = computed(() => getScopeOptions(t))
const currencies = ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'KRW', 'KWD']
const { countryOptions, cityOptions, loadingCountries, loadingCities, countriesFailed, citiesFailed, loadCountries, loadCities } = useLocationOptions(props.form)
const cityEmpty = computed(() => !!props.form.countryCode && !loadingCities.value && !citiesFailed.value && !cityOptions.value.length)
/** 字段的错误提示属性：出错时标记 aria-invalid 并关联错误文本 */
const invalid = (message: string, id: string) => message ? { 'aria-invalid': true, 'aria-describedby': id } : {}
</script>

<template>
  <section><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.section1') }}</CardTitle></CardHeader><CardContent class="grid gap-5 sm:grid-cols-2">
    <div class="space-y-2 sm:col-span-2"><Label for="exhibition">{{ t('quoteRequest.exhibitionName') }}</Label><Input id="exhibition" v-model="form.exhibitionName" required maxlength="200" v-bind="invalid(errors.exhibitionName, 'request-exhibition-error')" /><p v-if="errors.exhibitionName" id="request-exhibition-error" role="alert" class="text-sm text-destructive">{{ errors.exhibitionName }}</p></div>
    <!-- 国家代码 -->
    <div class="space-y-2">
      <Label for="country">{{ t('quoteRequest.countryCode') }}</Label>
      <Select
        :model-value="form.countryCode"
        :disabled="loadingCountries || frozen"
        required
        @update:model-value="form.countryCode = $event"
      >
        <SelectTrigger id="country" class="w-full" v-bind="invalid(errors.countryCode, 'request-country-error')">
          <SelectValue :placeholder="loadingCountries ? t('quoteRequest.countryLoading') : t('quoteRequest.countryPlaceholder')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="item in countryOptions"
            :key="item.dictKey"
            :value="item.dictKey"
          >
            {{ item.dictKey }} · {{ item.dictValue }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="errors.countryCode" id="request-country-error" role="alert" class="text-sm text-destructive">{{ errors.countryCode }}</p>
      <p v-if="countriesFailed" class="flex flex-wrap items-center gap-2 text-sm text-destructive">{{ t('quoteRequest.countryLoadFailed') }}<Button type="button" variant="link" size="sm" class="h-auto p-0" :disabled="frozen" @click="loadCountries()">{{ t('quoteRequest.retryLoad') }}</Button></p>
    </div>

    <!-- 城市 -->
    <div class="space-y-2">
      <Label for="city">{{ t('quoteRequest.cityLabel') }}</Label>
      <Select
        :model-value="form.city"
        :disabled="!form.countryCode || loadingCities || frozen"
        required
        @update:model-value="form.city = $event"
      >
        <SelectTrigger id="city" class="w-full" v-bind="invalid(errors.city, 'request-city-error')">
          <SelectValue :placeholder="loadingCities ? t('quoteRequest.countryLoading') : (form.countryCode ? t('quoteRequest.cityLoadingOrSelect') : t('quoteRequest.cityWaitCountry'))" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="item in cityOptions"
            :key="item.dictValue"
            :value="item.dictValue"
          >
            {{ item.dictValue }}
          </SelectItem>
        </SelectContent>
      </Select>
      <p v-if="errors.city" id="request-city-error" role="alert" class="text-sm text-destructive">{{ errors.city }}</p>
      <p v-if="citiesFailed" class="flex flex-wrap items-center gap-2 text-sm text-destructive">{{ t('quoteRequest.cityLoadFailed') }}<Button type="button" variant="link" size="sm" class="h-auto p-0" :disabled="frozen" @click="loadCities()">{{ t('quoteRequest.retryLoad') }}</Button></p>
      <p v-else-if="cityEmpty" class="text-sm text-muted-foreground">{{ t('quoteRequest.cityEmpty') }}</p>
    </div>
    <div class="space-y-2"><Label for="request-start-date">{{ t('quoteRequest.startDate') }}</Label><DatePickerInput id="request-start-date" v-model="form.startDate" :placeholder="t('quoteRequest.startDatePlaceholder')" required :aria-invalid="!!errors.startDate" :aria-describedby="errors.startDate ? 'request-start-date-error' : undefined" /><p v-if="errors.startDate" id="request-start-date-error" role="alert" class="text-sm text-destructive">{{ errors.startDate }}</p></div>
    <div class="space-y-2"><Label for="request-end-date">{{ t('quoteRequest.endDate') }}</Label><DatePickerInput id="request-end-date" v-model="form.endDate" :min="form.startDate" :placeholder="t('quoteRequest.endDatePlaceholder')" required :aria-invalid="!!errors.endDate" :aria-describedby="errors.endDate ? 'request-end-date-error' : undefined" /><p v-if="errors.endDate" id="request-end-date-error" role="alert" class="text-sm text-destructive">{{ errors.endDate }}</p></div>
  </CardContent></section>
  <section><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.section2') }}</CardTitle></CardHeader><CardContent class="space-y-5">
    <div class="space-y-2"><p id="request-scopes-label" class="text-sm font-medium">{{ t('quoteRequest.scopeLabel') }}</p><div id="request-scopes" role="group" aria-labelledby="request-scopes-label" :aria-describedby="errors.scope ? 'request-scopes-error' : undefined" class="flex flex-wrap gap-4"><label v-for="scope in scopes" :key="scope.code" class="flex items-center gap-2 text-sm cursor-pointer"><Checkbox :checked="form.scopeCodes.includes(scope.code)" :aria-invalid="!!errors.scope" :aria-describedby="errors.scope ? 'request-scopes-error' : undefined" @update:checked="(v) => { if (v) form.scopeCodes.push(scope.code); else form.scopeCodes = form.scopeCodes.filter(c => c !== scope.code) }" />{{ scope.label }}</label></div><p v-if="errors.scope" id="request-scopes-error" role="alert" class="text-sm text-destructive">{{ errors.scope }}</p></div>
    <div class="space-y-2"><Label for="scope">{{ t('quoteRequest.scopeNote') }}{{ form.scopeCodes.includes('other') ? ' *' : '' }}</Label><Textarea id="scope" v-model="form.scopeNotes" :required="form.scopeCodes.includes('other')" maxlength="2000" :aria-invalid="!!errors.scopeNotes" :aria-describedby="errors.scopeNotes ? 'request-scope-notes-error' : undefined" /><p v-if="errors.scopeNotes" id="request-scope-notes-error" role="alert" class="text-sm text-destructive">{{ errors.scopeNotes }}</p></div>
    <div class="grid gap-4 sm:grid-cols-[120px_1fr]"><div class="space-y-2"><Label for="currency">{{ t('quoteRequest.currencyLabel') }}</Label><Select :model-value="form.currency" @update:model-value="form.currency = $event"><SelectTrigger id="currency"><SelectValue :placeholder="t('quoteRequest.currencyPlaceholder')" /></SelectTrigger><SelectContent><SelectItem v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</SelectItem></SelectContent></Select></div><div class="space-y-2"><Label for="budget">{{ t('quoteRequest.budgetLabel') }}</Label><Input id="budget" v-model="form.amount" required inputmode="decimal" :placeholder="t('quoteRequest.budgetPlaceholder')" v-bind="invalid(errors.amount, 'request-budget-error')" /><p v-if="errors.amount" id="request-budget-error" role="alert" class="text-sm text-destructive">{{ errors.amount }}</p></div></div>
    <p class="studio-note">{{ t('quoteRequest.budgetNote') }}</p>
  </CardContent></section>
  <section><CardHeader><CardTitle class="text-lg">{{ t('quoteRequest.section3') }}</CardTitle></CardHeader><CardContent class="grid gap-5 sm:grid-cols-2">
    <div class="space-y-2"><Label for="customer-type">{{ t('quoteRequest.clientTypeLabel') }}</Label><Select :model-value="form.customerType" @update:model-value="form.customerType = $event as 'company' | 'individual'"><SelectTrigger id="customer-type"><SelectValue :placeholder="t('quoteRequest.clientTypePlaceholder')" /></SelectTrigger><SelectContent><SelectItem value="individual">{{ t('quoteRequest.clientTypePersonal') }}</SelectItem><SelectItem value="company">{{ t('quoteRequest.clientTypeEnterprise') }}</SelectItem></SelectContent></Select></div>
    <div class="space-y-2"><Label for="company">{{ t('quoteRequest.enterpriseName') }}{{ form.customerType === 'company' ? ' *' : '' }}</Label><Input id="company" v-model="form.company" :required="form.customerType === 'company'" maxlength="200" v-bind="invalid(errors.company, 'request-company-error')" /><p v-if="errors.company" id="request-company-error" role="alert" class="text-sm text-destructive">{{ errors.company }}</p></div>
    <div class="space-y-2 sm:col-span-2"><Label for="contact">{{ t('quoteRequest.contactName') }}</Label><Input id="contact" v-model="form.contactName" required maxlength="100" autocomplete="name" v-bind="invalid(errors.contactName, 'request-contact-name-error')" /><p v-if="errors.contactName" id="request-contact-name-error" role="alert" class="text-sm text-destructive">{{ errors.contactName }}</p></div>
    <div class="space-y-2"><Label for="email">{{ t('quoteRequest.emailLabel') }}</Label><Input id="email" v-model="form.email" type="email" maxlength="254" autocomplete="email" :aria-invalid="!!errors.contact" :aria-describedby="errors.contact ? 'request-contact-error' : undefined" /></div>
    <div class="space-y-2"><Label for="phone">{{ t('quoteRequest.phoneLabel') }}</Label><Input id="phone" v-model="form.phone" type="tel" maxlength="30" autocomplete="tel" :aria-invalid="!!errors.contact" :aria-describedby="errors.contact ? 'request-contact-error' : undefined" /></div>
    <p v-if="errors.contact" id="request-contact-error" role="alert" class="text-sm text-destructive sm:col-span-2">{{ errors.contact }}</p>
    <p v-else-if="!loggedIn" class="text-sm text-muted-foreground sm:col-span-2">{{ t('quoteRequest.guestHint') }}</p>
    <div class="space-y-2 sm:col-span-2"><Label for="notes">{{ t('quoteRequest.remarksLabel') }}</Label><Textarea id="notes" v-model="form.notes" maxlength="2000" /></div>
  </CardContent></section>
</template>
