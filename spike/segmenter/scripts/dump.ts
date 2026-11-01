import { readFileSync } from 'node:fs'
import { extract, parse } from '../src/adapters/comark.ts'

const file = process.argv[2]!
const { segments, codeBlocks } = await extract(file, await parse(readFileSync(file, 'utf8')))
for (const s of segments) {
  console.log(`${s.hash} ${s.kind.padEnd(14)} L${s.position.startLine}-${s.position.endLine} [${s.context.containers.join('>')}] ${s.context.detail ?? ''} | ${s.context.headingTrail.join(' > ')}`)
  console.log(`   skel: ${s.skeleton}`)
  if (s.skeleton !== s.text) console.log(`   text: ${s.text}`)
  for (const p of s.placeholders) console.log(`     {${p.id}} ${p.type}${p.name ? `:${p.name}` : ''} ${JSON.stringify(p.source)}${p.close !== undefined ? ` … ${JSON.stringify(p.close)}` : ''}${p.hidesText ? ' (hides text)' : ''}`)
}
console.log(codeBlocks)
