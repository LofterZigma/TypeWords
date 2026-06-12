<script setup lang="ts">
import { BaseButton, BasePage, Textarea, Toast, UploadButton } from '@typewords/base'
import { addDict, detail } from '@typewords/core/apis'
import { parseImportFile } from '@typewords/core/apis/dict.ts'
import { getWordList } from '@typewords/core/apis/words.ts'
import { AppEnv } from '@typewords/core/config/env.ts'
import { useBaseStore } from '@typewords/core/stores/base.ts'
import { useRuntimeStore } from '@typewords/core/stores/runtime.ts'
import { DictType } from '@typewords/core/types/enum.ts'
import { getDefaultDict, getDefaultWord } from '@typewords/core/types/func.ts'
import type { Dict } from '@typewords/core/types/types.ts'
import { cloneDeep } from '@typewords/core/utils'
import { nanoid } from 'nanoid'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ArticleDetailPage from './(articles)/book/[id].vue'
import WordDetailPage from './(words)/dict.vue'
import Header from '@typewords/core/components/Header.vue'
import EditBook from '@typewords/core/components/article/EditBook.vue'
import Book from '@typewords/core/components/Book.vue'
import { MessageBox } from '@typewords/core/utils/MessageBox.tsx'
import { useI18n } from 'vue-i18n'

type ImportStep = 1 | 2 | 3
type ImportType = 'word' | 'article'

const route = useRoute()
const router = useRouter()
const base = useBaseStore()
const runtimeStore = useRuntimeStore()

const step = ref<ImportStep>(1)
const selectedDict = ref<Dict | null>(null)
const pendingDict = ref<Dict | null>(null)
const showCreateForm = ref(false)
const textInput = ref('')
const selectedFile = ref<File | null>(null)
const selectedFileName = ref('')
const uploading = ref(false)
const importing = ref(false)
const importResult = ref('')
const { t } = useI18n()

const importType = computed<ImportType>(() => (route.query.type === 'article' ? 'article' : 'word'))
const isWord = computed(() => importType.value === 'word')
const source = computed(() => (isWord.value ? base.word : base.article))
const targetLabel = computed(() => (isWord.value ? '词典' : '书籍'))
const contentLabel = computed(() => (isWord.value ? '单词' : '文章'))
const currentTarget = computed(() => selectedDict.value ?? pendingDict.value)

const availableDicts = computed(() => source.value.bookList.filter(item => item.id && (item.custom || item.system)))

const manualWords = computed(() =>
  textInput.value
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
)

function findTargetById(id?: string) {
  if (!id) return null
  return source.value.bookList.find(item => String(item.id) === id || String(item.userDictId ?? '') === id) ?? null
}

function normalizeStep(value: unknown): ImportStep {
  return value === '2' || value === 2 ? 2 : value === '3' || value === 3 ? 3 : 1
}

function restoreFromRoute() {
  step.value = normalizeStep(route.query.step)
  const target = findTargetById(route.query.targetId as string)
  if (target) {
    selectedDict.value = target
    pendingDict.value = null
    runtimeStore.editDict = getDefaultDict(cloneDeep(target))
  }
  if (step.value === 3 && !runtimeStore.editDict.id && target) {
    runtimeStore.editDict = getDefaultDict(cloneDeep(target))
  }
  if (step.value > 1 && !currentTarget.value && !runtimeStore.editDict.id) {
    step.value = 1
  }
}

onMounted(restoreFromRoute)
watch(() => route.query, restoreFromRoute)
watch(importType, () => {
  selectedDict.value = null
  pendingDict.value = null
  showCreateForm.value = false
  textInput.value = ''
  selectedFile.value = null
  selectedFileName.value = ''
  importResult.value = ''
  if (!route.query.step) step.value = 1
})

function selectTarget(dict: Dict) {
  selectedDict.value = dict
  pendingDict.value = null
}

function handleDraftSubmit(dict?: Dict) {
  if (!dict) return
  pendingDict.value = getDefaultDict({
    ...dict,
    id: dict.id || `pending-${importType.value}-${nanoid(8)}`,
    custom: true,
    type: isWord.value ? DictType.word : DictType.article,
  })
  selectedDict.value = null
  showCreateForm.value = false
}

function goStep2() {
  if (!currentTarget.value) return Toast.warning(`请先选择或创建一个${targetLabel.value}`)
  step.value = 2
  router.replace({ query: { ...route.query, type: importType.value, step: '2' } })
}

function upsertTarget(dict: Dict) {
  const normalized = getDefaultDict(dict)
  const list = source.value.bookList
  const index = list.findIndex(item => String(item.id) === String(normalized.id))
  if (index > -1) {
    list[index] = normalized
  } else {
    list.push(normalized)
  }
  selectedDict.value = normalized
  pendingDict.value = null
  runtimeStore.editDict = cloneDeep(normalized)
  return normalized
}

async function persistTarget() {
  const target = currentTarget.value
  if (!target) throw new Error('missing target')
  if (!pendingDict.value) return target

  let dict = getDefaultDict({
    ...target,
    id: '',
    custom: true,
    type: isWord.value ? DictType.word : DictType.article,
  })

  if (AppEnv.CAN_REQUEST) {
    const res = await addDict(null, dict)
    if (!res.success) throw new Error(res.msg || `${targetLabel.value}创建失败`)
    dict = getDefaultDict({ ...res.data, custom: true, type: dict.type })
  } else {
    dict.id = `custom-${importType.value}-${nanoid(8)}`
  }

  return upsertTarget(dict)
}

function mergeWordsLocal(dict: Dict, words: string[]) {
  const next = getDefaultDict(cloneDeep(dict))
  const exists = new Set(next.words.map(item => item.word.toLowerCase()))
  words.forEach(word => {
    const key = word.toLowerCase()
    if (!exists.has(key)) {
      next.words.push(getDefaultWord({ id: nanoid(6), word, custom: true }))
      exists.add(key)
    }
  })
  next.length = next.words.length
  return next
}

async function refreshRemoteDict(dict: Dict) {
  if (!AppEnv.CAN_REQUEST || !dict.id) return dict
  const res = await detail({ id: dict.id })
  return res.success ? getDefaultDict({ ...dict, ...res.data }) : dict
}

function completeImport(dict: Dict, message = '导入成功') {
  const saved = upsertTarget(dict)
  importResult.value = message
  step.value = 3
  router.replace({
    query: {
      ...route.query,
      type: importType.value,
      step: '3',
      targetId: String(saved.id),
    },
  })
}

async function importManualWords() {
  if (!manualWords.value.length) return Toast.warning('请输入要导入的单词')

  importing.value = true
  try {
    let target = await persistTarget()

    // 提交前去重：过滤掉目标词典中已存在的单词
    const existsSet = new Set(target.words.map(w => w.word))
    const newWords = manualWords.value.filter(w => !existsSet.has(w))
    if (!newWords.length) {
      return Toast.warning('所有单词已存在于词典中，无需重复导入')
    }

    const res = await getWordList(
      null,
      newWords.map(v => v.trim())
    )
    if (!res.success) {
      return Toast.error(res.msg || '导入失败')
    }

    const { list = [], missing = [] } = (res.data ?? {}) as { list: any[]; missing: string[] }

    // list 与 newWords 顺序一一对应：找到的是完整数据，找不到的是只含 word 的空壳占位
    // 全量合并进词典，顺序与用户提交时完全一致
    const next = cloneDeep(target)
    list.forEach(item => {
      next.words.push(getDefaultWord({ ...item, id: item.id ?? nanoid(6), custom: !item.trans?.length }))
    })
    next.length = next.words.length

    // 提示未找到的单词
    if (missing.length) {
      const preview = missing.slice(0, 5).join('、')
      const suffix = missing.length > 5 ? ` 等 ${missing.length} 个` : ''
      Toast.warning(`以下单词在词库中未找到：${preview}${suffix}`)
    }

    completeImport(
      next,
      `导入完成，共 ${next.words.length} 个单词${missing.length ? `（${missing.length} 个未找到）` : ''}`
    )
  } catch (error: any) {
    Toast.error(error?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

function selectFile(e: any) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  selectedFile.value = file
  selectedFileName.value = file.name
}

function extractDictFromResponse(data: any, fallback: Dict) {
  if (data?.id || data?.name || data?.words || data?.articles) {
    return getDefaultDict({ ...fallback, ...data })
  }
  if (data?.dict) {
    return getDefaultDict({ ...fallback, ...data.dict })
  }
  return fallback
}

async function importSelectedFile() {
  if (!selectedFile.value) return Toast.warning('请先选择要上传的文件')

  uploading.value = true
  try {
    let target = await persistTarget()
    const formData = new FormData()
    formData.append('file', selectedFile.value)

    if (AppEnv.CAN_REQUEST) {
      const res = await parseImportFile(
        {
          type: importType.value,
          dictId: target.userDictId ?? target.id,
          id: target.id,
        },
        formData
      )
      if (!res.success) return Toast.error(res.msg || '导入失败')
      target = extractDictFromResponse(res.data, target)
      if (!target.words.length && !target.articles.length) {
        target = await refreshRemoteDict(target)
      }
      completeImport(target)
    } else {
      Toast.warning('离线模式暂不支持文件导入，请使用手动输入')
    }
  } catch (error: any) {
    Toast.error(error?.message || '导入失败')
  } finally {
    uploading.value = false
  }
}

function submitWordImport() {
  const hasManual = manualWords.value.length > 0
  const hasFile = !!selectedFile.value
  if (!hasManual && !hasFile) return Toast.warning('请输入单词或选择文件')
  if (hasManual && hasFile) {
    MessageBox.confirm(
      '检测到你同时填写了单词列表并选择了文件，请选择本次要导入的来源。',
      '选择导入来源',
      () => void 0,
      () => importSelectedFile(),
      null,
      {
        t,
        confirmButtonText: '使用手动输入',
        cancelButtonText: '使用上传文件',
        onConfirm: () => importManualWords(),
      }
    )
    return
  }
  if (hasManual) return importManualWords()
  return importSelectedFile()
}

async function goManualArticleEdit() {
  if (isWord.value) return
  if (selectedFile.value) {
    MessageBox.confirm(
      '检测到你已经选择了上传文件，请选择本次要导入的来源。',
      '选择导入来源',
      () => void 0,
      () => importSelectedFile(),
      null,
      {
        t,
        confirmButtonText: '进入手动编辑',
        cancelButtonText: '使用上传文件',
        onConfirm: () => goManualArticleEditWithoutConfirm(),
      }
    )
    return
  }
  return goManualArticleEditWithoutConfirm()
}

async function goManualArticleEditWithoutConfirm() {
  importing.value = true
  try {
    const target = await persistTarget()
    runtimeStore.editDict = getDefaultDict(cloneDeep(target))
    await router.push({
      path: '/batch-edit-article',
      query: {
        from: 'import',
        targetId: String(target.id),
      },
    })
  } catch (error: any) {
    Toast.error(error?.message || '保存书籍失败')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <component :is="isWord ? WordDetailPage : ArticleDetailPage" v-if="step === 3" />

  <BasePage v-else>
    <div class="card import-page w-full">
      <Header :title="`导入${contentLabel}`" />
      <div class="stepper" aria-label="导入步骤">
        <div class="step-item active">
          <span>1</span>
          <strong>选择{{ targetLabel }}</strong>
        </div>
        <div class="step-rail" :class="{ active: step >= 2 }" />
        <div class="step-item" :class="{ active: step >= 2 }">
          <span>2</span>
          <strong>导入{{ contentLabel }}</strong>
        </div>
        <div class="step-rail" />
        <div class="step-item">
          <span>3</span>
          <strong>查看详情</strong>
        </div>
      </div>

      <main class="main-panel mt-4">
        <section v-if="step === 1" class="workflow-section">
          <div class="section-heading">
            <div class="section-title">选择导入位置</div>
            <BaseButton v-if="!showCreateForm" type="info" @click="showCreateForm = true">
              新建{{ targetLabel }}
            </BaseButton>
          </div>

          <ul class="rule-list">
            <li>
              <IconFluentCheckmarkCircle20Regular />
              仅可导入内置{{ targetLabel }}、自定义{{ targetLabel }}
            </li>
            <li>
              <IconFluentCheckmarkCircle20Regular />
              官方{{ targetLabel }}不可直接导入，您可创建副本后再导入
            </li>
          </ul>

          <div
            v-if="showCreateForm"
            class="border border-[var(--color-input-border)] rounded-md p-4 bg-[var(--color-card-bg)]"
          >
            <EditBook
              :is-add="true"
              :is-book="!isWord"
              submit-mode="draft"
              fluid
              @submit="handleDraftSubmit"
              @close="showCreateForm = false"
            />
          </div>

          <div class="section-title">{{ targetLabel }}列表</div>
          <div v-if="availableDicts.length" class="flex gap-4 flex-wrap">
            <Book
              v-for="dict in availableDicts"
              :key="dict.id"
              :is-add="false"
              :item="dict"
              :quantifier="isWord ? '词' : '篇'"
              :show-progress="false"
              :selected="currentTarget?.id === dict.id"
              @click="selectTarget(dict)"
            />
          </div>
          <div v-else class="empty-state">
            <IconFluentBook20Regular />
            <strong>还没有可导入的{{ targetLabel }}</strong>
            <span>新建一个{{ targetLabel }}后继续。</span>
          </div>

          <template v-if="pendingDict">
            <div class="section-title">新建待导入{{ targetLabel }}</div>
            <div class="flex gap-4 flex-wrap">
              <Book
                :is-add="false"
                :item="pendingDict"
                :quantifier="isWord ? '词' : '篇'"
                :show-progress="false"
                :selected="true"
              />
            </div>
          </template>

          <div class="actions-row">
            <BaseButton type="primary" size="large" :disabled="!currentTarget" @click="goStep2">
              下一步：导入{{ contentLabel }}
            </BaseButton>
          </div>
        </section>

        <section v-else class="workflow-section">
          <div class="section-heading">
            <div class="section-title">导入到：{{ currentTarget?.name }}</div>
          </div>

          <div class="input-split">
            <!-- 左列：上传文件（固定） -->
            <div class="method-panel primary-method">
              <div class="method-title">
                <IconFluentArrowUpload20Regular />
                <span>上传文件</span>
              </div>
              <p>支持导入 .txt / .json / .xlsx 格式文件</p>
              <div class="flex gap-3 flex-col mb-4">
                <div>
                  <a href="/templates/template.txt" download>下载 txt 模板</a>
                </div>
                <div>
                  <a href="/templates/template.json" download>下载 json 模板</a>
                </div>
                <div>
                  <a href="/templates/template.xlsx" download>下载 xlsx 模板</a>
                </div>
              </div>
              <div class="flex items-center gap-3 flex-wrap">
                <UploadButton accept=".txt,.json,.xlsx,.xls,.csv" :loading="uploading" @change="selectFile">
                  选择文件
                </UploadButton>
                <span class="color-gray text-sm" v-if="selectedFileName">{{ selectedFileName }}</span>
              </div>
            </div>

            <span>或</span>
            <!-- 右列：词典=手动输入，书籍=文章编辑 -->
            <div class="method-panel" v-if="isWord">
              <div class="method-title">
                <IconFluentTextAlignLeft16Regular />
                <span>手动输入</span>
              </div>
              <Textarea
                class="my-2"
                v-model="textInput"
                placeholder="一行一个单词，例如：&#10;apple&#10;banana&#10;cherry"
                :autosize="{ minRows: 20, maxRows: 20 }"
              />
              <div class="method-footer">
                <span>已输入 {{ manualWords.length }} / 1000 个单词</span>
              </div>
            </div>
            <div class="method-panel" v-else>
              <div class="method-title">
                <IconFluentDocument20Regular />
                <span>手动输入文章</span>
              </div>
              <p>先保存书籍，再进入已有文章编辑页面；可以连续新增多篇文章。</p>
              <BaseButton type="primary" :loading="importing" @click="goManualArticleEdit"> 进入文章编辑 </BaseButton>
            </div>
          </div>

          <div class="actions-row step2-actions">
            <BaseButton type="info" @click="step = 1">返回上一步</BaseButton>
            <BaseButton
              v-if="isWord"
              type="primary"
              :loading="importing || uploading"
              :disabled="!manualWords.length && !selectedFile"
              @click="submitWordImport"
            >
              提交
            </BaseButton>
            <BaseButton
              v-else
              type="primary"
              :loading="uploading"
              :disabled="!selectedFile"
              @click="importSelectedFile"
            >
              提交
            </BaseButton>
          </div>
        </section>
      </main>
    </div>
  </BasePage>
</template>

<style scoped lang="scss">
.import-page {
  min-height: calc(100vh - 1.2rem);
}

.eyebrow {
  color: var(--color-select-bg);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
}

.stepper {
  align-items: center;
  display: flex;
  justify-content: space-around;
  flex-shrink: 0;
  gap: 0.45rem;
}

.step-item {
  align-items: center;
  color: var(--color-font-3);
  display: flex;
  gap: 0.45rem;
  min-height: 2.75rem;

  span {
    align-items: center;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    border-radius: 999px;
    display: inline-flex;
    font-size: 0.85rem;
    font-weight: 800;
    height: 2rem;
    justify-content: center;
    width: 2rem;
  }

  strong {
    font-size: 0.9rem;
    font-weight: 700;
    white-space: nowrap;
  }

  &.active {
    color: var(--color-font-1);

    span {
      background: var(--color-select-bg);
      border-color: var(--color-select-bg);
      color: var(--color-font-active-1);
    }
  }
}

.step-rail {
  background: var(--color-input-border);
  height: 1px;
  width: 100%;

  &.active {
    background: var(--color-select-bg);
  }
}

.main-panel {
  border-radius: 0.75rem;
}

.target-summary {
  align-items: flex-start;
  display: flex;
  gap: 0.7rem;

  svg {
    color: var(--color-select-bg);
    flex: 0 0 auto;
    font-size: 1.35rem;
    margin-top: 0.1rem;
  }

  strong,
  span {
    display: block;
  }

  strong {
    color: var(--color-font-1);
    font-weight: 750;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    color: var(--color-font-3);
    font-size: 0.86rem;
    line-height: 1.5;
    margin-top: 0.2rem;
  }
}

.rule-list {
  color: var(--color-font-2);
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    align-items: flex-start;
    display: flex;
    gap: 0.55rem;
    line-height: 1.5;
  }

  svg {
    color: var(--color-select-bg);
    flex: 0 0 auto;
    margin-top: 0.18rem;
  }
}

.main-panel {
  min-width: 0;
  padding: 1.25rem;
}

.workflow-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-heading {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;

  p {
    color: var(--color-font-3);
    line-height: 1.5;
    margin: 0.25rem 0 0;
  }
}

.section-title {
  color: var(--color-font-1);
  font-size: 1.2rem;
  font-weight: 750;
}

.create-panel,
.status-strip,
.empty-state,
.method-panel {
  border: 1px solid var(--color-input-border);
  border-radius: 0.65rem;
}

.create-panel {
  background: var(--color-input-bg);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 1rem;

  label {
    color: var(--color-font-1);
    font-size: 0.9rem;
    font-weight: 700;
  }
}

.create-row {
  align-items: center;
  display: flex;
  gap: 0.7rem;
}

.create-input {
  background: var(--color-card-bg);
  border: 1px solid var(--color-input-border);
  border-radius: 0.5rem;
  color: var(--color-input-color);
  flex: 1;
  min-height: 2.75rem;
  min-width: 12rem;
  outline: none;
  padding: 0 0.85rem;

  &:focus {
    border-color: var(--color-select-bg);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-select-bg) 18%, transparent);
  }
}

.form-error {
  color: #dc2626;
  font-size: 0.85rem;
}

.helper-text {
  color: var(--color-font-3);
  font-size: 0.85rem;
}

.status-strip {
  align-items: center;
  background: color-mix(in srgb, var(--color-select-bg) 9%, var(--color-card-bg));
  color: var(--color-font-1);
  display: flex;
  gap: 0.55rem;
  padding: 0.8rem 0.95rem;
}

.target-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
}

.target-card {
  background: var(--color-card-bg);
  border: 1px solid var(--color-input-border);
  border-radius: 0.65rem;
  color: var(--color-font-1);
  cursor: pointer;
  min-height: 7rem;
  min-width: 0;
  padding: 1rem;
  position: relative;
  text-align: left;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;

  strong,
  span {
    display: block;
  }

  strong {
    font-size: 1rem;
    line-height: 1.35;
    margin-top: 0.55rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span:last-of-type {
    color: var(--color-font-3);
    font-size: 0.85rem;
    margin-top: 0.35rem;
  }

  &:hover {
    border-color: var(--color-select-bg);
    transform: translateY(-1px);
  }

  &.selected {
    border-color: var(--color-select-bg);
    box-shadow: inset 0 0 0 1px var(--color-select-bg);
  }
}

.target-type {
  color: var(--color-select-bg);
  font-size: 0.78rem;
  font-weight: 800;
}

.selected-icon {
  color: var(--color-select-bg);
  font-size: 1.25rem;
  position: absolute;
  right: 0.85rem;
  top: 0.85rem;
}

.empty-state {
  align-items: center;
  color: var(--color-font-3);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  justify-content: center;
  min-height: 13rem;
  text-align: center;

  svg {
    color: var(--color-select-bg);
    font-size: 2rem;
  }

  strong {
    color: var(--color-font-1);
  }
}

.actions-row {
  display: flex;
  justify-content: flex-end;
}

.step2-actions {
  justify-content: space-between;
}

.input-split {
  display: grid;
  gap: 1rem;
  align-items: center;
  grid-template-columns: minmax(17rem, 0.75fr) auto minmax(0, 1.25fr);
}

.method-panel {
  height: 100%;
  box-sizing: border-box;
  background: var(--color-input-bg);
  display: flex;
  flex-direction: column;
  min-height: 14rem;
  padding: 1rem;

  p,
  label,
  span {
    color: var(--color-font-3);
    line-height: 1.6;
  }

  label {
    font-size: 0.88rem;
    font-weight: 700;
    margin-top: 0.85rem;
  }
}

.primary-method {
  background: var(--color-card-bg);
}

.method-title {
  align-items: center;
  color: var(--color-font-1);
  display: flex;
  font-weight: 750;
  gap: 0.55rem;

  svg {
    color: var(--color-select-bg);
    font-size: 1.25rem;
  }
}
.method-footer {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  margin-top: auto;
}

@media (max-width: 1180px) {
  .import-header {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 900px) {
  .import-layout,
  .input-split {
    grid-template-columns: 1fr;
  }

  .context-panel {
    position: static;
  }
}

@media (max-width: 640px) {
  .import-header,
  .main-panel,
  .context-panel {
    border-radius: 0.5rem;
    padding: 0.85rem;
  }

  .stepper {
    align-items: stretch;
    flex-direction: column;
    width: 100%;
  }

  .step-rail {
    display: none;
  }

  .section-heading,
  .create-row,
  .method-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .target-grid {
    grid-template-columns: 1fr;
  }
}
</style>
