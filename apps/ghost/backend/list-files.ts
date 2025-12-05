import Database from 'better-sqlite3';

const db = new Database('ghost.db', { readonly: true });

const files = db.prepare(`
  SELECT id, type, content, metadata 
  FROM memories 
  WHERE metadata LIKE '%2511.09030v1_part2_pages6-10.pdf%'
`).all();

console.log('Found Memories:');
files.forEach((f: any) => {
    const meta = JSON.parse(f.metadata);
    console.log(`- [${f.type}] ${meta.name || 'No Name'} (${meta.path})`);
});
