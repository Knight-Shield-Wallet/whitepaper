FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf && printf '%s\n' \
'server {' \
'  listen 80;' \
'  server_name _;' \
'  root /usr/share/nginx/html;' \
'  index index.html;' \
'' \
'  location = /health { default_type application/json; return 200 '\''{"status":"ok","service":"midnight-lens-web"}'\''; }' \
'' \
'  # KSD-owned static Lens surfaces. No legacy external app proxy.' \
'  location = / { try_files /index.html =404; }' \
'  location = /session { try_files /session.html =404; }' \
'  location = /session.html { try_files $uri =404; }' \
'  location = /session.css { try_files $uri =404; }' \
'  location = /session.js { try_files $uri =404; }' \
'  location = /proof-session { try_files /proof-session.html =404; }' \
'  location = /proof-session.html { try_files $uri =404; }' \
'  location = /proof-session.css { try_files $uri =404; }' \
'  location = /proof-session.js { try_files $uri =404; }' \
'  location = /demo { try_files /demo.html =404; }' \
'  location = /demo.html { try_files $uri =404; }' \
'  location = /demo.js { try_files $uri =404; }' \
'  location = /styles.css { try_files $uri =404; }' \
'  location = /marketplace { try_files /marketplace.html =404; }' \
'  location = /marketplace.html { try_files $uri =404; }' \
'  location = /marketplace.css { try_files $uri =404; }' \
'  location = /marketplace.js { try_files $uri =404; }' \
'' \
'  location / { try_files $uri $uri/ =404; }' \
'}' > /etc/nginx/conf.d/default.conf
