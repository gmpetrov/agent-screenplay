// From Cody's review of PR #3.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { state, saveStyle } from '../src/editor/server.js';
import { loadScenario } from '../src/scenario/load.js';

it('preserves an existing relative background when promoting it to the project', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-review-')));
  try {
    fs.mkdirSync(path.join(dir, 'videos'));
    fs.writeFileSync(path.join(dir, 'screenplay.config.json'), '{}');
    const file = path.join(dir, 'videos/demo.json');
    fs.writeFileSync(file, JSON.stringify({url:'https://example.com', steps:[{pause:1}], style:{background:'bg.png'}}));
    fs.writeFileSync(path.join(dir, 'videos/bg.png'), 'image');
    const s = state(file);
    saveStyle(file, 'project', {...s.defaults, ...s.projectStyle, ...s.scenarioStyle});
    const bg = loadScenario(file).scenario.style!.background as string;
    expect(bg).toBe(path.join(dir, 'videos/bg.png'));
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

it('preserves an inherited relative background when saving this video', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-review-')));
  try {
    fs.mkdirSync(path.join(dir, 'videos'));
    fs.writeFileSync(path.join(dir, 'screenplay.config.json'), JSON.stringify({style:{background:'bg.png'}}));
    const file = path.join(dir, 'videos/demo.json');
    fs.writeFileSync(file, JSON.stringify({url:'https://example.com', steps:[{pause:1}]}));
    fs.writeFileSync(path.join(dir, 'bg.png'), 'image');
    const s = state(file);
    saveStyle(file, 'scenario', {...s.defaults, ...s.projectStyle, ...s.scenarioStyle});
    const l = loadScenario(file);
    expect(path.resolve(l.dir, l.scenario.style!.background as string)).toBe(path.join(dir, 'bg.png'));
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});

it('does not mark edits made during a save as persisted', async () => {
  const html = fs.readFileSync('assets/editor/index.html', 'utf8');
  const save = html.slice(html.indexOf('async function save()'), html.indexOf('$("saveBtn").onclick = save;'));
  let release!: (x: unknown) => void;
  const response = new Promise(r => { release = r; });
  let payload = '';
  const context = vm.createContext({
    $: () => ({disabled:false}),
    api: (_: string, options: {body:string}) => { payload = options.body; return response; },
    style: {padding:72}, target:'scenario', S:{}, saved:'',
    sync:()=>{}, swapText:async()=>{}, setTimeout:()=>{}, toast:()=>{},
  });
  vm.runInContext(save, context);
  const saving = vm.runInContext('save()', context);
  context.style.padding = 140;
  release({ok:true, json:async()=>({state:{}})});
  await saving;
  expect(JSON.parse(context.saved)).toEqual(JSON.parse(payload).style);
});
