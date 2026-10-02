# NGINX reverse proxy

This configuration exposes both services through one host:

- `https://entry.w-pcp.dev/` -> Next.js on `127.0.0.1:3000`
- `https://entry.w-pcp.dev/api/` -> Express API on `127.0.0.1:4000`

The same HTTP Basic Authentication challenge protects the frontend and API.

## Cloudflare and TLS setup

Use Cloudflare's **Full (strict)** encryption mode. This encrypts both
connections:

```text
browser --HTTPS--> Cloudflare --HTTPS--> NGINX --HTTP(loopback)--> application
```

1. In Cloudflare DNS, create an `A` or `AAAA` record for `entry.w-pcp.dev`
   pointing to the server and enable the orange-cloud proxy.
2. In **SSL/TLS -> Overview**, select **Full (strict)**.
3. In **SSL/TLS -> Origin Server**, create an Origin CA certificate for
   `entry.w-pcp.dev` and install the certificate and key on the server:

```sh
sudo install -d -m 700 /etc/ssl/cloudflare
sudo install -m 644 entry.w-pcp.dev.pem /etc/ssl/cloudflare/entry.w-pcp.dev.pem
sudo install -m 600 entry.w-pcp.dev.key /etc/ssl/cloudflare/entry.w-pcp.dev.key
```

The private key must not be committed to this repository. The certificate
should include `entry.w-pcp.dev` (a wildcard such as `*.w-pcp.dev` also works).

## Install NGINX

From the repository root on the server:

```sh
sudo apt-get install nginx apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-entry-w-pcp operator
sudo cp deploy/nginx/entry.w-pcp.dev.conf /etc/nginx/sites-available/entry.w-pcp.dev
sudo ln -s /etc/nginx/sites-available/entry.w-pcp.dev /etc/nginx/sites-enabled/entry.w-pcp.dev
sudo nginx -t
sudo systemctl reload nginx
```

The port 80 server only redirects to HTTPS. The 443 server terminates the
Cloudflare-to-origin TLS connection and applies Basic Authentication to both
the frontend and `/api/`.

Set the same credentials for the backend process so that the forwarded
authorization header is accepted:

```sh
export BASIC_AUTH_USERNAME=operator
export BASIC_AUTH_PASSWORD='the-same-password'
```

Run the application processes on loopback or otherwise keep ports 3000 and
4000 inaccessible from the public network. For example, bind them to
`127.0.0.1` or block them with the host firewall. Only ports 80 and 443 need
to be reachable by Cloudflare.

After changing the certificate or configuration:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

Cloudflare's Edge Certificate handles the browser-facing certificate. The
Origin CA certificate is only used between Cloudflare and NGINX, so the
origin should not be accessed directly by browsers.
