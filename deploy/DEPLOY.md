# النشر على Hostinger VPS

المشروع ثلاث ريبوهات منفصلة، ولكل واحد workflow في `.github/workflows/deploy.yml` يعمل عند كل `push` على `main`:

| الريبو | ما يحدث |
|---|---|
| `nemaa_services_backend` | فحص الكود ← SSH ← `git reset` على `origin/main` ← `npm ci` ← `npm run migrate` ← `pm2 reload nemaa-backend` ← فحص أن الـ API يعمل |
| `nemaa_services_Front` | `npm run build` على GitHub ← رفع `dist/` بـ rsync إلى `SITE_DIR` |
| `nemaa_services_dashboard` | `npm run build` على GitHub ← رفع `dist/` بـ rsync إلى `DASHBOARD_DIR` |

## إعداد السيرفر (مرة واحدة)
```bash
# Node 20 + PM2 + Nginx + PostgreSQL (إن لم تكن قاعدة البيانات خارجية)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs nginx rsync git
sudo npm install -g pm2 && pm2 startup   # نفّذ الأمر الذي يطبعه pm2 startup

sudo mkdir -p /var/www/nemaa/{site,dashboard} && sudo chown -R $USER /var/www/nemaa
git clone git@github.com:nahjaltanfith-cpu/nemaa_services_backend.git /var/www/nemaa/backend
cd /var/www/nemaa/backend
nano .env        # انسخ مفاتيح .env.production واملأها: DATABASE_URL, JWT_SECRET, CORS_ORIGINS, SMTP_*, SITE_URL, DASHBOARD_URL
npm ci --omit=dev && npm run migrate
pm2 start ecosystem.config.cjs && pm2 save
```
- الريبو خاص: أضف للسيرفر **Deploy key** (مفتاح للقراءة فقط) من GitHub ← Settings ← Deploy keys، حتى يعمل `git fetch` بدون كلمة مرور.
- Nginx: انسخ `deploy/nginx.example.conf` وعدّل الدومينات والمسارات، ثم `nginx -t && systemctl reload nginx`، ثم `certbot --nginx` لشهادات HTTPS.
- مجلد `uploads/` (ملفات الجمعيات والصور) على السيرفر وليس في git؛ النشر لا يمسّه. خذ له نسخة احتياطية مع قاعدة البيانات.

## إعداد GitHub (في كل ريبو)
**Settings ← Secrets and variables ← Actions**

Secrets (الثلاثة ريبوهات):
- `HOSTINGER_SSH_HOST`, `HOSTINGER_SSH_USER`, `HOSTINGER_SSH_KEY` (المفتاح الخاص لمستخدم النشر؛ ضع المفتاح العام في `~/.ssh/authorized_keys` على السيرفر)
- اختياري: `HOSTINGER_SSH_PORT` (افتراضي 22)، `HOSTINGER_SSH_KNOWN_HOSTS` (ناتج `ssh-keyscan your-server` لتثبيت هوية السيرفر)

Variables:
| الريبو | المتغيرات |
|---|---|
| backend | `BACKEND_DIR` (اختياري، افتراضي `/var/www/nemaa/backend`) |
| Front | `VITE_API_BASE_URL` = `https://api.namaa.sa/api/v1`، `VITE_UPLOAD_URL` = `https://api.namaa.sa/api/upload`، `VITE_SOCKET_URL` (اختياري)، `SITE_DIR` (اختياري) |
| dashboard | `VITE_API_BASE_URL` = `https://api.namaa.sa/api`، `VITE_SOCKET_URL` = `https://api.namaa.sa`، `VITE_SITE_URL` = `https://namaa.sa`، `DASHBOARD_DIR` (اختياري) |

بناء الواجهات يتوقف برسالة واضحة إذا كان متغير ناقصًا أو ما زال `yourdomain`، فلا يُنشر بناء يشير لعنوان خاطئ.

## التبديل بين اللوكال والسيرفر
- `npm run dev` يقرأ `.env.development`، و`npm run build` يقرأ `.env.production` (ملفات `.env*` لا تُرفع إلى git).
- لتشغيل الواجهة اللوكال على باك اند السيرفر: غيّر `VITE_API_BASE_URL` (و`VITE_SOCKET_URL`) في `.env.development` إلى عنوان السيرفر، وأضف `http://localhost:5173` أو `http://localhost:5174` إلى `CORS_ORIGINS` في `.env` السيرفر ثم `pm2 reload nemaa-backend --update-env`. انتبه: ستعمل حينها على بيانات الإنتاج الحقيقية.

## الترحيلات
`npm run migrate` يطبّق ملفات `migrations/*.sql` الجديدة فقط، كلها في transaction واحدة. إذا فشل ملف لا يُطبّق شيء ويتوقف النشر قبل إعادة تشغيل الـ API، فتستمر النسخة السابقة في العمل. خذ نسخة احتياطية من قاعدة البيانات قبل دفع ترحيلات كبيرة.
