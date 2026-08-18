FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf && printf '%s\n' \
'server {' \
'  listen 80;' \
'  server_name _;' \
'  root /usr/share/nginx/html;' \
'  index index.html;' \
'  location = /health { default_type application/json; return 200 '\''{"status":"ok","service":"midnight-lens-web"}'\''; }' \
'  location / { try_files $uri $uri/ $uri.html /index.html; }' \
'}' > /etc/nginx/conf.d/default.conf
