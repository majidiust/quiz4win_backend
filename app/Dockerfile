# syntax=docker/dockerfile:1.7
#
# Quiz4Win — app.quiz4win.com static container.
#
# Serves:
#   /.well-known/apple-app-site-association  (iOS Universal Link manifest)
#   /.well-known/assetlinks.json             (Android App Link manifest)
#   /auth/reset-password                     (branded web fallback when the
#                                             Expo app is not installed)
#   /                                        (landing → app stores)
#
# Host nginx terminates TLS for app.quiz4win.com and proxies to this
# container on 127.0.0.1:5801 (see deploy/nginx/app.quiz4win.com.conf).

FROM nginx:alpine

# Remove default vhost so only our config is loaded.
RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/app.conf
COPY public/    /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
