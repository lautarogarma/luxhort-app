# luxhort-app

App web de **LUXHorticultura** para control remoto, publicada con GitHub Pages en
https://lautarogarma.github.io/luxhort-app/

Este repositorio es **solo una salida**: los archivos se generan desde el repo del
firmware (`tools/publicar_pages.py` en LuxHort) y se pisan en cada publicación.
No editar a mano acá — cualquier cambio se hace en `web/` del repo de origen.

Los datos viven en Supabase; acá no hay servidor ni base de datos. La clave que
aparece en `config.js` es la `anon`, pública por diseño.
