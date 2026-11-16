#!/bin/sh
# Carga el módulo de tiempo dentro de la web de Plane (time/public/embed.js).
# Plane rehace el documento al arrancar y borra etiquetas añadidas, así que el script en línea
# lanza import() mientras se lee la página: el módulo se carga aunque la etiqueta desaparezca.
f=/usr/share/nginx/html/index.html
grep -q '/time/embed.js' "$f" || sed -i "s#</head>#<script>import('/time/embed.js')</script></head>#" "$f"
