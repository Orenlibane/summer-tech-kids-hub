// self-destruct service worker: clears all caches, unregisters, reloads clients
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));}catch(_){}
  try{await self.registration.unregister();}catch(_){}
  try{const cs=await self.clients.matchAll({type:'window'});cs.forEach(c=>c.navigate(c.url));}catch(_){}
})());});
