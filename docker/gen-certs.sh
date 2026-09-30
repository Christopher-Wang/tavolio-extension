#!/bin/sh
# Creates a local CA and a localhost certificate in /certs (mounted from .docker/certs).
# Trust rootCA.pem once; localhost.pem/localhost-key.pem are used by Vite and Caddy.
# Leaf lifetime stays under 398 days, the most macOS/Safari accepts.
set -eu
cd /certs
[ -f rootCA.pem ] || {
  openssl req -x509 -new -nodes -newkey rsa:2048 -keyout rootCA-key.pem -out rootCA.pem \
    -days 3650 -subj "/CN=Tavolio local dev CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
}
openssl req -new -nodes -newkey rsa:2048 -keyout localhost-key.pem -out localhost.csr -subj "/CN=localhost"
printf "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" > ext.cnf
openssl x509 -req -in localhost.csr -CA rootCA.pem -CAkey rootCA-key.pem -CAcreateserial \
  -out localhost.pem -days 397 -extfile ext.cnf
rm -f localhost.csr ext.cnf rootCA.srl
chmod 644 /certs/*.pem
echo "Trust .docker/certs/rootCA.pem, then restart the dev server."
