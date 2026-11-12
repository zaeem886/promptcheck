import JSZip from 'jszip';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
const zip = new JSZip();
async function add(path, prefix='') {
  for(const entry of await readdir(path,{withFileTypes:true})) {
    const key=prefix+entry.name;
    if(entry.isDirectory()) await add(`${path}/${entry.name}`,`${key}/`);
    else zip.file(key,await readFile(`${path}/${entry.name}`));
  }
}
await add('build'); await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/PromptPrivacy-unpacked.zip',await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
console.log('Created artifacts/PromptPrivacy-unpacked.zip. Extract it and load the extracted folder in Chrome.');
