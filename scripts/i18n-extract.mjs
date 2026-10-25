import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
export function extractMessages() {
  const messages = new Map()
  const files = ['src', 'electron'].flatMap(dir => fs.readdirSync(dir, {recursive:true}).filter(f => /\.tsx?$/.test(f) && !/Test\./.test(f) && !f.startsWith('i18n')).map(f => path.join(dir,f)))
  for (const file of files) {
    const text = fs.readFileSync(file,'utf8')
    const sf = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
    function visit(n) {
      let key
      if (ts.isTaggedTemplateExpression(n) && ['t','tx','msg'].includes(n.tag.getText(sf))) {
        const tpl=n.template
        key=ts.isNoSubstitutionTemplateLiteral(tpl)?tpl.text:tpl.head.text+tpl.templateSpans.map((s,i)=>`{{v${i}}}`+s.literal.text).join('')
      }
      if(ts.isCallExpression(n)&&['tr','mainText','message','i18nMessage'].includes(n.expression.getText(sf)) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) key=n.arguments[0].text
      if(key) messages.set(key, [...(messages.get(key)||[]),file])
      ts.forEachChild(n,visit)
    }
    visit(sf)
  }
  return messages
}
if(process.argv.includes('--write')) {
 const file='src/i18n/locales/en.json',en=JSON.parse(fs.readFileSync(file,'utf8'))
 for(const key of extractMessages().keys())if(!(key in en) && !en[`${key}_other`])en[key]=key
 fs.writeFileSync(file,JSON.stringify(en,null,2)+'\n')
 console.log(`${Object.keys(en).length} messages`)
}

