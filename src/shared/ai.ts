import type { FileStatus } from '../main/git.ts'

export type AIProvider = 'codex' | 'claude'
export type AIAction = 'review' | 'commit-message'
export type AILanguage = 'en' | 'vi'
export type AIScope =
  | { kind: 'selected'; paths: string[] }
  | { kind: 'staged' }
  | { kind: 'all' }

export type AIProviderInfo = {
  provider: AIProvider
  available: boolean
  path?: string
}

export type AIRequest = {
  requestId: string
  cwd: string
  provider: AIProvider
  action: AIAction
  language: AILanguage
  scope: AIScope
}

export type AIResult = {
  action: AIAction
  provider: AIProvider
  scope: AIScope
  scopeLabel: string
  text: string
}

/** The visible selection wins, then the index, then every working-tree change. */
export function chooseAIScope(selected: string[], files: FileStatus[]): AIScope {
  if (selected.length) return { kind: 'selected', paths: selected }
  if (files.some((f) => f.kind !== 'unmerged' && f.x !== '.' && f.x !== '?' && f.x !== '!'))
    return { kind: 'staged' }
  return { kind: 'all' }
}

export function aiScopeLabel(scope: AIScope): string {
  if (scope.kind === 'selected')
    return `${scope.paths.length} selected file${scope.paths.length === 1 ? '' : 's'}`
  return scope.kind === 'staged' ? 'staged changes' : 'all changes'
}
