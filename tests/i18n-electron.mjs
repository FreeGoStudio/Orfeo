import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import toneMidi from '@tonejs/midi'
const { Midi } = toneMidi
const root=process.cwd()
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'orfeo-i18n-'))
await fs.mkdir(path.join(temp,'Orfeo-Data'))
const library=path.join(temp,'Library')
await fs.mkdir(library)
const midi=new Midi()
const track=midi.addTrack()
track.name='用户命名 Piano'
for(let i=0;i<120;i++) for(const pitch of [60,64,67]) track.addNote({midi:pitch,time:i*0.5,duration:0.4,velocity:0.6})
await fs.writeFile(path.join(library,'i18n-smoke.mid'),Buffer.from(midi.toArray()))
await fs.writeFile(path.join(temp,'Orfeo-Data','orfeo-prefs.json'),JSON.stringify({localePreference:'en',hideDemoFolder:true,libraryFolder:library,audioEngine:'gm',samplesIntroduced:true,autoCollapseDrawers:false}))
const env={...process.env,PORTABLE_EXECUTABLE_DIR:temp}
delete env.ELECTRON_RUN_AS_NODE
let app
const errors=[]
async function shutdown() {
  if(!app)return
  // The profile is disposable and every language write above has been awaited.
  // app.exit avoids updater/close-confirmation hooks interfering with test cleanup.
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{})
  await app.close().catch(()=>{})
  app=undefined
}
async function start(){
 app=await electron.launch({args:[root],env,timeout:30000})
 app.process().stderr?.on('data', data => { if (/preload|Error|error/.test(String(data))) console.error('Electron:', String(data)) })
 const page=await app.firstWindow()
 page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error')console.error('Renderer:',m.text())})
 await page.waitForSelector('button',{timeout:30000})
 return page
}
try {
 const page=await start()
 assert.equal(await page.title(),'Orfeo')
 assert.equal(await page.locator('html').getAttribute('lang'),'en')
 await page.keyboard.press('Escape')
 await page.getByText('i18n-smoke',{exact:true}).first().waitFor()
 await page.keyboard.press('Escape')
 await page.getByText('i18n-smoke',{exact:true}).first().click()

 await page.waitForFunction(()=>document.querySelector('input[type="range"]') !== null)
 await page.keyboard.press('Space')
 await page.waitForTimeout(1200)
 const timeBefore=await page.locator('input[type="range"]').first().inputValue()
 await page.keyboard.press('Control+,')
 await page.getByPlaceholder('Search settings…').fill('language')
 await page.getByRole('combobox',{name:'Language'}).selectOption('zh-CN')
 await page.waitForFunction(()=>document.documentElement.lang==='zh-CN')
 assert.equal(await page.getByRole('combobox',{name:'语言'}).inputValue(),'zh-CN')
 await page.getByPlaceholder('搜索设置…').fill('音色库')
 assert.ok(await page.getByText('Sound Fonts',{exact:true}).count()===0)
 await page.getByPlaceholder('搜索设置…').fill('Sound Fonts')
 assert.ok(await page.getByText('音色库',{exact:true}).count()>0)
 await page.getByPlaceholder('搜索设置…').fill('')
 for(const name of ['音频','MIDI 文件与曲库','播放与编辑','练习','记谱与和弦','键盘','钢琴卷帘','外观','MIDI 键盘']) {
   await page.getByRole('button',{name,exact:true}).click()
   assert.ok((await page.locator('body').innerText()).includes(name))
 }
 // Open a live confirmation, then change locale through IPC as another window would.
 await page.getByRole('button',{name:'重置设置',exact:true}).click()
 await page.getByRole('dialog',{name:'重置 MIDI 键盘设置？'}).waitFor()
 const dialog=await page.getByRole('dialog',{name:'重置 MIDI 键盘设置？'}).elementHandle()
 await page.evaluate(()=>window.electronAPI.setLocale('en'))
 await page.getByRole('dialog',{name:'Reset MIDI keyboard settings?'}).waitFor()
 assert.equal(await dialog.evaluate(el=>el.isConnected),true,'dialog was not remounted')
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await page.evaluate(()=>window.electronAPI.setLocale('zh-CN'))
 // Capture the application's native-dialog text without opening an OS picker.
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async options=>{globalThis.__i18nDialog=options;return {canceled:true,filePaths:[]}}})
 await page.evaluate(()=>window.electronAPI.openMidiFile())
 assert.equal(await app.evaluate(()=>globalThis.__i18nDialog.title),'打开 MIDI 文件')
 await page.getByRole('button',{name:'外观',exact:true}).click()
 await page.screenshot({path:path.join(temp,'settings-zh.png')})
 await app.evaluate(({BrowserWindow})=>{ const win=BrowserWindow.getAllWindows()[0];win.unmaximize();win.setBounds({x:50,y:50,width:1100,height:720}) })
 await page.waitForFunction(()=>innerWidth<1200)
 await page.screenshot({path:path.join(temp,'settings-zh-narrow.png')})
 await page.keyboard.press('Escape')
 const timeAfter=await page.locator('input[type="range"]').first().inputValue()
 assert.ok(Number(timeAfter)>Number(timeBefore), `playhead advanced: ${timeBefore} -> ${timeAfter}`)
 await page.keyboard.press('Space')
 const state=await page.evaluate(()=>window.electronAPI.getLocale())
 assert.deepEqual(state,{preference:'zh-CN',locale:'zh-CN'})
 const saved=JSON.parse(await fs.readFile(path.join(temp,'Orfeo-Data','orfeo-prefs.json'),'utf8'))
 assert.equal(saved.localePreference,'zh-CN')
 await shutdown()
 const restarted=await start()
 assert.equal(await restarted.locator('html').getAttribute('lang'),'zh-CN')
 await restarted.keyboard.press('Control+,')
 await restarted.getByPlaceholder('搜索设置…').fill('language')
 await restarted.getByRole('combobox',{name:'语言'}).selectOption('en')
 await restarted.waitForFunction(()=>document.documentElement.lang==='en')
 assert.equal(await restarted.getByRole('combobox',{name:'Language'}).inputValue(),'en')
 await restarted.screenshot({path:path.join(temp,'settings-en.png')})
 assert.deepEqual(errors,[])
 console.log(JSON.stringify({passed:true,evidence:temp,tests:['switch without restart','Chinese and English search','IPC and persistence','restart restores locale','switch back','1100px window','all settings groups','playback continues through locale change','open dialog translates without remount','native dialog translated','no renderer errors']},null,2))
} catch(error) {
 console.error(error, errors)
 if(app){const page=await app.firstWindow();console.error((await page.locator('body').innerText()).slice(0,5000));await page.screenshot({path:path.join(temp,'failed.png')});console.error('Evidence:',temp)}
 throw error
} finally { await shutdown() }
