import http from '../utils/http.ts'
import type { Dict } from '../types'

export function wordDelete(params?, data?) {
  return http<Dict>('word/delete', data, params, 'post')
}
export function getWordList(params?, data?) {
  return http<Dict>('public.word/getWordList', data, params, 'post')
}
