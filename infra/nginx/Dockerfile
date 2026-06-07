FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY ssl-params.conf /etc/nginx/ssl-params.conf
RUN mkdir -p /var/log/nginx /etc/nginx/certs
EXPOSE 80 443
