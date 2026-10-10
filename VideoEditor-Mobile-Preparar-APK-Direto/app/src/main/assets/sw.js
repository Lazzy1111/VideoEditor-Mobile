const CACHE='videoeditor-mobile-v0.2.0';
const ASSETS=['./','./index.html','./app.js','./style.css','./ui-v2.css','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/placeholder.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('videoeditor-mobile-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const u=new URL(event.request.url);if(u.origin!==self.location.origin)return;event.respondWith(caches.match(event.request).then(response=>response||fetch(event.request)));});
