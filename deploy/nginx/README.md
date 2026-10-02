# NGINX reverse proxy

This configuration exposes both services through one host:

- `https://entry.w-pcp.dev/` -> Next.js on `127.0.0.1:3000`
- `https://entry.w-pcp.dev/api/` -> Express API on `127.0.0.1:4000`

The same HTTP Basic Authentication challenge protects the frontend and API.

## Install

From the repository root on the server:

```sh
sudo apt-get install nginx apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-entry-w-pcp operator
sudo cp deploy/nginx/entry.w-pcp.dev.conf /etc/nginx/sites-available/entry.w-pcp.dev
sudo ln -s /etc/nginx/sites-available/entry.w-pcp.dev /etc/nginx/sites-enabled/entry.w-pcp.dev
sudo nginx -t
sudo systemctl reload nginx
```

Set the same credentials for the backend process so that the forwarded
authorization header is accepted:

```sh
export BASIC_AUTH_USERNAME=operator
export BASIC_AUTH_PASSWORD='the-same-password'
```

Run the application processes on loopback or otherwise keep ports 3000 and
4000 inaccessible from the public network. Add the TLS `listen 443` and
certificate settings using the certificate manager used by the server.
