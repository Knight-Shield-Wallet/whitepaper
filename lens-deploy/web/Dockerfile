FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf && printf '%s\n' \
'server {' \
'  listen 80;' \
'  server_name _;' \
'  root /usr/share/nginx/html;' \
'  index index.html;' \
'' \
'  # Local health endpoint remains deterministic for the Hostinger deployment gate.' \
'  location = /health { default_type application/json; return 200 '\''{"status":"ok","service":"midnight-lens-web"}'\''; }' \
'' \
'  # Preserve the currently proven Marketplace surface and its static assets.' \
'  location = /marketplace { try_files /marketplace.html =404; }' \
'  location = /marketplace.html { try_files $uri =404; }' \
'  location = /marketplace.css { try_files $uri =404; }' \
'  location = /marketplace.js { try_files $uri =404; }' \
'' \
'  # Existing signed Android QA shell opens the canonical root. Make that root Sign-first.' \
'  location = / {' \
'    proxy_http_version 1.1;' \
'    proxy_ssl_server_name on;' \
'    proxy_ssl_name midnight-lens-ksd.lovable.app;' \
'    proxy_set_header Host midnight-lens-ksd.lovable.app;' \
'    proxy_set_header X-Forwarded-Host $host;' \
'    proxy_set_header X-Forwarded-Proto https;' \
'    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
'    proxy_pass https://midnight-lens-ksd.lovable.app/sign;' \
'    proxy_redirect https://midnight-lens-ksd.lovable.app/ /;' \
'  }' \
'' \
'  # Keep the full Sign-enabled Lens application on the canonical host.' \
'  location / {' \
'    proxy_http_version 1.1;' \
'    proxy_ssl_server_name on;' \
'    proxy_ssl_name midnight-lens-ksd.lovable.app;' \
'    proxy_set_header Host midnight-lens-ksd.lovable.app;' \
'    proxy_set_header X-Forwarded-Host $host;' \
'    proxy_set_header X-Forwarded-Proto https;' \
'    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
'    proxy_pass https://midnight-lens-ksd.lovable.app;' \
'    proxy_redirect https://midnight-lens-ksd.lovable.app/ /;' \
'  }' \
'}' > /etc/nginx/conf.d/default.conf
