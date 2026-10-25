import fs from 'node:fs'
import { extractMessages } from './i18n-extract.mjs'
const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json','utf8'))
const zh = JSON.parse(fs.readFileSync('src/i18n/locales/zh-CN.json','utf8'))
const errors = []
const placeholders = value => [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(m=>m[1]).sort().join('|')
for (const [locale, catalog] of [['en',en],['zh-CN',zh]]) {
  for (const [key,value] of Object.entries(catalog)) {
    if(typeof value !== 'string' || !value.trim()) errors.push(`${locale}: empty/non-string ${key}`)
    else if(en[key] && placeholders(value)!==placeholders(en[key])) errors.push(`${locale}: interpolation mismatch ${key}`)
    if(/_(one|other)$/.test(key)) {
      const base=key.replace(/_(one|other)$/,'')
      for(const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories)
        if(!catalog[`${base}_${category}`]) errors.push(`${locale}: missing plural ${base}_${category}`)
    }
  }
}
for(const key of Object.keys(en)) if(!zh[key] && !key.endsWith('_one')) errors.push(`zh-CN: missing ${key}`)
for(const [key,files] of extractMessages()) if(!en[key] && !en[`${key}_other`]) errors.push(`unregistered: ${key} (${files[0]})`)
if(errors.length) { console.error(errors.join('\n'));process.exitCode=1 }
else console.log(`i18n: ${Object.keys(en).length} English and ${Object.keys(zh).length} Chinese entries verified`)
