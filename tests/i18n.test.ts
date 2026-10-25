import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTranslator, normalizePreference, resolveLocale, templateMessage, translate } from '../src/i18n/core'
import { i18n, translator } from '../src/utils/i18n'
import { getSettings, getGroups } from '../src/components/Settings/catalog'
import { searchSettings } from '../src/components/Settings/search'

test('system locales, explicit preference and invalid persisted preferences', () => {
  for(const language of ['zh','zh-CN','zh-TW','zh_HK']) assert.equal(resolveLocale('system',language),'zh-CN')
  for(const language of ['en-US','ja-JP','fr','']) assert.equal(resolveLocale('system',language),'en')
  assert.equal(resolveLocale('en','zh-CN'),'en')
  assert.equal(resolveLocale('zh-CN','en-US'),'zh-CN')
  for(const value of [null, undefined, {}, 'fr', 42, 'system']) assert.equal(normalizePreference(value),'system')
})
test('template interpolation supports reordering and preserves user content', () => {
  const instance=createTranslator('zh-CN')
  const strings=Object.assign(['First ', ' then ', '.'], {raw:['First ', ' then ', '.']})
  const message=templateMessage(strings,['<演奏者>','B'])
  instance.addResource('zh-CN','translation',message.key,'先 {{v1}}，再 {{v0}}。')
  assert.equal(translate(instance,message),'先 B，再 <演奏者>。')
  assert.equal(translate(instance,'unregistered fallback'),'unregistered fallback')
  instance.addResource('en','translation','onlyEnglish','English fallback')
  assert.equal(translate(instance,'onlyEnglish'),'English fallback')
})
test('plural forms and independent main/renderer instances', async () => {
  const main=createTranslator('en'), renderer=createTranslator('zh-CN')
  assert.equal(main.t('files.count',{count:1}),'1 file')
  assert.equal(main.t('files.count',{count:2}),'2 files')
  assert.equal(renderer.t('files.count',{count:2}),'2 个文件')
  await main.changeLanguage('zh-CN')
  await renderer.changeLanguage('en')
  assert.equal(main.language,'zh-CN')
  assert.equal(renderer.language,'en')
})
test('catalogs are evaluated per language; identifiers and layouts stay stable', () => {
  const en=getSettings('en'), zh=getSettings('zh-CN')
  assert.deepEqual(en.map(s=>s.id),zh.map(s=>s.id))
  assert.equal(zh.find(s=>s.id==='language')?.name,'语言')
  assert.equal(en.find(s=>s.id==='language')?.name,'Language')
  assert.equal(getGroups('zh-CN').find(g=>g.id==='appearance')?.name,'外观')
  assert.equal(translator('en').tr('Language'),'Language')
})
test('settings search accepts Chinese and English after changing language', async () => {
  // The store keeps preference separately; initialization uses the public language API.
  const { setLanguage } = await import('../src/utils/i18n')
  Object.assign(globalThis,{window:{electronAPI:{setLocale:async()=>({preference:'zh-CN',locale:'zh-CN'})}}, document:{documentElement:{lang:''}}})
  await setLanguage('zh-CN')
  assert.ok(searchSettings('音色库').flatMap(g=>g.settings).some(s=>s.id==='soundFonts'))
  assert.ok(searchSettings('Sound Fonts').flatMap(g=>g.settings).some(s=>s.id==='soundFonts'))
  assert.ok(searchSettings('English').flatMap(g=>g.settings).some(s=>s.id==='language'))
  await i18n.changeLanguage('en')
})

test('failed preference writes preserve the current language; startup failure falls back safely', async () => {
  const { initializeLanguage, setLanguage, getLocaleState } = await import('../src/utils/i18n')
  Object.assign(globalThis,{window:{electronAPI:{getLocale:async()=>({preference:'zh-CN',locale:'zh-CN'}),setLocale:async()=>{throw Error('disk is read-only')}}},document:{documentElement:{lang:''}}})
  await initializeLanguage()
  await assert.rejects(()=>setLanguage('en'),/read-only/)
  assert.equal(getLocaleState().locale,'zh-CN')
  Object.assign(globalThis,{window:{electronAPI:{getLocale:async()=>{throw Error('IPC unavailable')}}}})
  await initializeLanguage()
  assert.equal(getLocaleState().preference,'system')
  assert.equal(getLocaleState().locale,resolveLocale('system',navigator.language))
})
